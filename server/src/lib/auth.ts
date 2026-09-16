import { timingSafeEqual } from 'node:crypto'
import { config } from '../config'

/** Constant-time comparison so a wrong token cannot be probed byte by byte. */
function matches(provided: string | undefined, expected: string): boolean {
	if (!provided || expected.length === 0) return false
	const actual = Buffer.from(provided)
	const target = Buffer.from(expected)
	if (actual.length !== target.length) return false
	return timingSafeEqual(actual, target)
}

/** Deletion stays switched off until an operator sets DELETE_TOKEN. */
export const deleteProtected = (): boolean => config.deleteToken.length > 0

export const verifyDeleteToken = (provided: string | undefined): boolean =>
	matches(provided, config.deleteToken)

/** Downloads stay open when no token is configured — downloading is the app's primary function. */
export const downloadProtected = (): boolean => config.downloadToken.length > 0

export const verifyDownloadToken = (provided: string | undefined): boolean =>
	matches(provided, config.downloadToken)
