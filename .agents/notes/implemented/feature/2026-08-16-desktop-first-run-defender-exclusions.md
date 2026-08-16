# Agent Note: Desktop first-run Windows Defender exclusions

Status: implemented

English | [中文](2026-08-16-desktop-first-run-defender-exclusions.zh.md)

## Problem

The packaged Windows desktop app cold-boots the whole web profile on every launch: the spawned `node.exe …/bin.js web` process imports the Cordis plugin tree and its ESM module graph (13k+ files). With Windows Defender real-time protection enabled, Defender re-scans every module file the backend reads, so first launch is dominated by antivirus I/O — tens of seconds of wall time against only seconds of CPU — rather than by plugin activation itself. The startup path already documented this ("slow on a cold disk or under antivirus scanning") behind a two-minute readiness window, but nothing removed the scan cost.

## Decision

`apps/desktop/src/main.cjs` adds `maybeInstallDefenderExclusions()`, invoked fire-and-forget from `createWindow()` before `startHarnessServer()` so it runs in parallel with the backend boot and never blocks it. On the first launch of a packaged Windows build only, it:

- writes a marker (`$userData/.defender-exclusions-attempted`) before doing anything else, so a declined prompt is never re-raised;
- builds a PowerShell script adding four `Add-MpPreference` entries — the install directory (`path.dirname(process.resourcesPath)`), the per-user harness home (`app.getPath("userData")`), `DeepSeek Harness.exe`, and `resources/node/node.exe`;
- runs it elevated with `Start-Process powershell -Verb RunAs`, passing the script as a UTF-16LE `-EncodedCommand` (base64) so the elevation argument re-parse cannot corrupt paths.

Non-Windows and development (`!app.isPackaged`) runs are no-ops; any failure (declined UAC, missing `powershell.exe`, spawn error) leaves startup unaffected. `Add-MpPreference` is idempotent.

## Alternatives considered

- **Add exclusions in the NSIS installer (`nsis.include`).** One UAC at install time, but the build is `perMachine: false` (non-elevated) and `Add-MpPreference` requires elevation; supporting it needs `perMachine: true` or a custom elevated NSIS helper — larger, riskier changes to install semantics. Rejected in favor of the runtime hook, which also knows the per-user `$userData` path.
- **Reduce the import graph (defer optional plugins).** Shrinks the number of scanned files but leaves the per-file scan cost, so it does not fix the measured I/O-bound startup; that is the separate, longer-term work proposed in [two-phase startup](../../proposed/architecture/2026-08-16-two-phase-startup.md).
- **Pre-warm the OS file cache.** Marginal: the per-file Defender scan, not cache misses, dominates the cold-boot cost.

## Consequences

- First Windows launch shows one UAC prompt; later launches are silent and faster.
- The marker records "attempted", not "applied": reading exclusions requires elevation, so the non-elevated parent cannot verify success and does not re-prompt on decline.
- The change is desktop-shell only; the harness composition, Loader, and runtime are untouched.
- `apps/desktop` has no automated test harness for the Electron main process; the change is syntax-checked and verified manually (one-time UAC prompt, then faster subsequent launches).
