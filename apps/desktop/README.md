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
