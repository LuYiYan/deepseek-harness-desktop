/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-command-palette`.
 * @module @deepseek-ai/dsh-client-ui-command-palette/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-command-palette'

/** Cordis companion plugin name. */
export const name = 'client-ui-command-palette-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the palette registers one overlay entry and reads
 * command targets through other packages' services; the registration is an
 * effect owned and observed by the slot registry, not a durable relation this
 * companion can assert.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns The installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
