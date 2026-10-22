# DSH 桌宠插件验证报告

日期：2026-10-21；插件 1.0.0；宿主基线 4.2.2；协议 pet-dsh/1 修订 1.0.0。

## 实际执行结果

| 层次 | 命令 / 证据 | 结果 |
| --- | --- | --- |
| 客户端状态机与集成 | node --test scripts/test-dsh-pet.mjs | 23/23 通过 |
| 真实 TCP HTTP/SSE | 上述套件内使用现有 DSH 桥源码、LocalService 和模拟 Harness | 发送、快照、查询、取消与释放通过 |
| Electron Worker 与 UI | node scripts/run-dsh-pet-sandbox.mjs | 9/9 检查通过 |
| 既有宿主回归 | node --test scripts/test-local-service.mjs scripts/test-external-plugins.mjs scripts/test-plugin-documentation.mjs | 29/29 通过 |
| 宿主构建 | pnpm build | TypeScript 与 Vite 成功 |
| 安装包 | node scripts/package-plugin.mjs examples/dsh-pet-plugin release/plugins/DSH-Pet-Plugin-v1.0.0.zip | inspectPluginZip 通过，入口/清单/README 与源码逐字节一致 |

环境：Windows x64；Node v24.18.0；pnpm 11.25.0；Electron 44.4.3。真实 Electron 沙盒截图验证使用软件渲染，未改变产品的渲染设置。

## 覆盖的客户端风险

- 明确选择授权会话、快照水位到 SSE 的衔接；空标题/工作区兼容。
- 传输 ID 与业务 requestId 独立；SSE 先到、HTTP 回执迟到不回退终态。
- 发送超时与 EOF 保持结果未知，只查询台账，不自动重发变更。
- 当前会话切换后的旧按钮/事件不串会话；同会话重同步保留 composer 身份。
- 具体 activityId 的停止确认；活动改变后不取消下一条。
- 待审批只提示 DSH 处理；追加指令必须双开关启用。
- 快照切在生成中途时接收首个非零 index 并标注部分增量；已观测区间缺口触发恢复。
- 查询限流不会把正在运行的任务改为拒绝；401 停止自动重连。
- 本机存储失败不发请求；服务字节限额在写入未决记录前检查。
- 配置变化隔离旧凭证范围的记录；损坏存储不覆盖；本机人设不注入 DSH。
- Unicode 截断不分裂代理对；异步提醒去重；销毁释放网络与定时器。

## 真实 Electron 验证项

1. installable ZIP activates in a real Worker sandbox without starting DSH tasks
2. trusted host window saves isolated encrypted connection credentials
3. handshake, explicit session selection and snapshot-to-SSE cursor pairing cross real RPC
4. actual chat UI renders streaming text safely and preserves editable drafts and caret
5. only confirmed activity outcomes complete persisted task records
6. persona and manual memory save locally without injecting DSH messages
7. confirmed stop sends a DSH activity cancellation and observes its real terminal event
8. disable and reenable release network and subscriptions while preserving data without auto sending
9. uninstall releases the sandbox and leaves DSH session ownership intact

截图：.local/dsh-pet-validation/connection.png、chat.png。机器记录：checks.json、result.json，位于同一目录；隔离测试用户数据位于 profile-*，不属于插件交付内容。聊天截图已查看，文字、发送/停止与草稿布局正常，服务文本作为纯文本显示。

## 范围限制

这里的“真实 HTTP/SSE”使用仓库实际桥接服务代码，“真实 Electron”使用真实宿主、Worker 与 UI；Agent 环境仍是模拟 Harness，不等于用户实际 DSH 的最终验收。

本次没有读取用户 DSH 凭据、接管现有进程、向用户项目提交任务或调用付费模型；没有发布 GitHub Release 或安装到用户当前桌宠。DSH 端既有真实 Harness 报告见 dsh-pet-bridge/TEST_REPORT.md，属于另一份已有证据。

用户可按 [安装说明](../examples/dsh-pet-plugin/README.md) 导入本包，再填写已运行 DSH 桥的根地址与令牌，选择授权会话进行最终验证。审批、人格远程同步与桌宠日程能力未在当前服务实现，本插件相应入口保持不可用。

## 安装包摘要

- 路径：release/plugins/DSH-Pet-Plugin-v1.0.0.zip
- 大小：19400 字节。
- 文件：plugin.json、provider.js、README.md。
- SHA-256：445efc602c969ed73054c911bd8062f6525bbea7ce5eefa01b5909d7ee18c415。
- 同目录附 DSH-Pet-Plugin-v1.0.0.zip.sha256。
