# 扩展与 ZIP 插件接口状态（v3.2.2）

音乐、系统通知、待办为内置插件，Codex 已改为独立 ZIP，在角色管理器的“扩展”页导入后才运行。各项沿用统一接口与声明式 UI。内容页面通过右下角左右箭头切换，滚轮只滚动当前页；待办右侧显示完成/撤回，项目右键菜单提供编辑/删除。当前是 API v1 验证版本，不是永久冻结的 SDK；外部 JS 只在受限沙盒 Worker 中运行。

独立插件作者请从 [插件开发规范与接入手册](PLUGIN_DEVELOPMENT.md) 开始：包含可运行示例、ZIP 格式、完整字段表、生命周期、组件、命令、设置/存储、提醒/已读、安全限制与发布检查表。本页保留架构状态概览，不代替外部接口规范。

## 已落地的结构

- 注册表：`electron/plugins/registry.mjs`。
- 统一宿主：`electron/plugins/host.mjs`，负责启停、状态校验、命令、提醒、已读、取消和故障处理。
- 受控能力：`capabilities.mjs` 与 `windows-adapter.mjs`，按订阅共用系统桥接，保留 Codex 只读适配器。
- 内置 Provider：`electron/plugins/providers/` 的音乐/通知，以及 `plugins/todo/` 的待办；外置 Codex：`examples/codex-plugin/`，不随宿主预装。
- 前端契约与声明式渲染：`src/plugins/types.ts`、`renderer.ts`。

内置插件统一使用 activate、getSnapshot、publish、execute、emit、onSettingsChanged 和 dispose。菜单与角色管理器按注册表生成；悬停、分页、主题、字幕、隐私、已读与窗口操作属于宿主，不由插件自己实现。

音乐每个播放器一页，通知每条消息一页，Codex 分额度和最近任务页。通知查看后撤红点，入口在启用状态下保留。网易云 SMTC 与微信/企业微信的限制由插件声明，并显示在管理器 UI。

## 配置兼容

`feature-settings.json` 第二版包含全局偏好与各插件配置，旧版迁移前备份。通知已读标识迁移到 `plugin-read-state.json`，不保存聊天正文。未知插件数据保留，不兼容的配置版本不静默覆盖。

## 仍未开放

ZIP 安装、沙盒执行、独立存储与角色提醒已实现。外部新增 codex.read，只提供额度和任务元数据订阅，不开放任务操作与凭据；音乐/通知、Node、任意网络、系统文件仍不开放。weather.read 受控天气查询保留，参见 [天气接口与插件](design/weather-plugin.md)。旧 ZIP 构建不支持新增权限，需使用新版宿主。卸载外部项保留数据，同 ID 重装恢复；待办已内置，不能以 ZIP 覆盖或卸载。仅导入可信来源，目前未验证发布者签名。

插件市场、自定义 HTML 和自动更新仍未交付。开发手册已提供，API 仍处于验证期；待办示例与 ZIP 安装验证见 [独立待办插件记录](design/zip-plugin-todo-validation.md)。

完整内部设计见 [架构方案](design/v3.2.1-plugin-architecture.md)，首轮结果见 [验证记录](design/v3.2.1-validation.md)。后续接口调整应同步更新开发手册、独立示例与测试。
