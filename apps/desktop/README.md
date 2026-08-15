# DeepSeek Harness Desktop

Electron desktop shell for the DeepSeek Harness web profile.

## Development

```sh
pnpm --filter @deepseek-ai/dsh-desktop start
```

The desktop app starts a local `dsh web` server on a free local port and loads it
inside the Electron window.

## Windows package

```sh
pnpm --filter @deepseek-ai/dsh-desktop dist
```

The installer output is written to `apps/desktop/dist-desktop`.

## First-run configuration

Public builds ship no API key. On first launch the app seeds a per-user
harness home (`%APPDATA%\DeepSeek Harness Desktop`) with the default model
selection, and each user stores their own DeepSeek key in the UI under
**Settings → Models → API key**.

To build a personal installer that embeds the builder's local key (from
`$DSH_HOME/.credentials.yaml`) so it works immediately after install, opt in
explicitly:

```sh
DSH_DESKTOP_BUNDLE_CREDENTIALS=1 pnpm --filter @deepseek-ai/dsh-desktop dist
```
