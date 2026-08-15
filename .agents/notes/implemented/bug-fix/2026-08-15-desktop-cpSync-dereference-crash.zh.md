# Agent Note：桌面运行时打包规避 fs.cpSync dereference 崩溃

Status: implemented

[English](2026-08-15-desktop-cpSync-dereference-crash.md) | 中文

## 问题

`apps/desktop/scripts/prepare-harness.cjs` 曾用一次整树 `fs.cpSync(buildDir, deployDir, { recursive: true, dereference: true })` 打包运行时。在 Windows 上，该调用在拷贝完源码树、尚未落到 `node_modules/` 时就让 Node 以 `STATUS_STACK_BUFFER_OVERRUN`（退出码 `3221226505` / `0xC0000409`）崩溃：解引用 `.pnpm` 虚拟存储会跟随循环 peer-dependency junction（cordis↔include，以及 api 的 gateway/connection/apiproxy/remotes 三件套）陷入无限递归。崩溃发生在逐包完整性回退有机会运行之前，于是 deployDir 里只有 `apps/cli/lib/bin.js` 却没有依赖。姊妹笔记 [`2026-08-15-desktop-runtime-stages-pnpm-symlink-dependencies`](2026-08-15-desktop-runtime-stages-pnpm-symlink-dependencies.md) 曾以体积为由拒绝整树 dereference；本条补充记录它还会崩溃。

## 决策

`prepare-harness.cjs` 将 `node_modules` 以真实文件形式打包，且绝不对任何含 junction 的树做 dereference。`copyPnpmStorePackagesIntoNodeModules` 改为从重新安装产物的 `buildDir/node_modules/.pnpm` 取源，通过 `fs.realpathSync` 加一个排除嵌套 `node_modules` 的拷贝来物化每个外部包，从而绝不跟随 junction 循环。新增的 `materializeRemainingWorkspaceLinks` 用同样方式解析 `apps`/`packages`/`vendor`/`native` 之外的工作区成员（website、examples、python/sdk-runtime），替换掉那些否则会让最终拷贝以 EPERM 失败的 `linkWorkspacePackages` junction。最终 `cpSync` 以 `dereference: false` 运行，并直接跳过 `.pnpm` 与所有嵌套 `node_modules`；完整性检查也不再将被有意跳过的 `.pnpm` 当作缺失。

## 备选方案

**整树 `dereference: true`。** 即原代码；在 Windows 上会崩溃，而不仅是膨胀。

**只跳过 `.pnpm` 而不先 flatten。** 一旦丢弃 `.pnpm`，`--shamefully-hoist` 的顶层 junction 即悬空。

**`dereference: false` 但不过滤。** 当它试图把残余的工作区包 junction 重建为符号链接时，以 `EPERM` 失败。

## 后果

打包在 Windows 上是循环安全的。任何含 pnpm junction 的树都不再经过 dereference 拷贝；最终部署树完全扁平（394 个顶层包），不含 `.pnpm` 与嵌套 `node_modules`。
