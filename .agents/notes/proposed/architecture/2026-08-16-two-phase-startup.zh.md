# Agent Note: 桌面端 Web 后端的两阶段启动

Status: proposed

[English](2026-08-16-two-phase-startup.md) | 中文

## 问题

即便去除了 Defender 扫描成本，桌面端后端在窗口能离开启动画面之前，仍要冷启动整个 web profile。Loader（`vendor/loader` 的 `Entry._init`）会急切地 `import()` 每一个启用的 entry，再按依赖顺序激活；目前没有懒加载或分阶段的 entry 概念。可选的宿主子系统——会话遥测、LLM 标题生成、subagent 后端、workflow worker、网络搜索、ralph、上下文压缩——在 webserver 绑定之前就付出了完整的 import 加 apply 成本，于是 UI 在等待首次页面加载根本用不到的工作。

## 提案

给 loader entry 增加启动阶段，使后端无需急切加载每一行即可到达可服务状态：

1. **Loader**：为 entry 增加 `phase` 字段（`critical` | `background`，默认 `critical`）。`critical` entry 按现状导入并激活；`background` entry 仅在树报告就绪之后（或首次 `ctx.get` 时，实现阶段选定）才导入并应用。销毁/HMR/回滚仍然处置每一个 entry，无论是否被延迟。
2. **组合**：base/web bundle 将服务路径标记为 `critical`——`llm`、`session`、`typert`/`typert-loader`/`typert-gateway`、`tools`、`settings`、`credentials`、`sandbox`、`sandbox-policy`、`pwsh-sandbox`、`approval`、`permission`、`shell-env`、`fs-sandbox`、`agent`/`agent-loop`/`agent-default-model`、`session-persistence-jsonl`、`session-projection`、`webserver`、`api-gateway`、`web-startup`、`web-runtime`、`modules`、`connection` 以及客户端清单——其余标记为 `background`：`session-telemetry-otel`、`session-title-llm`、`subagent-spawn-in-process`、`subagent-fork-in-process`、`workflow-worker-thread`、`web-search-deepseek`、`tool-ralph`、`compaction-basic`、`command-compact`、`tool-result-pruner`。

这样桌面外壳在 webserver 绑定（阶段 1）后立即切出启动画面，阶段 2 在后台完成；需要后台服务的首个请求会等待它，因为 Loader 已按服务可用性解析注入。

## 曾考虑的替代方案

- **按 entry 做 `ctx.get` 懒加载（不做阶段划分）。** 粒度更细，但 Loader 必须在首次读取服务时导入、并把服务归因到 entry——对注入拓扑、HMR 和回滚的改动大于阶段边界。弃用，改用更粗、更安全的阶段划分。
- **保持急切加载，只交付 Defender 排除项。** 对今天实测的 I/O 主导启动是正确之举（扫描占大头）；本提案针对扫描消除之后剩余的秒数，并建立在[桌面端首次启动 Defender 排除项](../../implemented/feature/2026-08-16-desktop-first-run-defender-exclusions.md)之上。

## 验收标准

- 打包构建在不导入仅后台 entry 的情况下到达服务就绪信号，且 `dsh web` 启动会记录哪些 entry 被延迟。
- 延迟遥测、标题 LLM、subagent、workflow、网络搜索、ralph 与压缩后，首个请求到达时无可观察变化：会话可解析，首个模型轮次能加载 agent 预设，需要后台服务的工具会等待它而不暴露「服务不可用」。
- 销毁与 HMR 会处置每一个被延迟的 entry；`webStartup`/`webRuntime` 保持为阶段 1。

## 风险

- 阶段划分不得改变注入语义：`background` entry 不能在其 `critical` 服务存在之前注入它，而依赖 `background` 服务的 `critical` entry 必须显式声明该依赖。
- 改动位于 `vendor/loader`（vendored Cordis），因此要承担 `vendor/README.md` 要求的 vendored 差异登记与上游同步开销。
- 延迟 subagent/workflow 后端会推迟其提供方注册；加载后立即打开 subagent 或 workflow 的会话必须等待阶段 2，且不能出现用户可见的失败。
