export type ArchiveEntry = {
	path: string
	size: number
}

export type ArchiveSummary = {
	id: string
	name: string
	kind: 'zip' | 'file'
	size: number
	uploadedAt: string
	entryCount: number
	extractedBytes: number
	skippedEntries: number
}

export type Archive = ArchiveSummary & {
	entries: ArchiveEntry[]
}

export type Health = {
	ok: boolean
	/** False means the server has no DELETE_TOKEN configured and refuses deletions. */
	deleteProtected: boolean
	/** False means the server has no DOWNLOAD_TOKEN configured and downloads are open. */
	downloadProtected: boolean
	limits: {
		maxUploadBytes: number
		maxEntries: number
		maxExtractBytes: number
	}
}

export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code: string
	) {
		super(message)
		this.name = 'ApiError'
	}
}

const BASE = '/api'

/** Appends the download token as a query parameter so plain links keep working. */
export function withDownloadToken(url: string, token: string): string {
	return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text) as unknown
	} catch {
		return null
	}
}

function errorFrom(payload: unknown, status: number): ApiError {
	const envelope = payload as { error?: { message?: string; code?: string } } | null
	return new ApiError(
		envelope?.error?.message ?? `请求失败（HTTP ${status}）`,
		status,
		envelope?.error?.code ?? 'HTTP_ERROR'
	)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(`${BASE}${path}`, init)
	const text = await response.text()
	const payload = text.length > 0 ? parseJson(text) : null
	if (!response.ok) throw errorFrom(payload, response.status)
	return payload as T
}

export const api = {
	health: () => request<Health>('/health'),

	list: () => request<{ items: ArchiveSummary[] }>('/archives'),

	detail: (id: string) => request<Archive>(`/archives/${encodeURIComponent(id)}`),

	remove: (id: string, deleteToken: string) =>
		request<{ id: string; deleted: boolean }>(`/archives/${encodeURIComponent(id)}`, {
			method: 'DELETE',
			headers: { 'x-delete-token': deleteToken }
		}),

	originalUrl: (id: string, token?: string) => {
		const url = `${BASE}/archives/${encodeURIComponent(id)}/download`
		return token ? withDownloadToken(url, token) : url
	},

	entryUrl: (id: string, entryPath: string, token?: string) => {
		const url = `${BASE}/archives/${encodeURIComponent(id)}/files/${entryPath
			.split('/')
			.map(encodeURIComponent)
			.join('/')}`
		return token ? withDownloadToken(url, token) : url
	}
}

/** 1-byte Range request that validates a download token without fetching the file. */
export async function probeDownload(url: string, token: string): Promise<void> {
	const response = await fetch(withDownloadToken(url, token), {
		headers: { Range: 'bytes=0-0' }
	})
	if (!response.ok) {
		const text = await response.text()
		throw errorFrom(text.length > 0 ? parseJson(text) : null, response.status)
	}
	await response.body?.cancel()
}

export type UploadOptions = {
	onProgress?: (ratio: number) => void
	signal?: AbortSignal
}

/**
 * XHR instead of fetch: `fetch` still cannot report upload progress in browsers.
 */
export function uploadArchive(file: File, options: UploadOptions = {}): Promise<ArchiveSummary> {
	const { onProgress, signal } = options

	return new Promise<ArchiveSummary>((resolve, reject) => {
		const xhr = new XMLHttpRequest()
		xhr.open('POST', `${BASE}/archives`)

		const abort = () => xhr.abort()
		signal?.addEventListener('abort', abort, { once: true })
		const cleanup = () => signal?.removeEventListener('abort', abort)

		xhr.upload.addEventListener('progress', (event) => {
			if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total)
		})

		xhr.addEventListener('load', () => {
			cleanup()
			const payload = xhr.responseText.length > 0 ? parseJson(xhr.responseText) : null
			if (xhr.status >= 200 && xhr.status < 300) {
				onProgress?.(1)
				resolve(payload as ArchiveSummary)
				return
			}
			reject(errorFrom(payload, xhr.status))
		})

		xhr.addEventListener('error', () => {
			cleanup()
			reject(new ApiError('网络异常，上传没有完成', 0, 'NETWORK_ERROR'))
		})

		xhr.addEventListener('abort', () => {
			cleanup()
			reject(new DOMException('上传已取消', 'AbortError'))
		})

		const form = new FormData()
		form.append('file', file, file.name)
		xhr.send(form)
	})
}

export function messageOf(error: unknown): string {
	if (error instanceof ApiError) return error.message
	if (error instanceof Error) return error.message
	return String(error)
}
