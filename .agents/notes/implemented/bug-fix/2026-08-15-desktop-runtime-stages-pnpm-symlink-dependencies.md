# Agent Note: Desktop runtime dependency staging resolves pnpm symlinks

Status: implemented

English | [中文](2026-08-15-desktop-runtime-stages-pnpm-symlink-dependencies.zh.md)

## Problem

The packaged desktop app failed to start with `DeepSeek Harness failed to start — Timed out waiting for http://127.0.0.1:<port>`. The spawned `dsh web` server crashed before binding because the staged `resources/harness/node_modules` was missing packages: `ERR_MODULE_NOT_FOUND` for `node-pty`, `js-yaml`, `@deepseek-ai/cordis-plugin-timer`, and `@deepseek-ai/dsh-app-boot` across successive builds. `apps/desktop/scripts/prepare-harness.cjs` staged the runtime by copying the workspace into a temp dir, running `pnpm install --ignore-scripts --shamefully-hoist` there, then flattening `.pnpm` packages into the top-level `node_modules`. Three defects defeated the staging: `copyPnpmStorePackagesIntoNodeModules` classified each dependency entry with `Dirent.isDirectory()`, which returns `false` for a symlink (pnpm stores `.pnpm/<pkg>/node_modules/<dep>` as symlinks), so external dependencies were silently skipped; `copyPackage` bailed on `fs.existsSync(targetDir)`, which returns `true` for the hoist placeholder symlink that `--shamefully-hoist` had already written, so the resolved package contents never replaced it; and `copyWorkspacePackagesIntoNodeModules`' `collectPackages` stopped recursing at any directory containing a `package.json`, so nested workspace members (`native/landlock-run/packages/*`, including `@deepseek-ai/node-addon-landlock-run`, which `dsh-sandbox-local` imports at module load) were never staged. The packaged `node_modules` therefore retained symlinks whose targets were absolute paths on the build machine (dangling on the user's machine), or omitted packages entirely.

## Decision

`prepare-harness.cjs` stages every dependency as real files. `copyPackage` inspects the destination with `fs.lstatSync(targetDir, { throwIfNoEntry: false })`: an existing real directory is a previously staged package and is deduplicated; a symlink (or absence) is removed and replaced by `fs.cpSync(fs.realpathSync(sourceDir), targetDir, …)`, resolving the source symlink first so the copy filter's `path.relative` runs against a concrete tree. `copyPnpmStorePackagesIntoNodeModules` classifies directory entries through a new `isDirectory` helper that uses `fs.statSync` (symlink-following), and the `@deepseek-ai` skip moved to the scoped branch's entry point. Workspace packages remain staged by `copyWorkspacePackagesIntoNodeModules`, whose `collectPackages` now recurses past a `package.json` (skipping only non-member trees: `node_modules`, `.git`, `.desktop-runtime`, `.desktop-harness`) so nested workspace members are staged too.

## Alternatives considered

**Copy the whole workspace `node_modules` with `dereference` and drop the reinstall.** Rejected: dereferencing `.pnpm` expands every dependency reference into a full copy, ballooning the package and risking wrong-version resolution, which the reinstall-plus-flatten design exists to avoid.

**Keep the pnpm symlinks in the package.** Rejected: they encode absolute build-machine paths, so the installed app resolves nothing on another machine — the exact failure mode this note records.

## Consequences

The packaged harness `node_modules` top level holds real files, so the app resolves its dependency tree on any machine. The flattening now copies strictly more than before (previously symlink-skipped entries are included) and depends on `fs.statSync`/`lstatSync`/`realpathSync` symlink semantics. The fix is static: `prepare-harness.cjs` runs under the build machine's Node, whose `fs` behavior is version-stable across the supported range.
