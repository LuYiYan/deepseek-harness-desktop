/**
 * Command palette plugin, browser half: a floating ⌘ trigger whose overlay
 * launches layout/session/theme commands through the layout, workspaces, and
 * theme services. Export discipline: packages/client/AGENTS.md — only the
 * apply/inject face and the component prop contract leave the package.
 */
import { createElement } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the layout/theme Context merges so ctx.layout / ctx.theme resolve.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { CommandPalette } from './CommandPalette.tsx'

/** Required services: the slot registry and the three command targets. */
export const inject = ['slots', 'layout', 'theme', 'workspaces']

/**
 * Client plugin body: register the floating command palette into the
 * frame-wide overlay. No business face — each command reaches another
 * package's service through its Context merge.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'quick-commands', label: '快捷命令' },
    () => createElement(CommandPalette, { layout: ctx.layout, theme: ctx.theme, workspaces: ctx.workspaces }),
  ))
}
