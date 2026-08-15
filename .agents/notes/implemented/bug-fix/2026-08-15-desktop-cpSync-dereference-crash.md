# Agent Note: Desktop runtime staging avoids fs.cpSync dereference crash

Status: implemented

English | [中文](2026-08-15-desktop-cpSync-dereference-crash.zh.md)

## Problem

`apps/desktop/scripts/prepare-harness.cjs` staged the runtime with one whole-tree `fs.cpSync(buildDir, deployDir, { recursive: true, dereference: true })`. On Windows this crashed Node with `STATUS_STACK_BUFFER_OVERRUN` (exit `3221226505` / `0xC0000409`) after the source tree was copied but before `node_modules/` landed: dereferencing the `.pnpm` virtual store follows the cyclic peer-dependency junctions (cordis↔include, the api gateway/connection/apiproxy/remotes triples) into unbounded recursion. The crash aborted the process before the per-package integrity fallback could run, so the deployDir held `apps/cli/lib/bin.js` but no dependencies. The sibling note [`2026-08-15-desktop-runtime-stages-pnpm-symlink-dependencies`](2026-08-15-desktop-runtime-stages-pnpm-symlink-dependencies.md) rejected whole-tree dereference for size; this note records that it additionally crashes.

## Decision

`prepare-harness.cjs` stages `node_modules` as real files without dereferencing any junction-bearing tree. `copyPnpmStorePackagesIntoNodeModules` now sources from the reinstall's `buildDir/node_modules/.pnpm` and materializes each external package via `fs.realpathSync` plus a copy whose filter excludes nested `node_modules`, so no junction cycle is ever followed. A new `materializeRemainingWorkspaceLinks` pass resolves the workspace members outside `apps`/`packages`/`vendor`/`native` (website, examples, python/sdk-runtime) the same way, replacing the `linkWorkspacePackages` junctions that otherwise fail the final copy with EPERM. The final `cpSync` runs with `dereference: false` and skips `.pnpm` and every nested `node_modules` outright, and the integrity check no longer counts the intentionally skipped `.pnpm` as missing.

## Alternatives considered

**Whole-tree `dereference: true`.** The prior code; crashes on Windows, not merely balloons.

**Skip `.pnpm` without flattening first.** Leaves the `--shamefully-hoist` top-level junctions dangling once `.pnpm` is dropped.

**Copy with `dereference: false` but no filter.** Fails with `EPERM` when it tries to recreate the remaining workspace-package junctions as symlinks.

## Consequences

Packaging is cycle-safe on Windows. No `dereference` copy is ever run over a tree that contains pnpm junctions; the final deploy tree is fully flat (394 top-level packages) with `.pnpm` and nested `node_modules` absent.
