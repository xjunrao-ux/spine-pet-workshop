# 待办内置 / Codex 外置切换验收

> 历史开发记录。v3.2.2 已整理为正式版本，当前行为与验证见 [正式验收](v3.2.2-validation.md) 和 [图文使用说明](../versions/v3.2.md)。

日期：2026-10-12。分支 dev/v3，宿主开发版 v3.2.1，待办与 Codex Provider 版本 1.1.0。本轮不发布 GitHub，不改变正式版 v3.1.2。

## 当前结构

- 内置注册仅音乐、通知、待办。待办逻辑位于 `plugins/todo/`，完成/恢复、编辑、删除与稍后提醒在条目右侧，菜单通用 group 的 item/actions 样式完成布局，没有插件 ID 专用 UI 分支。
- Codex 的 Provider、清单、页面与提醒逻辑位于 `examples/codex-plugin/`，以 `Codex-Plugin-v1.1.0.zip` 独立交付，不随应用打包或预装。没有导入时无入口、无 Codex 订阅；导入经用户权限确认后启动，禁用/卸载释放订阅。
- 宿主保留通用 codex.read 只读适配器与窄网关，外部用 `await context.codex.subscribe(state, event)` 获取有界状态流，不开放模型调用、任务修改、凭据、任意文件或 RPC。
- 保留同工作区独立开发的受控天气接口和测试，未替换其实现。

## 兼容与数据保护

待办继续使用 `example.todo`，因此任务、配置、已读身份不换。加载 ZIP 索引时跳过已成为内置的同 ID 记录，先生成 `installed.json.before-builtin.bak`，再写入仅移除旧注册的新索引；不删除原包缓存或任务数据。不兼容/损坏索引拒绝覆盖。旧包不能再次替换或卸载内置待办。

Codex 外部 ID 为 `io.spine-workshop.codex`。旧内置 `workshop.codex` 配置与桌宠已读/事件去重标识保留兼容别名，不删除旧记录；用户仍需明确导入并确认读取任务名称与额度的权限。安装确认会启用新插件。

外部 Codex 仅收到白名单状态与事件，未声明后台字段不会转发；不绕过沙盒直接执行 Node 代码。权限检查在宿主按真实运行身份完成，无权限的 Worker 不提供 Codex 对象。

## 验证入口

```powershell
pnpm build
pnpm package:codex
pnpm test:plugins
node --test scripts/test-startup.mjs scripts/test-character-parameters.mjs
pnpm test:plugins:codex
pnpm test:plugins:sandbox
pnpm test:plugins:zip-ui
pnpm test:plugins:ui
```

迁移检查覆盖索引备份、旧 Provider 不执行、任务/设置/禁用状态保留、同 ID 唯一、内置覆盖与卸载拒绝、损坏/未来索引保护、默认无 Codex 订阅及旧 Codex 身份兼容。

本轮构建通过；62 项插件/文档/迁移单元检查、18 项角色参数和启动回归、5 项 Codex 网关检查、8 项通用沙盒检查、14 项新界面检查、15 项历史菜单回归与 6 项天气沙盒兼容性检查全部通过。

真实网关检查覆盖授权订阅、过滤未声明字段、跨进程事件、无权限不提供 API、停止后撤销。新版真实 UI 的 14 项检查覆盖：默认角色管理器、确认取消、Codex ZIP 导入、额度/任务页、任务字幕、内置待办表单与草稿、右侧按钮在 240/282/420 像素下不重叠、编辑/完成/恢复/删除/撤销、禁用保留任务、不能卸载内置项、Codex 卸载停止订阅与独立重装、待办到期字幕。

原菜单的 15 项回归使用明确标注的历史测试夹具，不代表生产注册仍内置 Codex；新版注册由迁移单元检查与上述真实 UI 单独验证。通用沙盒的独立持久化检查用测试专用 ID 运行待办业务源码，不覆盖生产内置待办。

所有运行测试使用隔离配置与演示数据，不关闭正在运行的旧版，不读取或打印真实任务/消息正文。示例截图与结果在 `.local/zip-plugin-smoke/`；本轮程序包另存 `release/plugin-transition/v3.2.1/`，Codex 包位于 `release/plugins/`。试用前退出旧版再启动新包。

接口细节见 [插件开发规范](../PLUGIN_DEVELOPMENT.md)。当前仍为 API v1 验证阶段，外部包未做发布者签名验证，只应导入可信来源。


2026-10-13 后续交互更新：待办 1.2.0 右侧只保留完成/撤回，编辑/删除改为右键菜单，页面采用左右按钮。旧的右侧操作描述属于本文件历史验收，最新行为与回归见 [分页与右键菜单验收](plugin-navigation-validation.md)。
