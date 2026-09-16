import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate'

export type ExtractedEntry = {
	/** Path inside the archive, always relative and POSIX-shaped. */
	path: string
	size: number
}

export type ExtractLimits = {
	maxEntries: number
	maxBytes: number
}

export type ExtractResult = {
	entries: ExtractedEntry[]
	totalBytes: number
	/** Entries we refused to write: directories, unsafe paths, exotic compression. */
	skipped: number
}

export class ZipError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'ZipError'
	}
}

/** Characters that are illegal in a Windows path segment (this repo targets Windows + Linux). */
const ILLEGAL_SEGMENT = /[<>:"|?*\u0000-\u001f]/
const MAX_PATH_LENGTH = 400
/** 0 = stored, 8 = deflate. Anything else fflate cannot inflate without extra codecs. */
const SUPPORTED_COMPRESSION = new Set([0, 8])

export async function isZipFile(path: string): Promise<boolean> {
	const head = new Uint8Array(await Bun.file(path).slice(0, 4).arrayBuffer())
	return (
		head.length === 4 &&
		head[0] === 0x50 &&
		head[1] === 0x4b &&
		(head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07)
	)
}

/**
 * Turns an archive entry name into a safe relative path.
 * Returns null when the entry must be skipped (directory, traversal, illegal name).
 */
export function safeEntryPath(raw: string): string | null {
	const unified = raw.replace(/\\/g, '/')
	if (unified.endsWith('/')) return null

	const segments: string[] = []
	for (const segment of unified.split('/')) {
		if (segment === '' || segment === '.') continue
		// Zip-slip guard: never allow the archive to escape its own directory.
		if (segment === '..') return null
		if (ILLEGAL_SEGMENT.test(segment)) return null
		segments.push(segment)
	}

	const clean = segments.join('/')
	if (clean.length === 0 || clean.length > MAX_PATH_LENGTH) return null
	return clean
}

/**
 * Streams a zip from disk and writes every safe entry under `destDir`.
 * Memory stays flat: chunks go straight from the inflater into a file sink.
 */
export async function extractZip(
	sourcePath: string,
	destDir: string,
	limits: ExtractLimits
): Promise<ExtractResult> {
	const entries: ExtractedEntry[] = []
	const closers: Array<Promise<unknown> | number> = []
	let totalBytes = 0
	let skipped = 0
	let failure: Error | null = null

	const unzip = new Unzip((file) => {
		if (failure) return

		const path = safeEntryPath(file.name ?? '')
		if (path === null) {
			skipped += 1
			return
		}
		if (!SUPPORTED_COMPRESSION.has(file.compression)) {
			skipped += 1
			return
		}
		if (entries.length >= limits.maxEntries) {
			failure = new ZipError(`压缩包条目数超过上限（${limits.maxEntries}）`)
			return
		}

		const target = join(destDir, path)
		let sink: Bun.FileSink
		try {
			mkdirSync(dirname(target), { recursive: true })
			sink = Bun.file(target).writer()
		} catch (error) {
			failure = toError(error)
			return
		}

		const entry: ExtractedEntry = { path, size: 0 }
		entries.push(entry)

		let closed = false
		const close = () => {
			if (closed) return
			closed = true
			closers.push(sink.end())
		}

		file.ondata = (error, chunk, final) => {
			if (error) {
				failure ??= toError(error)
				close()
				return
			}
			if (failure) {
				close()
				return
			}

			totalBytes += chunk.length
			entry.size += chunk.length

			if (totalBytes > limits.maxBytes) {
				failure = new ZipError(
					`解压后体积超过上限（${Math.floor(limits.maxBytes / 1024 / 1024)}MB）`
				)
				close()
				return
			}

			try {
				if (chunk.length > 0) sink.write(chunk)
				if (final) close()
			} catch (writeError) {
				failure = toError(writeError)
				close()
			}
		}

		try {
			file.start()
		} catch (startError) {
			failure = toError(startError)
			close()
		}
	})

	unzip.register(UnzipInflate)
	unzip.register(UnzipPassThrough)

	const reader = Bun.file(sourcePath).stream().getReader()
	try {
		for (;;) {
			const { done, value } = await reader.read()
			if (done) break
			if (failure) break
			if (value && value.length > 0) unzip.push(value, false)
		}
		if (!failure) unzip.push(new Uint8Array(0), true)
	} catch (error) {
		failure ??= toError(error)
	} finally {
		await reader.cancel().catch(() => undefined)
	}

	await Promise.allSettled(closers)

	if (failure) throw failure
	return { entries, totalBytes, skipped }
}

function toError(value: unknown): Error {
	return value instanceof Error ? value : new Error(String(value))
}
