import { t } from 'elysia'

export const archiveEntrySchema = t.Object({
	path: t.String(),
	size: t.Number()
})

export const archiveSummarySchema = t.Object({
	id: t.String(),
	name: t.String(),
	/** `zip` archives are extracted; everything else is stored as one opaque file. */
	kind: t.Union([t.Literal('zip'), t.Literal('file')]),
	size: t.Number(),
	uploadedAt: t.String(),
	entryCount: t.Number(),
	extractedBytes: t.Number(),
	skippedEntries: t.Number()
})

export const archiveSchema = t.Composite([
	archiveSummarySchema,
	t.Object({ entries: t.Array(archiveEntrySchema) })
])

export const archiveListSchema = t.Object({
	items: t.Array(archiveSummarySchema)
})

export const deletedSchema = t.Object({ id: t.String(), deleted: t.Boolean() })

export const errorSchema = t.Object({
	error: t.Object({
		code: t.String(),
		message: t.String()
	})
})

export type ArchiveEntry = typeof archiveEntrySchema.static
export type ArchiveSummary = typeof archiveSummarySchema.static
export type Archive = typeof archiveSchema.static
