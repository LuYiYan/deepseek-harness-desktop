# Agent Note: 桌面运行时依赖打包解析 pnpm 符号链接

Status: implemented

[English](2026-08-15-desktop-runtime-stages-pnpm-symlink-dependencies.md) | 中文

## Problem

打包后的桌面应用启动失败，提示 `DeepSeek Harness failed to start — Timed out waiting for http://127.0.0.1:<port>`。被拉起的 `dsh web` 服务器在绑定端口前就崩溃了，因为打包产物 `resources/harness/node_modules` 缺少依赖：多次构建中先后出现 `node-pty`、`js-yaml`、`@deepseek-ai/cordis-plugin-timer`、`@deepseek-ai/dsh-app-boot` 的 `ERR_MODULE_NOT_FOUND`。`apps/desktop/scripts/prepare-harness.cjs` 打包运行时的方式是：把工作区复制到临时目录，在其中运行 `pnpm install --ignore-scripts --shamefully-hoist`，再把 `.pnpm` 里的包扁平复制到顶层 `node_modules`。打包步骤存在三个缺陷：`copyPnpmStorePackagesIntoNodeModules` 用 `Dirent.isDirectory()` 判断每个依赖条目，而它对符号链接返回 `false`（pnpm 把 `.pnpm/<pkg>/node_modules/<dep>` 存成符号链接），于是外部依赖被静默跳过；`copyPackage` 遇到 `fs.existsSync(targetDir)` 为真就返回，而 `--shamefully-hoist` 已经写好的顶层符号链接占位符会让它返回真，导致解析后的包内容从未替换掉符号链接；`copyWorkspacePackagesIntoNodeModules` 的 `collectPackages` 在遇到任何含 `package.json` 的目录时就停止递归，于是嵌套工作区成员（`native/landlock-run/packages/*`，含被 `dsh-sandbox-local` 在模块加载时导入的 `@deepseek-ai/node-addon-landlock-run`）从未被打包。最终打包产物里的 `node_modules` 要么保留指向打包机绝对路径的符号链接（在用户机器上悬空），要么干脆缺包。

## Decision

`prepare-harness.cjs` 把每个依赖都以真实文件形式打包。`copyPackage` 用 `fs.lstatSync(targetDir, { throwIfNoEntry: false })` 检查目标：已存在的真实目录视为先前已打包的包并去重；符号链接（或不存在）则删除后改用 `fs.cpSync(fs.realpathSync(sourceDir), targetDir, …)` 复制，先解析源符号链接，让复制过滤器的 `path.relative` 作用在具体目录树上。`copyPnpmStorePackagesIntoNodeModules` 通过新增的 `isDirectory` 辅助函数（内部用 `fs.statSync`，会跟随符号链接）判断目录条目，并把 `@deepseek-ai` 的跳过判断移到 scoped 分支入口。工作区包仍由 `copyWorkspacePackagesIntoNodeModules` 打包，其 `collectPackages` 现在会越过 `package.json` 继续递归（只跳过非成员目录：`node_modules`、`.git`、`.desktop-runtime`、`.desktop-harness`），从而把嵌套工作区成员也一并打包。

## Alternatives considered

**直接用 `dereference` 复制整个工作区 `node_modules`，去掉重新安装。** 拒绝：解引用 `.pnpm` 会把每个依赖引用都展开成完整副本，使安装包体积膨胀，还可能出现版本解析错误——这正是「重新安装 + 扁平化」设计所要避免的。

**在打包产物里保留 pnpm 符号链接。** 拒绝：它们编码的是打包机的绝对路径，安装到别的机器后什么都解析不到——正是本记录所记载的失败模式。

## Consequences

打包后的 harness `node_modules` 顶层是真实文件，应用在任何机器上都能解析依赖树。扁平化现在复制的内容严格多于从前（原先被符号链接跳过的条目现在会被包含），并依赖 `fs.statSync`/`lstatSync`/`realpathSync` 的符号链接语义。该修复是静态的：`prepare-harness.cjs` 在打包机的 Node 下运行，其 `fs` 行为在支持的版本范围内是稳定的。
