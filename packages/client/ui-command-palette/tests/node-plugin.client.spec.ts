/**
 * Node half is deliberately empty: mounting it must not register a host
 * service or tool.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

describe('ui-command-palette node plugin', () => {
  it('mounts without providing a host service', async () => {
    const ctx = new Context()
    await ctx.plugin({ apply }).await()
    expect(ctx.get('layout')).toBeUndefined()
    await ctx.fiber.dispose()
  })
})
