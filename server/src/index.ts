import { stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'
import { config } from './config'
import { deleteProtected, downloadProtected } from './lib/auth'
import { fileResponse } from './lib/http'
import { archives } from './modules/archives'
import { ArchiveError, initStorage } from './modules/archives/service'

await initStorage()

const api = new Elysia({ prefix: '/api' })
	.get('/health', () => ({
		ok: true,
		deleteProtected: deleteProtected(),
		downloadProtected: downloadProtected(),
		limits: {
			maxUploadBytes: config.limits.maxUploadBytes,
			maxEntries: config.limits.maxEntries,
			maxExtractBytes: config.limits.maxExtractBytes
		}
	}))
	.use(archives)

const webRoot = resolve(config.webDist)
const hasWebBuild = await Bun.file(join(webRoot, 'index.html')).exists()

/** Serves the built SPA when `web/dist` exists, falling back to index.html for client routes. */
async function serveWeb(context: { params?: unknown; request: Request }): Promise<Response> {
	const params = context.params as Record<string, string | undefined> | undefined
	const relative = params?.['*'] ?? ''
	const target = resolve(webRoot, relative)

	if (target !== webRoot && !target.startsWith(webRoot + sep)) {
		return new Response('forbidden', { status: 403 })
	}

	const info = await stat(target).catch(() => null)
	if (info?.isFile()) {
		return fileResponse(target, context.request, { contentType: Bun.file(target).type })
	}
	return fileResponse(join(webRoot, 'index.html'), context.request, {
		contentType: 'text/html; charset=utf-8'
	})
}

const web = new Elysia()
if (hasWebBuild) {
	web.get('/', serveWeb).get('/*', serveWeb)
}

const app = new Elysia()
	.use(cors({ origin: config.corsOrigin }))
	.onError(({ code, error, status, path }) => {
		if (error instanceof ArchiveError) {
			return status(error.status, { error: { code: error.code, message: error.message } })
		}
		if (code === 'VALIDATION') {
			return status(422, { error: { code: 'VALIDATION', message: '请求参数不合法' } })
		}
		if (code === 'NOT_FOUND') {
			return status(404, { error: { code: 'NOT_FOUND', message: `接口不存在：${path}` } })
		}
		if (code === 'PARSE') {
			return status(400, { error: { code: 'PARSE', message: '无法解析请求体' } })
		}

		console.error('[archive-dock]', error)
		return status(500, { error: { code: 'INTERNAL', message: '服务器内部错误' } })
	})
	.use(api)
	.use(web)
	.listen({
		port: config.port,
		hostname: config.host,
		maxRequestBodySize: config.limits.maxUploadBytes + 1024 * 1024
	})

console.log(`[archive-dock] http://localhost:${config.port}`)
console.log(`[archive-dock] data dir: ${config.dataDir}`)
console.log(
	hasWebBuild
		? `[archive-dock] serving built web from ${webRoot}`
		: '[archive-dock] web/dist not found — run `bun run dev:web` for the Vite dev server'
)

// Opt-in public tunnel: `TUNNEL=1 bun run start`. Off by default so a normal
// local run never ends up reachable from the internet by accident.
//
// The token is passed explicitly instead of via `authtoken_from_env: true`.
// Bun's .env auto-loading only fills `process.env` for JS — it never writes the
// real OS environment, which is where the SDK's native layer reads from. So a
// token that lives only in .env makes `authtoken_from_env` fail with
// ERR_NGROK_4018 even though the token is valid.
//
// A dead tunnel is logged, not fatal: the local service keeps serving.
if (process.env.TUNNEL === '1') {
	const authtoken = process.env.NGROK_AUTHTOKEN
	if (!authtoken) {
		console.warn('[archive-dock] TUNNEL=1 但 NGROK_AUTHTOKEN 未设置 —— 跳过隧道')
	} else {
		try {
			const { forward } = await import('@ngrok/ngrok')
			const listener = await forward({ addr: config.port, authtoken })
			console.log(`[archive-dock] public: ${listener.url()}`)
		} catch (error) {
			console.error('[archive-dock] 隧道启动失败，仅本地可访问：', error)
		}
	}
}

export type App = typeof app
