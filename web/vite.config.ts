import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
	plugins: [react()],
	server: {
		port: 5173,
		strictPort: true,
		proxy: {
			// Dev-only: the API lives on :3000, the Vite dev server proxies it so
			// the browser sees a single origin and no CORS preflight is needed.
			'/api': {
				target: 'http://localhost:3000',
				changeOrigin: true
			}
		}
	},
	build: {
		outDir: 'dist',
		emptyOutDir: true
	}
})
