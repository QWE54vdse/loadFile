/**
 * Standalone ngrok tunnel for archive-dock.
 *
 * `TUNNEL=1 bun run start` does the same thing inside the server process; use
 * this script instead when you'd rather keep the tunnel out of the app.
 *
 *   bun run tunnel        # from the repo root
 *
 * Requires NGROK_AUTHTOKEN, which Bun auto-loads from this workspace's .env.
 */
const port = Number(process.env.PORT ?? 3000)

// Passed explicitly rather than via `authtoken_from_env: true`. Bun's .env
// auto-loading only fills `process.env` for JS — it never writes the real OS
// environment, which is where the SDK's native layer reads from. The shortcut
// therefore fails with ERR_NGROK_4018 even when the token itself is valid.
const authtoken = process.env.NGROK_AUTHTOKEN
if (!authtoken) {
	console.error('[tunnel] 缺少 NGROK_AUTHTOKEN —— 写进 server/.env 后重试')
	process.exit(1)
}

const { forward } = await import('@ngrok/ngrok')

const listener = await forward({
	addr: port,
	authtoken

	// 固定域名先在 https://dashboard.ngrok.com/domains 领取：
	// domain: 'your-domain.ngrok-free.app'
})

console.log(`[tunnel] public: ${listener.url()}`)
