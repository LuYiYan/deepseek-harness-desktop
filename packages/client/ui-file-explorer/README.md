# @deepseek-ai/dsh-client-ui-file-explorer

English | [中文](README.zh.md)

File explorer UI plugin: its browser half registers a floating 📂 trigger in the frame-wide `shell.overlay` slot (stacked above the command-palette trigger). Clicking it opens a panel that lists the current directory level — files and directories together — through the `workspaces.listPath` capability, which the Host's `browse` backend serves from the filesystem (`PathEntry` rows with name, path, type, and size). Its host half is empty on purpose; the explorer owns no host tool or durable state.

Directories navigate: clicking one lists it (the previous path joins the up-stack), and the `↑` button walks back up the stack. Files open with the operating system's default application through `workspaces.openPath`. The first open lists the Host's home directory. Errors and loading states render inline; command failures never surface to the model.

All colors come from the shared `--dsw-alias-*` theme tokens, so the panel follows the active theme.

## Model Experience

No model-visible effect: the explorer is presentation-only and reads/writes no session state.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- **No file preview** — files open in the OS default application; an in-app preview is deferred.
- **No refresh button** — the level reloads by re-entering it; a refresh affordance is deferred.
- **Copy is hardcoded Chinese** — trigger/labels are literals rather than locale dictionaries; i18n is deferred.
