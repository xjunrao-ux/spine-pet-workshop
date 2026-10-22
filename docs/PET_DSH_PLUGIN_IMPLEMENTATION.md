# 桌宠 DSH 插件实现说明

日期：2026-10-21；插件 1.0.0；宿主基线 4.2.2；协议 pet-dsh/1 修订 1.0.0。

## 交付

可安装包：release/plugins/DSH-Pet-Plugin-v1.0.0.zip。源码：[provider.js](../examples/dsh-pet-plugin/provider.js)；清单：[plugin.json](../examples/dsh-pet-plugin/plugin.json)；[安装与使用](../examples/dsh-pet-plugin/README.md)。

本次将[设计](PET_DSH_PLUGIN_DESIGN.md)实现为独立沙盒插件，依据 [DSH 对接指南](../dsh-pet-bridge/docs/PET_INTEGRATION.md)、共同协议和仓库现有 DSH 服务源码。宿主仍只提供通用 net.local，没有加入 context.dsh、会话业务或人格注入逻辑。DSH 服务源码与用户真实配置未由本次开发修改。

插件包含五页：DSH 对话、当前任务、授权会话、连接与隐私、本机资料。普通消息、流式输出、回执查询、活动取消、能力控制的追加指令、断线恢复、手工资料和可选提醒已实现。当前 DSH 服务未声明的审批回答、persona.update、pet.tools 没有伪造实现。

## 运行关系

~~~mermaid
sequenceDiagram
    participant U as 用户
    participant P as 桌宠 ZIP 插件
    participant H as 桌宠宿主通道
    participant B as DSH 桥接插件
    participant A as 已有 DSH Agent
    U->>H: 可信窗口保存根地址与令牌
    U->>P: 连接并明确选择授权会话
    P->>H: /info → /sessions → /snapshot
    H->>B: 带隔离凭据的 HTTP
    B-->>P: 宿主回调返回 DTO
    P->>H: /events + snapshot.cursor
    U->>P: 发送项目任务
    P->>P: 持久化唯一发送意图
    P->>H: POST /commands
    H->>B: message.send
    B->>A: followup / 已授权 steer
    B-->>P: 202 只表明接收
    A-->>B: claimed / 文本 / 工具摘要 / 终态
    B-->>P: SSE 投影，宿主代理交付
    P->>H: 必要时 /requests 查证
~~~

所有业务包络均在插件中校验。HTTP 传输 ID、wire requestId、streamId 独立分配。请求映射在调用宿主前登记，避免极快回调丢失；长网络等待在背景流程处理，不占用 execute 的短命令窗口。

## 实现中的关键取舍

### 快照与增量

首次绑定、断线或实例变更均重新握手，先获得一致快照，再从其 cursor 建立唯一 SSE。游标仅相等比较和有限去重，不解析数值。SSE 的 id 必须与 JSON cursor 相同，实例、会话与流 ID 必须匹配。

session.changed 合并 150ms 后暂停旧流、快照并订阅新流。旧流取消的受理并不代表槽位立即释放，因此等待终态或有界等待，再占用新流。旧代际响应不修改当前会话。

**对原设计的一项修正**：快照可能位于某次生成的中间，协议没有提供该 attempt 的增量 index 基线。新订阅的首个 delta 因而可以大于 0。实现接受它并明确标注“仅展示同步后的增量”，后续在本次观测范围内严格检查连续性，最终由 assistant.message 替换。不能把首个非零 index 一律当成丢包，否则会形成重同步循环并触发服务限流。

助手提交消息以 messageId 去重；临时输出只有一条、长度有限。长 Unicode 文本按宿主 UTF-16 上限安全截断，不截断代理对，并提示在 DSH 查看完整历史。

### 发送日志与故障

写前记录成功后才可开始变更传输。HTTP/SSE 接受、任务认领与活动结束分别处理；先收到 ended、后收到 202 时不能回退状态。每个会话只允许一个未查清的主动消息。

超时、EOF、取消网络、关闭桌宠均不证明 DSH 停止。未决发送只查询 /requests，不重投，不因 retryable=true 或 REQUEST_UNKNOWN 就生成新 requestId。

