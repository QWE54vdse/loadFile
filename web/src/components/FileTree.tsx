import { useMemo, useState, type MouseEvent } from 'react'
import { api, type Archive } from '../api'
import { buildTree, formatBytes, type TreeNode } from '../lib/format'

type DownloadProps = {
	downloadHref: (raw: string) => string
	onDownload: (event: MouseEvent<HTMLAnchorElement>, raw: string) => void
}

/**
 * Directory tree of an extracted zip. Every file links straight to the
 * server's range-capable download endpoint.
 */
export default function FileTree({ archive, downloadHref, onDownload }: { archive: Archive } & DownloadProps) {
	const nodes = useMemo(() => buildTree(archive.entries), [archive.entries])

	if (nodes.length === 0) {
		return <p className="empty__hint">这个包是空的，没有可浏览的文件。</p>
	}

	return (
		<ul className="tree">
			{nodes.map((node) => (
				<TreeNodeView
					key={node.path}
					node={node}
					archiveId={archive.id}
					downloadHref={downloadHref}
					onDownload={onDownload}
				/>
			))}
		</ul>
	)
}

function TreeNodeView({
	node,
	archiveId,
	downloadHref,
	onDownload
}: { node: TreeNode; archiveId: string } & DownloadProps) {
	const [open, setOpen] = useState(true)
	const isDirectory = node.children.length > 0

	if (isDirectory) {
		return (
			<li>
				<div className="tree__row tree__row--dir">
					<button
						type="button"
						className="tree__toggle"
						aria-expanded={open}
						onClick={() => setOpen((value) => !value)}
					>
						<span className="tree__caret" aria-hidden="true">
							{open ? '▾' : '▸'}
						</span>
						<span className="tree__name">{node.name}</span>
					</button>
					<span className="tree__spacer" />
					<span className="tree__size">{node.count} 项</span>
				</div>
				{open && (
					<ul className="tree">
						{node.children.map((child) => (
							<TreeNodeView
								key={child.path}
								node={child}
								archiveId={archiveId}
								downloadHref={downloadHref}
								onDownload={onDownload}
							/>
						))}
					</ul>
				)}
			</li>
		)
	}

	return (
		<li>
			<div className="tree__row">
				<span className="tree__caret" aria-hidden="true">
					·
				</span>
				<span className="tree__name" title={node.path}>
					{node.name}
				</span>
				<span className="tree__spacer" />
				<span className="tree__size">{formatBytes(node.size ?? 0)}</span>
				<a
					className="tree__link"
					href={downloadHref(api.entryUrl(archiveId, node.path))}
					onClick={(event) => onDownload(event, api.entryUrl(archiveId, node.path))}
					download
				>
					下载
				</a>
			</div>
		</li>
	)
}
