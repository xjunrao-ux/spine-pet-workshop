# 开发、测试与源码结构

当前正式版为 v5.3.1。公共 main 和正式标签保存验收快照；本地 dev/v3 留存完整开发历史，不向 public 推送。正式发布使用 squash，避免公开过程记录与私人测试资料。

## 环境与运行

Windows x64，Node.js 24，pnpm 11（packageManager 固定版本见 package.json）。

```powershell
pnpm install --frozen-lockfile
pnpm dev
# 静态构建和运行
pnpm build
pnpm start
```

根目录的“启动桌宠.cmd”运行已构建 dist。公共仓库不附第三方模型/音频，从源码运行前按 [素材目录说明](../public/README.md) 准备本地测试素材。普通使用直接下载 Release EXE。

## 目录职责

| 目录 | 内容 |
| --- | --- |
| src/ | 桌宠、管理器、预览、主题与声明式插件 UI |
| electron/ | 窗口、IPC、物理、系统适配、插件沙盒和受控服务 |
| plugins/todo/ | 内置待办 Provider |
| examples/ | 可独立打包的插件与学习示例 |
| dsh-pet-bridge/ | 可选 DSH 端桥组件、接口与测试，不预装到桌宠进程 |
| public/ark-data/ | 语音分句与台词数据及来源说明 |
| scripts/ | 构建、发布、数据校验及可重跑测试 |
| docs/ | 当前手册、关键接口、版本与验证结果 |
| community/ | 经过校验的固定版本插件下载目录 |

node_modules、dist、release、releases、.local、artifacts 是本地目录，不上传。用户资料始终在 Windows AppData，测试必须用隔离 PET_TEST_PROFILE；不得使用用户的凭据、现有会话或正式待办执行回归。

Windows 任务栏标识由 `electron/window-branding.mjs` 统一设置：安装版沿用安装器固定标识，源码目录、便携入口和测试 Profile 各自隔离。源码启动时会注册本目录专用的“SpinePet 本地版”开始菜单快捷方式；开发通知使用不同的进程标识，避免 Electron 自动生成的无图标入口与窗口匹配。任务栏图标持久保存在当前 userData 的 `shell-icons`，名称随内容变化；测试只写隔离目录。若本地桌面入口失效，可运行 `pnpm desktop:repair`，工具会先备份并校验已有桌宠快捷方式，再同步正确的开始菜单关联。

## 验证命令

```powershell
pnpm test:release
pnpm test:models:ui
pnpm test:ui-themes
pnpm test:deepseek
pnpm test:dsh-pet
node --test scripts/test-plugin-presentation.mjs
pnpm build
pnpm test:manager-layout
pnpm test:companion-ui
pnpm test:ui-main
pnpm test:local-service:sandbox
pnpm test:dsh-pet:sandbox
pnpm community:check
```

bridge 在 DSH 内运行时由宿主提供依赖；全新源码工作区先在根目录安装仅供测试使用的接口包，再运行模拟测试：

```powershell
npm install --prefix dsh-pet-bridge --no-save --package-lock=false --ignore-scripts @deepseek-ai/dsh-llm@0.1.1-rc.2 @deepseek-ai/dsh-agent@0.1.1-rc.2
node --test "dsh-pet-bridge/test/*.test.js"
```

此依赖留在忽略的 node_modules 内，不加入桌宠主程序或桥 TGZ。真实 DSH 测试按桥文档显式配置，默认替身测试不调用收费模型。UI 回归截图位于 .local，只有隔离资料的最终截图进入 docs/images。打包后运行 pnpm test:packaged 和 scripts/Test-ReleaseBinaries.ps1。

## 构建发行包

```powershell
pnpm package:win
pnpm package:weather
pnpm package:codex
pnpm package:deepseek
pnpm package:dsh-pet
pnpm package:hello
```

产物为 release/v5.3.1 下的安装版/便携版，以及 release/plugins 下的插件 ZIP。模型和音频只随本地构建进入二进制，不进入公共 Git 历史。完整公开步骤见 [发布流程](RELEASING.md)。

## 清理与保留

保留正式 EXE、插件 ZIP、校验值、当前版本截图与验证摘要、关键设计和 Git 历史备份。正式快照排除已被实现替代的过程记录；本地清理重复 Electron 测试 Profile 和中间 win-unpacked 副本。原始素材、用户数据、备份与活动工作区不参与自动清理；参见 [v5.1.2 清理记录](CLEANUP_v5.1.2.md)。
