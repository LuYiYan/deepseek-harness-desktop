/**
 * Floating file explorer: a bottom-right 📂 trigger opening a panel that lists
 * files and directories through the Host's `workspaces.listPath` capability.
 * Directories navigate (with an up-stack), files open in the OS default app.
 * Pure presentation over the workspaces service; zero business state.
 */
import { useEffect, useState, type ReactElement } from 'react'
import type { IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'
import styles from './FileExplorer.module.css'

/** The single command target, passed from apply's service Context. */
export interface FileExplorerProps {
  workspaces: IWorkspaces
}

/** A listed child, structurally mirroring the wire PathEntry. */
interface PathEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
}

/** Explorer UI state: current level plus the navigation up-stack. */
interface ExplorerState {
  path: string | null
  entries: PathEntry[] | null
  loading: boolean
  error: string | null
  history: string[]
}

/** Human byte size for a file row; blank for unknown sizes. */
function fmtBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** The file explorer body: a trigger button, then the navigable listing panel. */
export function FileExplorer({ workspaces }: FileExplorerProps): ReactElement {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<ExplorerState>({ path: null, entries: null, loading: false, error: null, history: [] })

  const load = (dir?: string, pushCurrent = false): void => {
    setState(s => ({ ...s, loading: true, error: null }))
    void workspaces.listPath(dir).then((listing) => {
      setState(s => ({
        ...s,
        loading: false,
        path: listing.path,
        entries: listing.entries,
        history: pushCurrent && s.path !== null ? [...s.history, s.path] : s.history,
      }))
    }).catch((error: unknown) => {
      setState(s => ({ ...s, loading: false, error: error instanceof Error ? error.message : String(error) }))
    })
  }

  // First open lists the Host's home directory (an absent path).
  useEffect(() => {
    if (open && state.path === null) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load is stable per render; only the open edge matters.
  }, [open])

  const up = (): void => {
    if (state.history.length === 0) return
    const parent = state.history[state.history.length - 1]
    setState(s => ({ ...s, history: s.history.slice(0, -1) }))
    load(parent)
  }

  const openFile = (path: string): void => {
    void workspaces.openPath(path).catch(() => {})
  }

  if (!open) {
    return (
      <button type="button" className={styles.trigger} title="文件" aria-label="文件" onClick={() => setOpen(true)}>
        📂
      </button>
    )
  }

  const rows = (state.entries ?? []).slice().sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1
    if (a.type !== 'directory' && b.type === 'directory') return 1
    return a.name.localeCompare(b.name)
  })

  let body
  if (state.loading) {
    body = <div className={styles.empty}>加载中…</div>
  } else if (state.error !== null) {
    body = <div className={styles.empty}>{state.error}</div>
  } else if (rows.length === 0) {
    body = <div className={styles.empty}>空目录</div>
  } else {
    body = rows.map(entry => (
      <button
        key={entry.path}
        type="button"
        className={styles.row}
        title={entry.path}
        onClick={() => (entry.type === 'directory' ? load(entry.path, true) : openFile(entry.path))}
      >
        <span>{entry.type === 'directory' ? '📁' : '📄'}</span>
        <span className={styles.rowName}>{entry.name}</span>
        {entry.type === 'file' ? <span className={styles.rowSize}>{fmtBytes(entry.size)}</span> : null}
      </button>
    ))
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span>文件</span>
        <button type="button" className={styles.close} onClick={() => setOpen(false)}>×</button>
      </div>
      <div className={styles.path}>
        <button type="button" className={styles.up} onClick={up} disabled={state.history.length === 0}>↑</button>
        <span className={styles.pathText} title={state.path ?? ''}>{state.path ?? ''}</span>
      </div>
      <div className={styles.list}>{body}</div>
    </div>
  )
}
