import { mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import { config } from '../../config'
import { ZipError, extractZip, isZipFile, safeEntryPath } from './zip'
import type { Archive, ArchiveSummary } from './model'

export class ArchiveError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly status: number
	) {
		super(message)
		this.name = 'ArchiveError'
	}
}

const ID_PATTERN = /^[a-z0-9]{6,32}$/
const ILLEGAL_FILENAME = /[<>:"|?*\u0000-\u001f]/g
const MAX_FILENAME_LENGTH = 160

const rootDir = () => join(config.dataDir, 'archives')
const dirOf = (id: string) => join(rootDir(), id)
const metaOf = (id: string) => join(dirOf(id), 'meta.json')
const originalDirOf = (id: string) => join(dirOf(id), 'original')
const filesDirOf = (id: string) => join(dirOf(id), 'files')

export async function initStorage(): Promise<void> {
	await mkdir(rootDir(), { recursive: true })
}

function newId(): string {
	return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
}

function requireId(id: string): string {
	if (!ID_PATTERN.test(id)) {
		throw new ArchiveError('NOT_FOUND', '找不到该压缩包', 404)
	}
	return id
}

function sanitizeFilename(raw: string): string {
	const base = basename(raw.replace(/\\/g, '/'))
	const cleaned = base.replace(ILLEGAL_FILENAME, '_').replace(/^\.+/, '').trim().slice(0, MAX_FILENAME_LENGTH)
	return cleaned.length > 0 ? cleaned : 'upload.bin'
}

function toSummary(archive: Archive): ArchiveSummary {
	const { entries: _entries, ...summary } = archive
	return summary
}

async function readMeta(id: string): Promise<Archive | null> {
	try {
		const raw = await readFile(metaOf(id), 'utf8')
		return JSON.parse(raw) as Archive
	} catch {
		return null
	}
}

export async function listArchives(): Promise<ArchiveSummary[]> {
	let ids: string[]
	try {
		const dirents = await readdir(rootDir(), { withFileTypes: true })
		ids = dirents.filter((entry) => entry.isDirectory() && ID_PATTERN.test(entry.name)).map((entry) => entry.name)
	} catch {
		return []
	}

	const archives: ArchiveSummary[] = []
	for (const id of ids) {
		const meta = await readMeta(id)
		if (meta) archives.push(toSummary(meta))
	}

	archives.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
	return archives
}

export async function getArchive(id: string, options: { withEntries: true }): Promise<Archive>
export async function getArchive(id: string, options?: { withEntries?: false }): Promise<ArchiveSummary>
export async function getArchive(
	id: string,
	options: { withEntries?: boolean } = {}
): Promise<Archive | ArchiveSummary> {
	requireId(id)
	const meta = await readMeta(id)
	if (!meta) throw new ArchiveError('NOT_FOUND', '找不到该压缩包', 404)
	return options.withEntries ? meta : toSummary(meta)
}

/**
 * Persists an upload. Zip archives are streamed open into `files/`, anything
 * else is kept as a single opaque download.
 */
export async function createArchive(file: File): Promise<ArchiveSummary> {
	if (!(file instanceof Blob) || typeof file.name !== 'string') {
		throw new ArchiveError('INVALID_UPLOAD', '请求里没有文件字段 file', 422)
	}
	if (file.size === 0) {
		throw new ArchiveError('EMPTY_FILE', '文件内容为空', 422)
	}
	if (file.size > config.limits.maxUploadBytes) {
		throw new ArchiveError(
			'FILE_TOO_LARGE',
			`文件超过上限 ${Math.floor(config.limits.maxUploadBytes / 1024 / 1024)}MB`,
			413
		)
	}

	const id = newId()
	const dir = dirOf(id)
	const storedName = sanitizeFilename(file.name)
	const originalPath = join(originalDirOf(id), storedName)

	await mkdir(originalDirOf(id), { recursive: true })

	try {
		// Streams the Blob to disk; the multipart body is already buffered by the parser.
		await Bun.write(originalPath, file)

		let entries: Archive['entries'] = []
		let extractedBytes = 0
		let skippedEntries = 0
		let kind: Archive['kind'] = 'file'

		if (await isZipFile(originalPath)) {
			kind = 'zip'
			const result = await extractZip(originalPath, filesDirOf(id), {
				maxEntries: config.limits.maxEntries,
				maxBytes: config.limits.maxExtractBytes
			})
			entries = result.entries
			extractedBytes = result.totalBytes
			skippedEntries = result.skipped
		}

		const meta: Archive = {
			id,
			name: storedName,
			kind,
			size: file.size,
			uploadedAt: new Date().toISOString(),
			entryCount: entries.length,
			extractedBytes,
			skippedEntries,
			entries
		}

		// Write meta last: a half-written archive is never listed.
		const tmp = `${metaOf(id)}.tmp`
		await Bun.write(tmp, JSON.stringify(meta))
		await rename(tmp, metaOf(id))

		return toSummary(meta)
	} catch (error) {
		await rm(dir, { recursive: true, force: true }).catch(() => undefined)
		if (error instanceof ArchiveError) throw error
		if (error instanceof ZipError) {
			throw new ArchiveError('EXTRACT_FAILED', `解压失败：${error.message}`, 422)
		}
		throw error
	}
}

export async function deleteArchive(id: string): Promise<boolean> {
	requireId(id)
	const dir = dirOf(id)
	try {
		await stat(metaOf(id))
	} catch {
		throw new ArchiveError('NOT_FOUND', '找不到该压缩包', 404)
	}
	await rm(dir, { recursive: true, force: true })
	return true
}

export type ResolvedFile = {
	path: string
	name: string
	contentType?: string
}

/** The archive exactly as it was uploaded. */
export async function resolveOriginal(id: string): Promise<ResolvedFile> {
	const meta = await getArchive(id, { withEntries: true })
	const dir = originalDirOf(id)
	const dirents = await readdir(dir).catch(() => [] as string[])
	const stored = dirents.at(0)
	if (!stored) throw new ArchiveError('NOT_FOUND', '原始文件已丢失', 404)
	return { path: join(dir, stored), name: meta.name }
}

/** One extracted entry inside the archive. */
export async function resolveEntry(id: string, rawPath: string): Promise<ResolvedFile> {
	requireId(id)
	const meta = await readMeta(id)
	if (!meta) throw new ArchiveError('NOT_FOUND', '找不到该压缩包', 404)
	if (meta.kind !== 'zip') {
		throw new ArchiveError('NOT_AN_ARCHIVE', '该文件不是压缩包，没有内部文件', 400)
	}

	const relative = safeEntryPath(rawPath)
	if (relative === null) {
		throw new ArchiveError('BAD_PATH', '文件路径非法', 400)
	}

	const base = resolve(filesDirOf(id))
	const target = resolve(base, relative)
	// Belt and braces on top of safeEntryPath.
	if (target !== base && !target.startsWith(base + sep)) {
		throw new ArchiveError('BAD_PATH', '文件路径非法', 400)
	}

	const info = await stat(target).catch(() => null)
	if (!info?.isFile()) throw new ArchiveError('NOT_FOUND', '找不到该文件', 404)

	return { path: target, name: relative.split('/').at(-1) ?? relative }
}
