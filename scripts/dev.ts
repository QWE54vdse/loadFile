import { resolve } from 'node:path'

/**
 * Runs the Elysia API and the Vite dev server side by side and forwards Ctrl+C
 * to both. No extra dependency needed.
 */
const root = resolve(import.meta.dir, '..')

const targets = [
	{ name: 'api', dir: 'server' },
	{ name: 'web', dir: 'web' }
]

const children = targets.map(({ name, dir }) => {
	const child = Bun.spawn(['bun', 'run', 'dev'], {
		cwd: resolve(root, dir),
		stdout: 'inherit',
		stderr: 'inherit',
		stdin: 'ignore'
	})
	console.log(`[dev] ${name.padEnd(3)} → pid ${child.pid}  (${dir})`)
	return child
})

let stopping = false
const shutdown = () => {
	if (stopping) return
	stopping = true
	for (const child of children) child.kill()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

await Promise.all(children.map((child) => child.exited))
shutdown()
process.exit(0)
