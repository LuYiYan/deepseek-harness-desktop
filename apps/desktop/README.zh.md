# DeepSeek Harness Desktop

[English](README.md) | 中文

用于 DeepSeek Harness web profile 的 Electron 桌面外壳。安装包将完整 harness（CLI + web 前端 + 生产用 `node_modules`）与一个 Node 运行时一起打包，因此安装后的应用无需在目标机器上装 Node/pnpm 即可运行。

## 开发

```sh
pnpm --filter @deepseek-ai/dsh-desktop start
```

桌面应用会在一个空闲的本地端口启动 `dsh web` 服务器，并把它加载到 Electron 窗口内。

## 构建 Windows 安装包

在仓库根目录执行：

```sh
pnpm install                                        # install workspace deps
pnpm run build                                      # build lib (host+client) + web frontend
pnpm --filter @deepseek-ai/dsh-desktop dist         # stage runtime + build NSIS installer
```

安装包输出到 `apps/desktop/dist-desktop/DeepSeek-Harness-Desktop-Setup-<version>.exe`。

`dist` 会先运行 `prepare-harness`（把运行时组装为真实文件、不保留 pnpm junction），再执行 electron-builder 的 NSIS 目标。这套组装在 Windows 上是环路安全的：它把 `.pnpm` 存储扁平化到顶层 `node_modules`，并且从不对整棵树做 `dereference` 拷贝——那会跟随循环的 peer-dependency junction，使 Node 以 `STATUS_STACK_BUFFER_OVERRUN` 崩溃。

## 首次运行配置

公开构建不内置任何 API key。首次启动时，应用会为每个用户初始化一个 harness 目录（`%APPDATA%\DeepSeek Harness Desktop`）并写入默认模型（`deepseek-v4-flash`），用户随后在 UI 的 **Settings → Models → API key** 中填写自己的 DeepSeek key（并在此选择模型）。

在 Windows 上，首次启动还会（仅一次，通过一次提升权限的 UAC 确认框）提议把安装目录、harness 目录和两个运行时可执行文件加入 Windows Defender 的排除列表，以避免被杀毒扫描主导的冷启动。

若要构建一个「内置本机构建者 key、装完即可用」的个人安装包（来自 `$DSH_HOME/.credentials.yaml`），需显式开启：

```sh
DSH_DESKTOP_BUNDLE_CREDENTIALS=1 pnpm --filter @deepseek-ai/dsh-desktop dist
```

## 发布

推送 `desktop-v*` 标签会触发 [`.github/workflows/desktop-release.yml`](../../.github/workflows/desktop-release.yml)，在 Windows runner 上构建 harness 与 NSIS 安装包，并把安装包作为该标签的 GitHub Release 资产。CI 构建始终是 keyless 的——它从不设置 `DSH_DESKTOP_BUNDLE_CREDENTIALS`。

```sh
git tag desktop-v0.1.0-rc.5.6
git push origin desktop-v0.1.0-rc.5.6
```

## 备注

- NSIS 安装包是一个交互式按用户安装向导：可选择安装目录、创建「开始」菜单（及桌面）快捷方式、注册到「添加或删除程序」，并随应用附带卸载程序。默认的按用户安装位置无需提权。
- 桌面外壳使用 `%APPDATA%\DeepSeek Harness Desktop` 下独立的 `DSH_HOME`，与开发者的 `~/.dsh` 相互独立，因此自定义安装目录不会移动你的会话、设置或凭据。
