/**
 * apply wiring on a real cordis Context + SlotRegistry: TaskBoardView
 * registered as the `tasks` entry of the conversation view slot, and
 * fiber-teardown unregistration. Component behavior is covered props-direct;
 * no renderer machinery here.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { TaskBoardView } from '../src/client/TaskBoardView.tsx'
import { apply, inject } from '../src/client/index.ts'

describe('apply', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots'])
  })

  it('waits until a live entry declares the view slot, then registers the board', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(ctx.slots.entries('conversation.view')).toHaveLength(0)
    ctx.slots.register(
      { name: 'root', children: { 'conversation.view': { kind: 'list', scope: 'session' } } } as never,
      () => null,
    )
    await Promise.resolve()
    const entry = ctx.slots.entries('conversation.view')[0]!
    expect(entry.component).toBe(TaskBoardView)
    await fiber.dispose()
    expect(ctx.slots.entries('conversation.view')).toHaveLength(0)
  })
})
