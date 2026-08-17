# Agent Note: 桌面端首次启动的 Windows Defender 排除项

Status: implemented

[English](2026-08-16-desktop-first-run-defender-exclusions.md) | 中文

## 问题

打包后的 Windows 桌面应用每次启动都要冷启动整个 web profile：被拉起的 `node.exe …/bin.js web` 进程会 import Cordis 插件树及其 ESM 模块图（1.3 万+ 文件）。在开启 Windows Defender 实时保护时，Defender 会重新扫描后端读取的每一个模块文件，因此首次启动被杀毒 I/O 主导——墙钟几十秒、CPU 却只有几秒——而非被插件激活本身主导。启动路径早已在注释里写明这一情况（「冷盘或杀毒扫描下会慢」），并给了两分钟的等待窗口，但始终没有消除扫描成本。

## 决策

`apps/desktop/src/main.cjs` 新增 `maybeInstallDefenderExclusions()`，在 `createWindow()` 中、`startHarnessServer()` 之前以「即发即忘」方式调用，与后端启动并行、绝不阻塞。仅在打包后的 Windows 构建首次启动时，它：

- 先写入标记文件（`$userData/.defender-exclusions-attempted`），因此即使用户拒绝也不会再次弹窗；
- 构造一条 PowerShell 脚本，添加四条 `Add-MpPreference` 条目——安装目录（`path.dirname(process.resourcesPath)`）、每用户 harness 目录（`app.getPath("userData")`）、`DeepSeek Harness.exe`、`resources/node/node.exe`；
- 通过 `Start-Process powershell -Verb RunAs` 以提升权限运行，脚本以 UTF-16LE 的 `-EncodedCommand`（base64）传递，从而提升时的参数再解析不会破坏路径。

非 Windows 与开发态（`!app.isPackaged`）为无操作；任何失败（拒绝 UAC、缺少 `powershell.exe`、spawn 报错）都不影响启动。`Add-MpPreference` 幂等。

## 曾考虑的替代方案

- **在 NSIS 安装器中加排除项（`nsis.include`）。** 安装时弹一次 UAC，但当前构建是 `perMachine: false`（不提升权限），而 `Add-MpPreference` 需要管理员；要支持它就得改成 `perMachine: true` 或自定义提升权限的 NSIS 辅助脚本——改动更大、风险更高。弃用，改由运行时钩子实现，它还能拿到每用户的 `$userData` 路径。
- **缩减 import 图（延迟加载可选插件）。** 能减少被扫描的文件数，但每个文件的扫描成本仍在，治不好实测的 I/O 主导启动；这是独立且更长期的工作，见[两阶段启动提案](../../proposed/architecture/2026-08-16-two-phase-startup.md)。
- **预热 OS 文件缓存。** 收益有限：冷启动成本由每个文件的 Defender 扫描主导，而非缓存未命中。

## 后果

- Windows 首次启动会弹一次 UAC 确认框；之后的启动静默且更快。
- 标记记录的是「已尝试」而非「已生效」：读取排除项需要管理员权限，非提升的父进程无法验证成功，也不会在用户拒绝后再次弹窗。
- 改动仅限桌面外壳；harness 组合、Loader 与运行时均未改动。
- `apps/desktop` 没有针对 Electron 主进程的自动化测试脚手架；该改动做语法检查后手动验证（一次性 UAC 弹窗，随后启动变快）。
