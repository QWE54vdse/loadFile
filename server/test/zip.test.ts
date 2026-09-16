import { describe, expect, test } from 'bun:test'
import { safeEntryPath } from '../src/modules/archives/zip'

describe('safeEntryPath', () => {
	test('keeps ordinary nested paths', () => {
		expect(safeEntryPath('src/lib/util.ts')).toBe('src/lib/util.ts')
		expect(safeEntryPath('readme.md')).toBe('readme.md')
	})

	test('normalises windows separators and redundant segments', () => {
		expect(safeEntryPath('src\\lib\\util.ts')).toBe('src/lib/util.ts')
		expect(safeEntryPath('./docs//notes.txt')).toBe('docs/notes.txt')
	})

	test('drops directory entries', () => {
		expect(safeEntryPath('src/')).toBeNull()
		expect(safeEntryPath('/')).toBeNull()
	})

	test('refuses traversal', () => {
		expect(safeEntryPath('../secret.txt')).toBeNull()
		expect(safeEntryPath('a/../../b.txt')).toBeNull()
		expect(safeEntryPath('..\\..\\meta.json')).toBeNull()
	})

	test('refuses names windows cannot store', () => {
		expect(safeEntryPath('a/b:c.txt')).toBeNull()
		expect(safeEntryPath('a/\u0000.txt')).toBeNull()
		expect(safeEntryPath('a/BAD?.txt')).toBeNull()
	})
})
