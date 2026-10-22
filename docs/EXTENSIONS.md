# 扩展与 ZIP 插件架构（v5.1.2）

音乐、系统通知、待办内置；天气、Codex、DeepSeek、DSH 作为独立 ZIP 导入。插件 API v1 与 ZIP 包格式 v1 保持兼容，界面组件与受控能力可以增量增加；接口的具体范围以 [插件开发手册](PLUGIN_DEVELOPMENT.md) 为准。

## 统一宿主

- electron/plugins/registry.mjs、host.mjs：注册、生命周期、命令、权限、已读与故障隔离。
- contracts.mjs、capabilities.mjs：声明式快照、参数验证、受控系统/网络/AI 能力。
- sandbox-runtime.mjs 与 runtime/：外部代码只在受限 Worker 内运行，不提供任意 Node、文件或网络访问。
- src/plugins/：通用组件渲染；主题、分页、窗口拖动、字幕与隐私由宿主统一处理。
- settingsPages：城市、人设、记忆、连接等配置在管理器“扩展”呈现，保持桌面面板紧凑。

## 可用能力

| 能力 | 范围 |
| --- | --- |
| storage.own | 按插件 ID 隔离的有界持久化存储 |
| ui.reminders | 受全局隐私、字幕与专注控制的角色提醒 |
| weather.read | 固定服务的城市搜索、坐标与天气查询 |
| codex.read | 本机额度与任务元数据只读订阅 |
| ai.deepseek | 固定服务商接口，宿主可信窗口录入并加密保存密钥 |
| net.local | 用户明确授权的 loopback 前缀、HTTP JSON 与 SSE |

可信连接窗口不向插件返回凭据。没有任意 HTML、文件执行、通用外网或自动安装权限。DSH 业务保留在独立插件与桥组件，宿主不直接处理 DSH 会话。

## 配置与兼容

feature-settings.json 第二版保留全局与逐插件配置，旧配置迁移前备份；未知插件数据保留，未来配置版本不会被静默覆盖。重装同 ID 插件恢复自己的数据；卸载保留数据和包缓存。

外部 ZIP 可禁用、重启、卸载；内置项不能被 ZIP 替换或卸载。当前没有应用内市场、自动更新或发布者签名。操作步骤见 [插件使用手册](PLUGIN_USAGE.md)，关键历史设计保存在 design/。
