# Spine 桌宠工坊 v3.2.2

Windows x64 正式版，发布日期：2026-10-13。新增内置待办与本地 ZIP 插件安装，天气和 Codex 可以按需添加；角色导入、语音、音乐和通知继续保留。本版不提供 AI 对话。

## 下载哪个文件

| 文件 | 用途 |
| --- | --- |
| Spine-Pet-Workshop-Setup-v3.2.2-x64.exe | 安装版，安装后用桌面快捷方式启动 |
| Spine-Pet-Workshop-Portable-v3.2.2-x64.exe | 便携版，放在固定文件夹双击运行，无需开发环境 |
| Weather-Plugin-v1.1.0.zip | 选装天气插件，导入 ZIP 后选择城市 |
| Codex-Plugin-v1.1.0.zip | 选装 Codex 只读信息，需要本机 Codex 已登录且运行 |
| SHA256SUMS.txt | 两个 EXE 与两个插件 ZIP 的 SHA-256 校验值 |
| USAGE-v3.2.2.md | 下载、升级与图文操作说明 |

GitHub 的 Source code.zip 是源码，不是可直接运行的安装包。普通用户不需要 Node.js、pnpm 或 Electron。

## 这次的主要变化

- **内置待办**：新增、备注、截止时间、完成/撤回、删除撤销。右侧只留打勾或撤回，编辑/删除通过右键项目打开。
- **左右翻页**：面板右下角上一页/下一页切换，滚轮只滚动当前页长内容；支持左右方向键、PageUp/PageDown，输入框编辑不触发翻页。
- **天气插件**：城市搜索或经纬度设置，当前天气、未来 24 小时、7 天预报，自动/手动刷新，离线保留缓存，摄氏/华氏切换。入口与预报页使用云朵，副标题显示所选城市。
- **ZIP 插件管理**：角色管理器“扩展”可导入、重启、禁用、替换、卸载；界面统一，插件在沙盒中运行，独立存储，按权限访问受控能力。
- **Codex 改为选装**：下载 Codex ZIP 后导入；仅读取本机额度与任务状态，不调用模型、不创建或修改任务。
- README、插件开发手册、版本教程与验收报告补齐实际界面图和排错步骤。

![7 天天气预报：云朵、城市副标题和左右翻页](https://raw.githubusercontent.com/xjunrao-ux/spine-pet-workshop/v3.2.2/docs/images/v322-weather-forecast.png)

上图为隔离演示数据，不代表当天实际天气。

## 开始使用

1. 下载安装版或便携版并启动；首次会打开角色管理器。
2. 鼠标放在桌宠上，点击清单图标使用待办。编辑和删除请**右键项目**。
3. 需要天气时，下载天气 ZIP，在管理器“扩展 → 导入插件 ZIP”选择文件并确认权限。ZIP 不用解压。
4. 点击云朵图标，到“城市设置”搜索并选择城市，或输入经纬度，再用左右箭头看预报。
5. 需要 Codex 状态时再导入对应 ZIP；未安装时没有 Codex 入口。

![待办右键菜单：编辑和可撤销删除](https://raw.githubusercontent.com/xjunrao-ux/spine-pet-workshop/v3.2.2/docs/images/v322-todo-context-menu.png)

## 升级须知

先退出旧版再运行新版，保留本机角色、参数和设置。建议退出后备份完整 `%APPDATA%\spine-pet-workshop\`。

- **宿主与插件分别更新**：升级 EXE 不会替换已安装天气/Codex 的旧 ZIP。扩展中重新导入新版同 ID 包，会保留原配置与业务数据。天气仍显示时钟或 Asia/Shanghai 时，核对插件版本并导入本页 v1.1.0 包。
- 待办已内置，旧 ZIP 版任务与配置继续沿用；无需重新导入待办包，内置项不可卸载或被同 ID ZIP 覆盖。
- v3.1.2 的旧内置 Codex 改为外部插件，需要重新导入 Codex ZIP；旧配置和桌宠已读标识兼容保留。
- 更换便携 EXE 的文件名或位置后，在“功能 → 应用启动”关闭再开启开机启动，更新登记路径。

## 使用范围与已知限制

天气由 Open-Meteo 提供，无需密钥。查询会向固定服务发送城市或坐标；免费托管接口限于非商业用途，当前天气是模型估算，不提供官方灾害预警。天气缓存为本机 JSON，不加密。

网易云需开启 SMTC，时长/进度仍显示 --:--。当前验证的微信和企业微信客户端没有可用 Windows 系统通知通道，暂不支持其聊天提醒。桌宠已读不修改聊天或系统通知的已读状态。

只安装可信 ZIP；当前没有插件市场、自动更新或发布者签名。外部插件没有任意网络、系统文件、Node 或任务控制能力。权限说明以导入确认框和开发手册为准。

完整 [图文教程](https://github.com/xjunrao-ux/spine-pet-workshop/blob/v3.2.2/docs/versions/v3.2.md) · [插件开发手册](https://github.com/xjunrao-ux/spine-pet-workshop/blob/v3.2.2/docs/PLUGIN_DEVELOPMENT.md) · [验收报告](https://github.com/xjunrao-ux/spine-pet-workshop/blob/v3.2.2/docs/design/v3.2.2-validation.md)。角色素材与 Spine Runtime 的来源和许可仍适用，见仓库说明。
