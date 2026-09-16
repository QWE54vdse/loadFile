import { Elysia, t } from 'elysia'
import { deleteProtected, downloadProtected, verifyDeleteToken, verifyDownloadToken } from '../../lib/auth'
import { fileResponse } from '../../lib/http'
import {
	archiveEntrySchema,
	archiveListSchema,
	archiveSchema,
	archiveSummarySchema,
	deletedSchema,
	errorSchema
} from './model'
import {
	ArchiveError,
	createArchive,
	deleteArchive,
	getArchive,
	listArchives,
	resolveEntry,
	resolveOriginal
} from './service'

const idParams = t.Object({ id: t.String({ minLength: 6 }) })

/** The token arrives as `?token=` (plain links) or as a header (curl/scripts). */
function requireDownloadToken(provided: string | undefined): void {
	if (!downloadProtected()) return
	if (!verifyDownloadToken(provided)) {
		throw new ArchiveError('UNAUTHORIZED', '下载口令不正确', 401)
	}
}

export const archives = new Elysia({ prefix: '/archives', name: 'archives' })
	.model({
		archive: archiveSchema,
		archiveSummary: archiveSummarySchema,
		archiveList: archiveListSchema,
		archiveEntry: archiveEntrySchema,
		archiveDeleted: deletedSchema,
		archiveError: errorSchema
	})
	.get('/', async () => ({ items: await listArchives() }), {
		response: { 200: 'archiveList' }
	})
	.post(
		'/',
		async ({ body, status }) => status(201, await createArchive(body.file)),
		{
			body: t.Object({
				file: t.File({ title: '压缩包或普通文件' })
			}),
			response: { 201: 'archiveSummary' }
		}
	)
	.get('/:id', ({ params: { id } }) => getArchive(id, { withEntries: true }), {
		params: idParams,
		response: { 200: 'archive' }
	})
	.delete(
		'/:id',
		async ({ params: { id }, headers }) => {
			if (!deleteProtected()) {
				throw new ArchiveError('DELETE_DISABLED', '服务端未配置删除口令，删除功能已关闭', 403)
			}
			if (!verifyDeleteToken(headers['x-delete-token'])) {
				throw new ArchiveError('UNAUTHORIZED', '删除口令不正确', 401)
			}
			return { id, deleted: await deleteArchive(id) }
		},
		{
			params: idParams,
			response: { 200: 'archiveDeleted' }
		}
	)
	.get(
		'/:id/download',
		async ({ params: { id }, request, query, headers }) => {
			requireDownloadToken(query.token ?? headers['x-download-token'])
			const file = await resolveOriginal(id)
			return fileResponse(file.path, request, { download: file.name })
		},
		{ params: idParams }
	)
	.get(
		'/:id/files/*',
		async ({ params, request, query, headers }) => {
			requireDownloadToken(query.token ?? headers['x-download-token'])
			const { id, '*': entryPath } = params as { id: string; '*'?: string }
			const file = await resolveEntry(id, entryPath ?? '')
			return fileResponse(file.path, request, { download: file.name })
		},
		{
			params: t.Object({
				id: t.String({ minLength: 6 }),
				'*': t.Optional(t.String())
			})
		}
	)
