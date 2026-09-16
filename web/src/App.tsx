import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import {
	api,
	messageOf,
	probeDownload,
	withDownloadToken,
	type Archive,
	type ArchiveSummary,
	type Health
} from './api'
import ArchiveList from './components/ArchiveList'
import FileTree from './components/FileTree'
import UploadPanel from './components/UploadPanel'
import { formatBytes, formatDateTime } from './lib/format'

type LoadState = 'loading' | 'ready' | 'error'
type HealthState = 'checking' | 'online' | 'offline'


/** How often the page re-probes a backend it considers offline. */
const OFFLINE_POLL_MS = 5000

export default function App() {
	const [health, setHealth] = useState<Health | null>(null)
	const [healthState, setHealthState] = useState<HealthState>('checking')
	const wasOffline = useRef(false)
	const [items, setItems] = useState<ArchiveSummary[]>([])
	const [listState, setListState] = useState<LoadState>('loading')
	const [listError, setListError] = useState<string | null>(null)

	const [selectedId, setSelectedId] = useState<string | null>(null)
	const [detailNonce, setDetailNonce] = useState(0)
	const [detail, setDetail] = useState<Archive | null>(null)
	const [detailState, setDetailState] = useState<'idle' | LoadState>('idle')
	const [detailError, setDetailError] = useState<string | null>(null)

	const [downloadToken, setDownloadToken] = useState('')
	const [pendingDownload, setPendingDownload] = useState<string | null>(null)
	const [downloadInput, setDownloadInput] = useState('')
	const [downloadError, setDownloadError] = useState<string | null>(null)
	const [downloadBusy, setDownloadBusy] = useState(false)

	const loadList = useCallback(async () => {
		setListState('loading')
		setListError(null)
		try {
			const { items: loaded } = await api.list()
			setItems(loaded)
			setListState('ready')
		} catch (error) {
			setListError(messageOf(error))
			setListState('error')
		}
	}, [])

	useEffect(() => {
		void loadList()
	}, [loadList])

	const checkHealth = useCallback(async () => {
		try {
			const result = await api.health()
			setHealth(result)
			setHealthState('online')
			if (wasOffline.current) {
				wasOffline.current = false
				void loadList()
			}
		} catch {
			setHealth(null)
			setHealthState('offline')
			wasOffline.current = true
		}
	}, [loadList])

	useEffect(() => {
		void checkHealth()
	}, [checkHealth])

	useEffect(() => {
		if (healthState !== 'offline') return
		const timer = setInterval(() => void checkHealth(), OFFLINE_POLL_MS)
		return () => clearInterval(timer)
	}, [healthState, checkHealth])

	useEffect(() => {
		if (selectedId === null) {
			setDetail(null)
			setDetailState('idle')
			setDetailError(null)
			return
		}

		let active = true
		setDetailState('loading')
		setDetailError(null)

		api
			.detail(selectedId)
			.then((archive) => {
				if (!active) return
				setDetail(archive)
				setDetailState('ready')
			})
			.catch((error: unknown) => {
				if (!active) return
				setDetail(null)
				setDetailError(messageOf(error))
				setDetailState('error')
			})

		return () => {
			active = false
		}
	}, [selectedId, detailNonce])

	const handleUploaded = useCallback((archive: ArchiveSummary) => {
		setItems((current) => [archive, ...current.filter((item) => item.id !== archive.id)])
		setListState('ready')
		setSelectedId(archive.id)
	}, [])

	const handleDelete = useCallback(async (id: string, deleteToken: string) => {
		await api.remove(id, deleteToken)
		setItems((current) => current.filter((item) => item.id !== id))
		setSelectedId((current) => (current === id ? null : current))
	}, [])

	const downloadProtected = health?.downloadProtected ?? false

	/** Adds the validated token to plain download links; a no-op while downloads are open. */
	const downloadHref = useCallback(
		(raw: string) => (downloadToken ? withDownloadToken(raw, downloadToken) : raw),
		[downloadToken]
	)

	const handleDownloadClick = useCallback(
		(event: MouseEvent<HTMLAnchorElement>, raw: string) => {
			if (downloadProtected && !downloadToken) {
				event.preventDefault()
				setPendingDownload(raw)
				setDownloadInput('')
				setDownloadError(null)
			}
		},
		[downloadProtected, downloadToken]
	)

	const submitDownload = useCallback(async () => {
		if (!pendingDownload) return
		setDownloadBusy(true)
		setDownloadError(null)
		try {
			await probeDownload(pendingDownload, downloadInput)
			setDownloadToken(downloadInput)
			setPendingDownload(null)
			window.location.href = withDownloadToken(pendingDownload, downloadInput)
		} catch (error) {
			setDownloadError(messageOf(error))
		} finally {
			setDownloadBusy(false)
		}
	}, [pendingDownload, downloadInput])

	const totalBytes = useMemo(() => items.reduce((sum, item) => sum + item.size, 0), [items])

	return (
		<div className="shell">
			<header className="topbar">
				<div className="brand">
					<span className="brand__mark" aria-hidden="true">
						AD
					</span>
					<span>
						<span className="brand__name">软件部门考核</span>
						<span className="brand__tag"> · 上传代码压缩包</span>
					</span>
				</div>
				<div className="topbar__stats" aria-live="polite">
					{listState === 'ready'
						? `${items.length} 个包 · 共 ${formatBytes(totalBytes)}`
						: '读取文件库…'}
				</div>
			</header>

			{healthState === 'offline' && (
				<div className="banner" role="alert">
					<p className="banner__text">
						无法连接后端服务：页面可以打开，但上传和下载不可用。请在本机启动后端
						（<span className="mono">bun run start</span>），隧道开通后点「重试」。
					</p>
					<button type="button" className="btn btn--ghost btn--sm" onClick={() => void checkHealth()}>
						重试
					</button>
				</div>
			)}

			<main className="workspace">
				<div className="stack">
					<section className="panel" aria-labelledby="upload-title">
						<div className="panel__head">
							<h2 className="panel__title" id="upload-title">
								上传
							</h2>
							{health && (
								<span className="panel__count">
									单文件 ≤ {formatBytes(health.limits.maxUploadBytes)}
								</span>
							)}
						</div>
						<div className="panel__body">
							<UploadPanel
								maxUploadBytes={health?.limits.maxUploadBytes}
								onUploaded={handleUploaded}
							/>
						</div>
					</section>

					<section className="panel" aria-labelledby="library-title">
						<div className="panel__head">
							<h2 className="panel__title" id="library-title">
								文件库
							</h2>
							<button
								type="button"
								className="btn btn--ghost btn--sm"
								onClick={() => void loadList()}
							>
								刷新
							</button>
						</div>
						<ArchiveList
							items={items}
							state={listState}
							error={listError}
							selectedId={selectedId}
							deleteProtected={health?.deleteProtected}
							downloadHref={downloadHref}
							onDownload={handleDownloadClick}
							onSelect={setSelectedId}
							onDelete={handleDelete}
							onRetry={() => void loadList()}
						/>
					</section>
				</div>

				<section className="panel" aria-labelledby="detail-title">
					<div className="panel__head">
						<h2 className="panel__title" id="detail-title">
							包内文件
						</h2>
						{detail && (
							<a
								className="btn btn--ghost btn--sm"
								href={downloadHref(api.originalUrl(detail.id))}
								onClick={(event) => handleDownloadClick(event, api.originalUrl(detail.id))}
								download
							>
								下载原包
							</a>
						)}
					</div>
					<div className="panel__body">
						<DetailPanel
							archive={detail}
							state={detailState}
							error={detailError}
							downloadHref={downloadHref}
							onDownload={handleDownloadClick}
							onRetry={() => setDetailNonce((value) => value + 1)}
						/>
					</div>
				</section>
			</main>

			{pendingDownload && (
				<div className="modal">
					<div
						className="modal__panel"
						role="dialog"
						aria-modal="true"
						aria-labelledby="download-prompt-title"
					>
						<h2 className="modal__title" id="download-prompt-title">
							下载口令
						</h2>
						<p className="modal__hint">这个站点需要口令才能下载文件。</p>
						<form
							className="modal__form"
							onSubmit={(event) => {
								event.preventDefault()
								void submitDownload()
							}}
						>
							<input
								className="input modal__input"
								type="password"
								value={downloadInput}
								placeholder="下载口令"
								aria-label="下载口令"
								autoFocus
								disabled={downloadBusy}
								onChange={(event) => setDownloadInput(event.target.value)}
							/>
							{downloadError && (
								<p className="alert alert--error" role="alert">
									{downloadError}
								</p>
							)}
							<div className="modal__actions">
								<button type="submit" className="btn btn--primary" disabled={downloadBusy}>
									{downloadBusy ? '验证中…' : '下载'}
								</button>
								<button
									type="button"
									className="btn btn--ghost"
									disabled={downloadBusy}
									onClick={() => setPendingDownload(null)}
								>
									取消
								</button>
							</div>
						</form>
					</div>
				</div>
			)}
		</div>
	)
}