**查询失败不等于任务失败**：/requests 的 429、5xx 或未知错误只说明这次查询未成功，不能把已接受的任务改成 rejected。只有台账 DTO 的 rejected 或变更请求的明确拒绝回执才表示该操作被拒绝。

服务重启后，查询回执中的当前 instanceId 和原 acceptedInstanceId 分开处理。停止确认捕获精确 activityId，若活动已更换则失效；不会取消下一条活动。取消网络与 session.cancel 是不同操作。

401/403 与协议不兼容停止自动重试。只读恢复按 1/2/4/8/30 秒并加抖动，最多五轮；连接稳定 30 秒后才重置失败次数，避免不断 EOF 的服务造成无限重连。

### 输入与绑定版本

按钮和表单携带 bindingEpoch，配置、重同步和切会话后旧 payload 失效。composer 的 DOM 身份另由 formEpoch 维护；同会话重同步不会改变 form.id，因此不必丢掉正在编辑的草稿。只有确认切换或配置变化才创建新的输入身份。

普通任务运行中输入仍可编辑，但不能抢先发送；steer 模式保留发送动作，并将停止按钮单独展示，避免 composer.pending 把追加指令入口一起锁住。草稿不承诺跨关闭或重启持久化，宿主没有逐键输入回传接口。

### 会话与能力

源码验证显示 title/workspace 可以为 null；界面使用会话 ID /“工作区未提供”回退。会话列表按 20 项显示，支持服务端不透明分页和页内分页。available:false 标灰，不创建或恢复 Agent。

取消需 session.cancel；追加需用户开关与 message.steer 双重启用。普通发送 capability 失效时停在不兼容状态，不将其当成追加模式的可恢复错误。

本机资料保存与对话发送无关联，不进入 message.send。连接配置按宿主插件身份保存，凭据不进入界面、日志、缓存或插件参数；修改配置会隔离旧授权未决记录，要求重新选择会话。

### 持久化与生命周期

单个 state 键、schemaVersion=1、串行写入；完整 UTF-8 数据预算 384KiB。显示缓存最多两个会话且合计不超过 160KiB；最多八条未决变更、32 条精简终态记录。优先淘汰缓存和已结束记录，未知结果凭证不自动丢弃。损坏或未知数据版本不覆盖原数据；持久化失败停止新发送。

通知先持久化去重标记，并使用内存中的待写集合防止异步窗口重复提醒。只对当前绑定的实时状态通知；快照和历史回放不生成通知。

销毁、禁用、撤权和卸载释放传输、订阅及全部定时器；不对 DSH 发送取消命令，不销毁用户 Agent。

## 代码与复现

- examples/dsh-pet-plugin/provider.js：单入口客户端、校验器、状态投影、发送日志、页面与生命周期。
- examples/dsh-pet-plugin/plugin.json：19 个声明命令与四个设置，权限仅 net.local / storage.own / ui.reminders。
- scripts/test-dsh-pet.mjs：受控异常与真实 HTTP/SSE 服务集成。
- scripts/test-dsh-pet-sandbox.mjs：真实 Electron Worker、安装包、可信配置窗口与 UI 验证。
- scripts/run-dsh-pet-sandbox.mjs：隐式后台启动 Electron，隔离测试用户目录。
- docs/DSH_PET_PLUGIN_TEST_REPORT.md：验证结果、范围及安装包摘要。

运行 pnpm test:dsh-pet、pnpm build、pnpm package:dsh-pet、pnpm test:dsh-pet:sandbox。测试只使用生成的测试凭据和模拟 Harness，不读取用户 DSH 令牌、不调用付费模型。沙盒截图与机器记录位于 .local/dsh-pet-validation，不打入用户插件包。

宿主与插件分开发版，本次保留宿主版本 4.2.2。没有发布 GitHub Release、安装到用户正在运行的桌宠或替用户授权真实 DSH。

## 后续对接

用户安装插件后，只需填写 DSH 已提供的服务根地址和单独签发的连接令牌，再选择授权会话；不需要修改两端协议或宿主才能使用基础功能。

真实 DSH 当前进程的最终端到端验证留在实际连接阶段；本次验证链使用真实桥接服务代码和模拟 Harness。以后接入审批、人设同步或桌宠日程，先由 DSH/宿主声明并实现相应能力，再补充客户端操作和回执语义，不通过普通聊天文字冒充工具成功。
