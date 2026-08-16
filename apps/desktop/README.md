# DeepSeek Harness Desktop

Electron desktop shell for the DeepSeek Harness web profile. The installer bundles
the full harness (CLI + web frontend + production `node_modules`) together with a
Node runtime, so the installed app runs with no Node/pnpm on the target machine.

## Development

```sh
pnpm --filter @deepseek-ai/dsh-desktop start
```

The desktop app starts a local `dsh web` server on a free local port and loads it
inside the Electron window.

## Build the Windows installer

From the repository root:

```sh
pnpm install                                        # install workspace deps
pnpm run build                                      # build lib (host+client) + web frontend
pnpm --filter @deepseek-ai/dsh-desktop dist         # stage runtime + build NSIS installer
```

The installer is written to `apps/desktop/dist-desktop/DeepSeek-Harness-Desktop-Setup-<version>.exe`.

`dist` runs `prepare-harness` (stage the runtime as real files, no pnpm junctions)
and then electron-builder's NSIS target. The staging is cycle-safe on Windows: it
flattens the `.pnpm` store into the top-level `node_modules` and never runs a
whole-tree `dereference` copy, which would follow cyclic peer-dependency junctions
and crash Node with `STATUS_STACK_BUFFER_OVERRUN`.

## First-run configuration

Public builds ship no API key. On first launch the app seeds a per-user harness home
(`%APPDATA%\DeepSeek Harness Desktop`) with the default model (`deepseek-v4-flash`),
and each user stores their own DeepSeek key in the UI under
**Settings → Models → API key** (and picks a model there).

To build a personal installer that embeds the builder's local key (from
`$DSH_HOME/.credentials.yaml`) so it works immediately after install, opt in
explicitly:

```sh
DSH_DESKTOP_BUNDLE_CREDENTIALS=1 pnpm --filter @deepseek-ai/dsh-desktop dist
```

## Release

Pushing a `desktop-v*` tag triggers [`.github/workflows/desktop-release.yml`](../../.github/workflows/desktop-release.yml),
which builds the harness and the NSIS installer on a Windows runner and attaches the
installer to a GitHub Release for that tag. The CI build is always keyless — it never
sets `DSH_DESKTOP_BUNDLE_CREDENTIALS`.

```sh
git tag desktop-v0.1.0-rc.5.6
git push origin desktop-v0.1.0-rc.5.6
```

## Notes

- The one-click NSIS installer is per-user (`%LOCALAPPDATA%\Programs\@deepseek-aidsh-desktop`),
  requires no elevation, and ships an uninstaller alongside the app.
- The desktop shell keeps its own `DSH_HOME` under `%APPDATA%\DeepSeek Harness Desktop`,
  independent of a developer's `~/.dsh`.