function DetailPanel({
	archive,
	state,
	error,
	downloadHref,
	onDownload,
	onRetry
}: {
	archive: Archive | null
	state: 'idle' | LoadState
	error: string | null
	downloadHref: (raw: string) => string
	onDownload: (event: MouseEvent<HTMLAnchorElement>, raw: string) => void
	onRetry: () => void
}) {
	if (state === 'idle') {
		return (
			<div className="empty">
				<p className="empty__title">没有选中任何包</p>
				<p className="empty__hint">点击左侧文件库里的一项，这里会列出包内结构。</p>
			</div>
		)
	}

	if (state === 'loading') {
		return (
			<div aria-busy="true">
				<div className="skeleton" style={{ width: '45%' }} />
				<div className="skeleton" style={{ width: '70%' }} />
				<div className="skeleton" style={{ width: '58%' }} />
			</div>
		)
	}

	if (state === 'error' || !archive) {
		return (
			<>
				<p className="alert alert--error" role="alert">
					{error ?? '读取失败'}
				</p>
				<p style={{ marginTop: 'var(--space-3)' }}>
					<button type="button" className="btn btn--ghost btn--sm" onClick={onRetry}>
						重试
					</button>
				</p>
			</>
		)
	}

	return (
		<>
			<dl className="meta">
				<div className="meta__item">
					<dt className="meta__label">文件</dt>
					<dd className="meta__value" style={{ margin: 0 }}>
						{archive.name}
					</dd>
				</div>
				<div className="meta__item">
					<dt className="meta__label">大小</dt>
					<dd className="meta__value" style={{ margin: 0 }}>
						{formatBytes(archive.size)}
					</dd>
				</div>
				<div className="meta__item">
					<dt className="meta__label">上传时间</dt>
					<dd className="meta__value" style={{ margin: 0 }}>
						{formatDateTime(archive.uploadedAt)}
					</dd>
				</div>
				<div className="meta__item">
					<dt className="meta__label">包内文件</dt>
					<dd className="meta__value" style={{ margin: 0 }}>
						{archive.kind === 'zip' ? `${archive.entryCount} 个` : '—'}
					</dd>
				</div>
				{archive.kind === 'zip' && (
					<div className="meta__item">
						<dt className="meta__label">解压后</dt>
						<dd className="meta__value" style={{ margin: 0 }}>
							{formatBytes(archive.extractedBytes)}
						</dd>
					</div>
				)}
			</dl>

			{archive.kind !== 'zip' ? (
				<p className="alert">
					这不是 zip 压缩包，服务端按普通文件保存，直接下载原文件即可。
				</p>
			) : (
				<>
					{archive.skippedEntries > 0 && (
						<p className="alert alert--warn" role="status">
							已跳过 {archive.skippedEntries} 个条目（目录项、非法路径或不支持的压缩方式）。
						</p>
					)}
					<div style={{ marginTop: archive.skippedEntries > 0 ? 'var(--space-4)' : 0 }}>
						<FileTree archive={archive} downloadHref={downloadHref} onDownload={onDownload} />
					</div>
				</>
			)}
		</>
	)
}
