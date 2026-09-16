import type { ArchiveEntry } from '../api'

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return '—'
	if (bytes < 1024) return `${bytes} B`

	let value = bytes
	let unit = 0
	while (value >= 1024 && unit < UNITS.length - 1) {
		value /= 1024
		unit += 1
	}
	return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${UNITS[unit]}`
}

const dateTime = new Intl.DateTimeFormat('zh-CN', {
	dateStyle: 'medium',
	timeStyle: 'short'
})

export function formatDateTime(iso: string): string {
	const date = new Date(iso)
	return Number.isNaN(date.getTime()) ? '—' : dateTime.format(date)
}

export function formatPercent(ratio: number): string {
	return `${Math.round(Math.min(Math.max(ratio, 0), 1) * 100)}%`
}

export type TreeNode = {
	name: string
	path: string
	size: number | null
	count: number
	children: TreeNode[]
}

function emptyDir(name: string, path: string): TreeNode {
	return { name, path, size: null, count: 0, children: [] }
}

/**
 * Flat `a/b/c.txt` entry paths become a sorted folder tree, directories first.
 */
export function buildTree(entries: ArchiveEntry[]): TreeNode[] {
	const root = emptyDir('', '')
	const dirs = new Map<string, TreeNode>([['', root]])

	for (const entry of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
		const segments = entry.path.split('/').filter((segment) => segment.length > 0)
		if (segments.length === 0) continue

		let parentPath = ''
		for (const segment of segments.slice(0, -1)) {
			const dirPath = parentPath === '' ? segment : `${parentPath}/${segment}`
			let node = dirs.get(dirPath)
			if (!node) {
				node = emptyDir(segment, dirPath)
				dirs.set(dirPath, node)
				dirs.get(parentPath)?.children.push(node)
			}
			parentPath = dirPath
		}

		dirs.get(parentPath)?.children.push({
			name: segments[segments.length - 1] ?? entry.path,
			path: entry.path,
			size: entry.size,
			count: 0,
			children: []
		})
	}

	const sortAndCount = (node: TreeNode): number => {
		node.children.sort((a, b) => {
			const aDir = a.children.length > 0
			const bDir = b.children.length > 0
			if (aDir !== bDir) return aDir ? -1 : 1
			return a.name.localeCompare(b.name)
		})
		let total = 0
		for (const child of node.children) {
			total += child.children.length > 0 ? sortAndCount(child) : 1
		}
		node.count = total
		return total
	}

	sortAndCount(root)
	return root.children
}
