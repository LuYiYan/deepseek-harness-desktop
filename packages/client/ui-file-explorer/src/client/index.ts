/**
 * File explorer plugin, browser half: a floating 📂 trigger whose panel lists
 * files and directories through the workspaces service. Export discipline:
 * packages/client/AGENTS.md — only the apply/inject face and the component
 * prop contract leave the package.
 */
import { createElement } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-layout SlotMap augmentation so 'shell.overlay' resolves.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { FileExplorer } from './FileExplorer.tsx'

/** Required services: the slot registry and the workspaces browse face. */
export const inject = ['slots', 'workspaces']

/**
 * Client plugin body: register the floating file explorer into the
 * frame-wide overlay.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'file-explorer', label: '文件' },
    () => createElement(FileExplorer, { workspaces: ctx.workspaces }),
  ))
}
