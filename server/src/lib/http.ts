/**
 * Small HTTP helpers shared by the archive routes: RFC 5987 download names and
 * byte-range aware file responses (so downloads can be resumed).
 */

export function contentDisposition(
	filename: string,
	kind: 'attachment' | 'inline' = 'attachment'
): string {
	// ASCII fallback for ancient clients, then the RFC 5987 UTF-8 form.
	const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
	return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

export type FileResponseOptions = {
	download?: string
	contentType?: string
}

/**
 * Serves a file from disk with `Range` support.
 * Returns 200, 206 (partial) or 416 (unsatisfiable).
 */
export function fileResponse(
	path: string,
	request: Request,
	options: FileResponseOptions = {}
): Response {
	const file = Bun.file(path)
	const size = file.size
	const headers = new Headers({
		'accept-ranges': 'bytes',
		'last-modified': new Date(file.lastModified).toUTCString()
	})

	const contentType = options.contentType ?? file.type
	if (contentType) headers.set('content-type', contentType)
	if (options.download) {
		headers.set('content-disposition', contentDisposition(options.download))
	}

	if (size === 0) {
		headers.set('content-length', '0')
		return new Response(null, { status: 200, headers })
	}

	const range = request.headers.get('range')
	if (!range) {
		headers.set('content-length', String(size))
		return new Response(file, { status: 200, headers })
	}

	const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
	if (!match) return unsatisfiable(size, headers)

	const [, rawStart, rawEnd] = match
	let start: number
	let end: number

	if (rawStart === '') {
		if (rawEnd === '') return unsatisfiable(size, headers)
		// Suffix range: the final N bytes.
		const suffix = Number(rawEnd)
		start = Math.max(0, size - suffix)
		end = size - 1
	} else {
		start = Number(rawStart)
		end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
	}

	if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
		return unsatisfiable(size, headers)
	}

	headers.set('content-length', String(end - start + 1))
	headers.set('content-range', `bytes ${start}-${end}/${size}`)

	return new Response(file.slice(start, end + 1), { status: 206, headers })
}

function unsatisfiable(size: number, headers: Headers): Response {
	const out = new Headers(headers)
	out.set('content-range', `bytes */${size}`)
	return new Response('range not satisfiable', { status: 416, headers: out })
}
