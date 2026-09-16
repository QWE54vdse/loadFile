import { useRef, useState, type DragEvent } from 'react'
import { messageOf, uploadArchive, type ArchiveSummary } from '../api'
import { formatBytes, formatPercent } from '../lib/format'

type Phase = 'idle' | 'uploading' | 'success' | 'error'

type Props = {
	maxUploadBytes?: number
	onUploaded: (archive: ArchiveSummary) => void
}

export default function UploadPanel({ maxUploadBytes, onUploaded }: Props) {
	const inputRef = useRef<HTMLInputElement>(null)
	const abortRef = useRef<AbortController | null>(null)
	const dragDepth = useRef(0)

	const [dragging, setDragging] = useState(false)
	const [phase, setPhase] = useState<Phase>('idle')
	const [ratio, setRatio] = useState(0)
	const [message, setMessage] = useState<string | null>(null)
	const [fileName, setFileName] = useState<string | null>(null)

	async function send(file: File) {
		const controller = new AbortController()
		abortRef.current = controller
		setPhase('uploading')
		setRatio(0)
		setMessage(null)
		setFileName(file.name)

		try {
			const archive = await uploadArchive(file, {
				signal: controller.signal,
				onProgress: setRatio
			})
			setPhase('success')
			setMessage(
				archive.kind === 'zip'
					? `已接收 ${archive.name}，解出 ${archive.entryCount} 个文件`
					: `已接收 ${archive.name}（单文件，原样保存）`
			)
			onUploaded(archive)
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') {
				setPhase('idle')
				setMessage('已取消上传')
			} else {
				setPhase('error')
				setMessage(messageOf(error))
			}
		} finally {
			abortRef.current = null
			if (inputRef.current) inputRef.current.value = ''
		}
	}

	function handleDragEnter(event: DragEvent<HTMLDivElement>) {
		event.preventDefault()
		dragDepth.current += 1
		setDragging(true)
	}

	function handleDragLeave(event: DragEvent<HTMLDivElement>) {
		event.preventDefault()
		dragDepth.current -= 1
		if (dragDepth.current <= 0) {
			dragDepth.current = 0
			setDragging(false)
		}
	}

	function handleDrop(event: DragEvent<HTMLDivElement>) {
		event.preventDefault()
		dragDepth.current = 0
		setDragging(false)
		if (phase === 'uploading') return
		const file = event.dataTransfer.files.item(0)
		if (file) void send(file)
	}

	const uploading = phase === 'uploading'

	return (
		<div
			className={`drop${dragging ? ' is-active' : ''}`}
			onDragEnter={handleDragEnter}
			onDragOver={(event) => event.preventDefault()}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
		>
			<input
				ref={inputRef}
				className="visually-hidden"
				type="file"
				tabIndex={-1}
				onChange={(event) => {
					const file = event.target.files?.item(0)
					if (file) void send(file)
				}}
			/>

			<p className="drop__title">{dragging ? '松手即上传' : '把压缩包拖到这里'}</p>

			<div className="statusline">
				<button
					type="button"
					className="btn btn--primary"
					data-state={phase}
					disabled={uploading}
					onClick={() => inputRef.current?.click()}
				>
					{uploading ? '上传中…' : '选择文件'}
				</button>
				{uploading && (
					<button
						type="button"
						className="btn btn--ghost btn--sm"
						onClick={() => abortRef.current?.abort()}
					>
						取消
					</button>
				)}
			</div>

			{uploading && (
				<>
					<div
						className="progress"
						role="progressbar"
						aria-label="上传进度"
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={Math.round(ratio * 100)}
					>
						<div className="progress__bar" style={{ transform: `scaleX(${ratio})` }} />
					</div>
					<p className="drop__hint mono">
						{fileName} · {formatPercent(ratio)}
					</p>
				</>
			)}

			{message && (
				<p
					className={`alert ${phase === 'error' ? 'alert--error' : 'alert--success'}`}
					role={phase === 'error' ? 'alert' : 'status'}
				>
					{message}
				</p>
			)}

			<p className="drop__hint">
				.zip 自动解包，可在右侧浏览并单独下载包内文件；其他格式原样保存，支持整包下载与断点续传
				{maxUploadBytes ? ` · 单文件上限 ${formatBytes(maxUploadBytes)}` : ''}
			</p>
		</div>
	)
}
