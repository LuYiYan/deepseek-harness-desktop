/**
 * Task workbench plugin, browser half: registers the "任务" conversation view
 * tab. Export discipline: packages/client/AGENTS.md — only the apply/inject
 * face leaves the package.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (the conversation.view entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { TaskBoardView } from './TaskBoardView.tsx'

/** Required services: the slot registry. */
export const inject = ['slots']

/**
 * Client plugin body: register the task-board view tab.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.view', () => ctx.slots.register(
    { name: 'conversation.view', id: 'tasks', order: 20, label: () => '任务' },
    TaskBoardView,
  ))
}
