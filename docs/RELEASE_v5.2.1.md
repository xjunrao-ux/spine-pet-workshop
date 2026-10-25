# SpinePet v5.2.1

Windows x64 正式版 · 2026-10-25

本版加入 GitHub 正式版检查与下载更新、社区插件独立更新，并提供默认角色语音设置。

## 本版变化

- 新增“角色管理器 → 更新与开发”：安装版检查 GitHub 正式版、后台下载、显示进度与更新说明，点击“重启并安装”后覆盖升级，保留用户角色、插件和配置。
- 默认启动后及每 6 小时检查更新；自动检查、自动下载可关闭。发现新版时提供系统通知及导航提示。便携版可检查版本，并引导到发布页下载。
- 已安装且被社区目录收录的插件可独立检查并确认更新；校验 ZIP SHA-256、身份、权限与兼容性，保留配置、启用状态和独立数据，启动失败恢复旧版。
- 更新页说明如何从 GitHub Release 的 Assets 附件下载插件 ZIP，并到“扩展 → 导入插件 ZIP”安装；提供 GitHub 源码、插件入门、开发手册及社区目录入口。
- “功能 → 应用启动”新增“默认开启角色语音”，自动保存并立即应用，下次启动继续生效。右键“语音与字幕”仍用于本次运行的临时切换。
- 托盘菜单提供“检查更新”。保留原有模型导入、参数、主题、对话输入框与选装插件能力。

## 下载和使用

- `SpinePet-Setup-v5.2.1-x64.exe`：安装版，后续支持应用内覆盖升级。
- `SpinePet-Portable-v5.2.1-x64.exe`：免安装版，后续从发布页下载更新。
- `Weather-Plugin-v1.2.0.zip`、`Codex-Plugin-v1.1.0.zip`、`DeepSeek-Plugin-v1.1.1.zip`、`DSH-Pet-Plugin-v1.1.0.zip`、`Hello-Counter-v1.0.0.zip`：五个选装插件，无需解压，在扩展页导入。
- `local-dsh-pet-bridge-1.0.0.tgz`：可选 DSH 端桥组件，不能作为桌宠插件 ZIP 导入。
- `USAGE-v5.2.1.md`、`SHA256SUMS.txt`：离线使用指南与所有自定义附件的校验值。
- `latest.yml` 与安装包 `.blockmap`：自动更新使用的元数据，普通用户无需手动打开。

**v5.1.3 及更早版本的用户需要先手动安装一次 v5.2.1**，以后安装版可直接检查更新。升级前退出旧实例，安装到原位置；用户数据继续存放在原目录。首次安装插件仍需下载 ZIP，主程序更新不会擅自替换外部插件。

当前仅 Windows x64。插件下载依赖 GitHub 连通性；发布者签名验证、插件市场、账户与跨设备数据同步不在本版范围内。

[完整使用说明](https://github.com/xjunrao-ux/spine-pet-workshop/blob/v5.2.1/docs/versions/v5.2.1.md) · [验证范围](https://github.com/xjunrao-ux/spine-pet-workshop/blob/v5.2.1/docs/VALIDATION_v5.2.1.md)
