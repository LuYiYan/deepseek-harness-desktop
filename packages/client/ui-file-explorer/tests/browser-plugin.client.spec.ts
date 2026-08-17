/**
 * apply wiring on a real cordis Context + SlotRegistry: FileExplorer
 * registered as the `file-explorer` entry of the frame `shell.overlay` slot,
 * waiting on the workspaces service, and fiber-teardown unregistration.
 * Component behavior is covered props-direct; no renderer machinery here.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject } from '../src/client/index.ts'

describe('apply', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'workspaces'])
  })

  it('waits until a live entry declares the overlay slot, then registers the explorer', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('workspaces', {
      listPath: async () => ({ path: '/', home: '/', crumbs: [], entries: [], truncated: false }),
      openPath: async () => {},
    })
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(ctx.slots.entries('shell.overlay')).toHaveLength(0)
    ctx.slots.register(
      { name: 'root', children: { 'shell.overlay': { kind: 'list', scope: 'root' } } } as never,
      () => null,
    )
    await Promise.resolve()
    const entry = ctx.slots.entries('shell.overlay')[0]!
    expect(entry.component).toBeTypeOf('function')
    await fiber.dispose()
    expect(ctx.slots.entries('shell.overlay')).toHaveLength(0)
  })
})
