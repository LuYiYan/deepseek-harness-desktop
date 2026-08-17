# @deepseek-ai/dsh-client-ui-command-palette

English | [中文](README.zh.md)

Command palette UI plugin: its browser half registers a floating ⌘ trigger in the frame-wide `shell.overlay` slot. Clicking it opens a centered, filterable command list; running a command or clicking the backdrop closes it. Its host half is empty on purpose — the palette owns no host tool, service, or durable state; every command reaches an existing client service (`layout`, `workspaces`, `theme`) through that package's Context merge.

Commands are grouped into three sections — layout (toggle sidebar, open/close the details panel), session & workspace (new session, add a workspace folder through the native directory picker), and theme (light / dark / follow system). The filter matches case-insensitively on the command label. Command failures are swallowed: a launcher must never surface an error to the model.

All colors come from the shared `--dsw-alias-*` theme tokens, so the overlay follows the active theme and its light/dark scheme.

## Model Experience

No model-visible effect: the palette is presentation-only and reads/writes no session state.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- **No keyboard shortcut** — the palette opens through the floating trigger only; a global Ctrl+K binding is deferred until a keyboard-shortcut seat exists.
- **Copy is hardcoded Chinese** — the trigger label and command labels are literals rather than locale dictionaries; i18n is deferred.
