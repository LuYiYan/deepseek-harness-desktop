/**
 * Command palette plugin, node half.
 *
 * Deliberately empty. The command palette is a pure browser surface with no
 * host tool, host service, or durable state: every command it launches reaches
 * an existing client service (layout/theme/workspaces) through its own Context
 * merge, and the floating overlay is registered by the browser half.
 */

/** Host plugin body — the launcher owns no host-plane contribution. */
export function apply(): void {}
