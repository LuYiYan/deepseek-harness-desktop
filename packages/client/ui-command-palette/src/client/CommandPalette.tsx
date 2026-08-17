/**
 * Floating command palette: a bottom-right ⌘ trigger opening a filterable
 * overlay of layout, session/workspace, and theme commands. Pure presentation
 * over the layout/workspaces/theme services; zero business state.
 */
import { useState, type ReactElement } from 'react'
import type { IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client'
import styles from './CommandPalette.module.css'

/** The three command targets, passed from apply's service Context. */
export interface CommandPaletteProps {
  layout: ILayout
  theme: ThemeRuntime
  workspaces: IWorkspaces
}

interface Command {
  label: string
  run: () => void
}

interface CommandSection {
  title: string
  items: Command[]
}

/** Wrap a command so a sync throw or async rejection never surfaces to the model. */
function guard(fn: () => unknown): () => void {
  return () => {
    try {
      const result = fn()
      if (result !== null && typeof result === 'object' && 'then' in result) {
        void (result as Promise<unknown>).catch(() => {})
      }
    } catch {
      // Best-effort launcher: command failures are swallowed.
    }
  }
}

/** The command palette body: a trigger button, then a backdrop + filterable list. */
export function CommandPalette({ layout, theme, workspaces }: CommandPaletteProps): ReactElement {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const sections: CommandSection[] = [
    {
      title: '布局',
      items: [
        { label: '切换侧栏', run: guard(() => layout.toggleSidebar()) },
        { label: '打开详情面板', run: guard(() => layout.openDetails()) },
        { label: '关闭详情面板', run: guard(() => layout.closeDetails()) },
      ],
    },
    {
      title: '会话与工作区',
      items: [
        { label: '新建会话', run: guard(() => workspaces.startSession()) },
        {
          label: '添加工作区文件夹',
          run: guard(async () => {
            const path = await workspaces.pickDirectory()
            if (path) await workspaces.create({ path })
          }),
        },
      ],
    },
    {
      title: '主题',
      items: [
        { label: '浅色', run: guard(() => theme.setTheme('light')) },
        { label: '深色', run: guard(() => theme.setTheme('dark')) },
        { label: '跟随系统', run: guard(() => theme.setTheme('system')) },
      ],
    },
  ]

  if (!open) {
    return (
      <button type="button" className={styles.trigger} title="快捷命令" aria-label="快捷命令" onClick={() => setOpen(true)}>
        ⌘
      </button>
    )
  }

  const q = query.trim().toLowerCase()
  const filtered = sections
    .map(section => ({ ...section, items: section.items.filter(item => item.label.toLowerCase().includes(q)) }))
    .filter(section => section.items.length > 0)

  const close = () => setOpen(false)

  return (
    <div className={styles.backdrop} onClick={close}>
      <div className={styles.panel} onClick={event => event.stopPropagation()}>
        <input
          className={styles.input}
          placeholder="输入以过滤命令…"
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
        <div className={styles.list}>
          {filtered.length === 0 ? (
            <div className={styles.empty}>没有匹配的命令</div>
          ) : (
            filtered.map(section => (
              <div key={section.title}>
                <div className={styles.section}>{section.title}</div>
                {section.items.map(item => (
                  <button
                    key={item.label}
                    type="button"
                    className={styles.item}
                    onClick={() => { item.run(); close() }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
