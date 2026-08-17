/**
 * File explorer plugin, node half.
 *
 * Deliberately empty. The explorer is a pure browser surface: every listing
 * and open reaches the Host through the runtime's `workspaces` service, and
 * the floating panel is registered by the browser half.
 */

/** Host plugin body — the explorer owns no host-plane contribution. */
export function apply(): void {}
