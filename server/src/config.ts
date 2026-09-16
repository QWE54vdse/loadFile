import { resolve } from 'node:path'

const positive = (raw: string | undefined, fallback: number): number => {
	const value = Number(raw)
	return Number.isFinite(value) && value > 0 ? value : fallback
}

const MB = 1024 * 1024

/**
 * Every tunable lives here so deployment only needs environment variables.
 */
export const config = {
	port: positive(process.env.PORT, 3000),
	host: process.env.HOST ?? '0.0.0.0',
	/** '*' allows any origin; set CORS_ORIGIN to a concrete origin in production. */
	corsOrigin: process.env.CORS_ORIGIN ?? '*',
	/** Empty string disables deletion entirely — the safe default for public deployments. */
	deleteToken: process.env.DELETE_TOKEN ?? '',
	/** Empty string keeps downloads open — downloading is the app's primary function. */
	downloadToken: process.env.DOWNLOAD_TOKEN ?? '',
	dataDir: process.env.DATA_DIR
		? resolve(process.env.DATA_DIR)
		: resolve(import.meta.dir, '../data'),
	webDist: resolve(import.meta.dir, '../../web/dist'),
	limits: {
		/** Single request body cap. */
		maxUploadBytes: positive(process.env.MAX_UPLOAD_BYTES, 512 * MB),
		/** Zip entries we are willing to write to disk. */
		maxEntries: positive(process.env.MAX_ENTRIES, 5_000),
		/** Total uncompressed bytes cap — the zip-bomb guard. */
		maxExtractBytes: positive(process.env.MAX_EXTRACT_BYTES, 2048 * MB)
	}
} as const

export const maxUploadLabel = `${Math.floor(config.limits.maxUploadBytes / MB)}MB`
