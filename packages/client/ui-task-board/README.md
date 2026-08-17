# @deepseek-ai/dsh-client-ui-task-board

English | [中文](README.zh.md)

Task workbench UI plugin: its browser half registers the "任务" (Tasks) conversation view tab (`conversation.view`, after chat and trajectory). The board presents the session's durable task state as three cards plus a running indicator — the current goal (`goal` projection: objective, phase badge, round counters, blocked reason), plan mode (`plan` projection: enabled/pending), and the todo list (`todos` projection: content plus lifecycle badge). Every value arrives through the standard projection/session seats; the board owns no store, refresh chain, or event listener. Its host half is empty on purpose.

All colors come from the shared `--dsw-alias-*` theme tokens, so the board follows the active theme.

## Model Experience

No model-visible effect: the board is a read-only presentation of existing session projections.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- **Read-only** — the board shows state but offers no mutations; editing the goal or todos stays on the existing `/goal` command and `todo_write` tool.
- **Copy is hardcoded Chinese** — tab label and card copy are literals rather than locale dictionaries; i18n is deferred.
