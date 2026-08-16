# Agent Note: Two-phase startup for the desktop web backend

Status: proposed

English | [中文](2026-08-16-two-phase-startup.zh.md)

## Problem

Even after the Defender scan cost is removed, the desktop backend cold-boots the entire web profile before the window can leave its splash screen. The Loader (`vendor/loader` `Entry._init`) eagerly `import()`s every enabled entry and then activates them in dependency order; there is no lazy or phased entry concept. Optional host subsystems — session telemetry, LLM title generation, subagent backends, the workflow worker, web search, ralph, compaction — pay their full import plus apply cost before the webserver binds, so the UI waits on work the first page load does not need.

## Proposal

Add a startup phase to loader entries so the backend reaches a serving state without eagerly loading every row:

1. **Loader**: a `phase` field on entries (`critical` | `background`, default `critical`). `critical` entries import and activate exactly as today; `background` entries are imported and applied only after the tree reports ready (or on first `ctx.get`, chosen during implementation). Disposal/HMR/rollback still dispose every entry, deferred or not.
2. **Composition**: the base/web bundles mark the serving path `critical` — `llm`, `session`, `typert`/`typert-loader`/`typert-gateway`, `tools`, `settings`, `credentials`, `sandbox`, `sandbox-policy`, `pwsh-sandbox`, `approval`, `permission`, `shell-env`, `fs-sandbox`, `agent`/`agent-loop`/`agent-default-model`, `session-persistence-jsonl`, `session-projection`, `webserver`, `api-gateway`, `web-startup`, `web-runtime`, `modules`, `connection`, and the client roster — and mark the rest `background`: `session-telemetry-otel`, `session-title-llm`, `subagent-spawn-in-process`, `subagent-fork-in-process`, `workflow-worker-thread`, `web-search-deepseek`, `tool-ralph`, `compaction-basic`, `command-compact`, `tool-result-pruner`.

The desktop shell then swaps off the splash as soon as the webserver binds (phase 1), and phase 2 completes in the background; a first request that needs a background service awaits it, because the Loader already resolves injection by service availability.

## Alternatives considered

- **Per-entry `ctx.get` lazy loading (no phase split).** Finer-grained, but the Loader must import on first service read and attribute services to entries — a larger change to injection topology, HMR, and rollback than a phase boundary. Rejected in favor of the coarser, safer phase.
- **Keep eager load and only ship the Defender exclusions.** Correct for today's measured I/O-bound startup, where the scan dominates; this proposal targets the remaining seconds after scanning is gone, and builds on [desktop first-run Defender exclusions](../../implemented/feature/2026-08-16-desktop-first-run-defender-exclusions.md).

## Acceptance criteria

- A packaged build reaches its serving ready signal without importing background-only entries, and a `dsh web` boot records which entries were deferred.
- Deferring telemetry, title-llm, subagent, workflow, web-search, ralph, and compaction produces no observable change once the first request arrives: sessions resolve, the first model turn loads the agent preset, and a tool needing a background service awaits it without surfacing "service unavailable".
- Disposal and HMR dispose every deferred entry; `webStartup`/`webRuntime` remain phase 1.

## Risks

- Phase ordering must not change injection semantics: a `background` entry cannot inject a `critical` service before it exists, and a `critical` entry depending on a `background` service must make that dependency explicit.
- The change lives in `vendor/loader` (vendored Cordis), so it carries the vendor divergence-logging and upstream-sync overhead required by `vendor/README.md`.
- Deferring subagent/workflow backends delays their provider registration; a session that opens a subagent or workflow immediately after load must await phase 2 without a user-visible failure.
