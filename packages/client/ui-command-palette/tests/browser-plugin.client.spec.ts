/**
 * apply wiring on a real cordis Context + SlotRegistry: CommandPalette
 * registered as the `quick-commands` entry of the frame `shell.overlay` slot,
 * waiting on the layout/theme/workspaces services, and fiber-teardown
 * unregistration. Component behavior is covered props-direct; no renderer
 * machinery here.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject } from '../src/client/index.ts'

/** Minimal service stubs the palette commands call. */
function provideServices(ctx: Context): void {
  ctx.provide('layout', { toggleSidebar() {}, openDetails() {}, closeDetails() {} })
  ctx.provide('theme', { setTheme() {} })
  ctx.provide('workspaces', {
    startSession() {},
    pickDirectory: async () => null,
    create: async () => ({}),
  })
}

describe('apply', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'layout', 'theme', 'workspaces'])
  })

  it('waits until a live entry declares the overlay slot, then registers the palette', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    provideServices(ctx)
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
