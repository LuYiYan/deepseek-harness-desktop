/**
 * Task workbench plugin, node half.
 *
 * Deliberately empty. The board is a pure browser surface: it reads the
 * session's goal/plan/todos projections and renders a task view tab; no host
 * tool, service, or durable state belongs here.
 */

/** Host plugin body — the board owns no host-plane contribution. */
export function apply(): void {}
