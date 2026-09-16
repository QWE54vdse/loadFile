import { useState, type MouseEvent } from 'react'
import { api, messageOf, type ArchiveSummary } from '../api'
import { formatBytes, formatDateTime } from '../lib/format'

type Props = {
	items: ArchiveSummary[]
	state: 'loading' | 'ready' | 'error'
	error: string | null
	selectedId: string | null
	/** undefined until health is known; false means the server refuses deletions. */
	deleteProtected?: boolean
	downloadHref: (raw: string) => string
	onDownload: (event: MouseEvent<HTMLAnchorElement>, raw: string) => void
	onSelect: (id: string) => void
	onDelete: (id: string, deleteToken: string) => Promise<void>
	onRetry: () => void
}

export default function ArchiveList({
	items,
	state,
	error,
	selectedId,
	deleteProtected,
	downloadHref,
	onDownload,
	onSelect,
	onDelete,
	onRetry
}: Props) {
	const [confirmId, setConfirmId] = useState<string | null>(null)
	const [busyId, setBusyId] = useState<string | null>(null)
	const [failure, setFailure] = useState<{ id: string; message: string } | null>(null)
	const [deleteToken, setDeleteToken] = useState('')

	if (state === 'loading') {
		return (
			<div className="panel__body" aria-busy="true">
				<div className="skeleton" style={{ width: '62%' }} />
				<div className="skeleton" style={{ width: '48%' }} />
				<div className="skeleton" style={{ width: '55%' }} />
			</div>
		)
	}

	if (state === 'error') {
		return (
			<div className="panel__body">
				<p className="alert alert--error" role="alert">
					{error ?? '文件库读取失败'}
				</p>
				<p style={{ marginTop: 'var(--space-3)' }}>
					<button type="button" className="btn btn--ghost btn--sm" onClick={onRetry}>
						重新加载
					</button>
				</p>
			</div>
		)
	}

	if (items.length === 0) {
		return (
			<div className="empty">
				<p className="empty__title">文件库是空的</p>
				<p className="empty__hint">用上面的区域上传第一个压缩包，它会出现在这里。</p>
			</div>
		)
	}

	async function remove(id: string) {
		setBusyId(id)
		setFailure(null)
		try {
			await onDelete(id, deleteToken)
			setConfirmId(null)
		} catch (error) {
			setFailure({ id, message: messageOf(error) })
		} finally {
			setBusyId(null)
		}
	}

	return (
		<ul className="list">
			{items.map((item) => {
				const selected = item.id === selectedId
				const confirming = confirmId === item.id
				const busy = busyId === item.id
				const originalUrl = api.originalUrl(item.id)

				return (
					<li key={item.id} className={`row${selected ? ' is-selected' : ''}`}>
						<button
							type="button"
							className="row__main"
							aria-pressed={selected}
							onClick={() => onSelect(item.id)}
						>
							<span className="row__name">{item.name}</span>
							<span className="row__meta">
								<span className={`badge${item.kind === 'zip' ? ' badge--zip' : ''}`}>
									{item.kind === 'zip' ? 'ZIP' : 'FILE'}
								</span>
								<span>{item.kind === 'zip' ? `${item.entryCount} 个文件` : '单文件'}</span>
								<span>·</span>
								<span>{formatBytes(item.size)}</span>
								<span>·</span>
								<span>{formatDateTime(item.uploadedAt)}</span>
							</span>
						</button>

						<div className="row__actions">
							{confirming ? (
								<>
									<input
										className="input input--token"
										type="password"
										value={deleteToken}
										placeholder="删除口令"
										aria-label="删除口令"
										autoFocus
										disabled={busy}
										onChange={(event) => setDeleteToken(event.target.value)}
										onKeyDown={(event) => {
											if (event.key === 'Enter') void remove(item.id)
										}}
									/>
									<button
										type="button"
										className="btn btn--danger btn--sm"
										data-state={busy ? 'loading' : undefined}
										disabled={busy}
										onClick={() => void remove(item.id)}
									>
										{busy ? '删除中…' : '确认删除'}
									</button>
									<button
										type="button"
										className="btn btn--ghost btn--sm"
										disabled={busy}
										onClick={() => setConfirmId(null)}
									>
										取消
									</button>
								</>
							) : (
								<>
									<a
										className="btn btn--ghost btn--sm"
										href={downloadHref(originalUrl)}
										onClick={(event) => onDownload(event, originalUrl)}
										download
									>
										下载
									</a>
									<button
										type="button"
										className="btn btn--ghost btn--sm btn--danger"
										disabled={deleteProtected === false}
										title={
											deleteProtected === false
												? '服务端未配置 DELETE_TOKEN，删除功能已关闭'
												: undefined
										}
										onClick={() => {
											setFailure(null)
											setConfirmId(item.id)
										}}
									>
										删除
									</button>
								</>
							)}
						</div>

						{failure?.id === item.id && (
							<p className="alert alert--error" role="alert">
								{failure.message}
							</p>
						)}
					</li>
				)
			})}
		</ul>
	)
}
