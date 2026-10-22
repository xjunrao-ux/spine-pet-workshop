# DSH 创造模式开发任务书：桌宠桥接插件

> 保留的设计与开发交接记录；当前交付范围见 [实现说明](PET_DSH_PLUGIN_IMPLEMENTATION.md) 与 [正式版指南](versions/v5.1.2.md)。下文“尚未实现”描述的是设计当时的基线。

文档版本：1.0.0 · 日期：2026-10-21 · 目标协议：pet-dsh/1 修订 1.0.0 · 桌宠最低宿主：v4.2.2。

本文可直接交给 DeepSeek Harness（DSH）创造模式执行。正文是 DSH 端插件的实现任务书；附录 A、B 嵌入共同协议和桌宠宿主接口全文，因此单独发送本 Markdown 也能理解开发任务。配套交接包还带 JSON Schema、原协议文件和 SHA-256 校验清单。

本文不是已经完成插件的使用说明。要求开发者在用户实际 DSH 版本上完成适配，如实报告验证范围。桌宠 v4.2.2 只完成通用传输宿主，桌宠 DSH 插件、跨插件工具调用和真实双端联调尚未交付。

协议原文件 SHA-256：4fc69bca3c52a1edea214a4065a2ac66ef0cd616dd65fcf3ee73058b5f68ab34。

Schema 原文件 SHA-256：4d5ff0b68cc3086942dbab6f1286347ce8706d4f1b3f90555a0191e39d268c7d。

## 0. 直接发送给创造模式的启动指令

> 请按本文开发一个独立 DSH Host 插件，供 Spine 桌宠通过本机 HTTP JSON + SSE 连接我已经运行的 DSH，共享我明确授权的现有项目会话。先核实本机 DSH 版本、profile、导出类型和扩展服务，建立兼容性清单，不照抄旧骨架的未验证 API。先完成六个基础端点、对话、执行事件、持久幂等和恢复，再验证可选取消、追加指令和人格能力。审批与反向工具只有在目标版本和对端满足条件时才声明支持。持续完成当前权限下可独立完成的代码、模拟测试、打包和文档；安装、修改现有 profile、真实付费模型调用遵循当前 DSH 授权流程。不要修改桌宠宿主或 DSH 核心，不把模拟测试算作真实双端验证。交付源码、可安装包、精确兼容版本、接口说明和测试证据。

## 1. 用户目标与交付范围

### 1.1 预期体验

1. 用户已经启动 DSH，有一个普通项目会话。
2. 安装插件，明确登记客户端及其可访问的现有会话。
3. 用户在桌宠可信连接窗口填写插件根地址和连接 token。
4. 桌宠读取 info、列出授权会话、读取 snapshot，再订阅 SSE。
5. 消息进入原会话，使用 DSH 已有模型、工具、权限和审批。
6. DSH GUI 与桌宠使用同一份已提交历史，任一前端的会话更新能同步。
7. 断线/重启可以恢复真实状态，不重复执行改代码或创建待办等副作用。

“双端可见”必须用实际 GUI 证明。能在进程内找到 Agent，不自动证明 GUI 侧栏可发现它。基础版不自动新建、删除、重置或全量共享用户会话。

### 1.2 能力分级

| 级别 | 能力 | 完成条件 |
| --- | --- | --- |
| 必须 | /info、/sessions、/snapshot、/commands、/requests、/events | 六个真实可用端点，不以永久 501 或假回复占位 |
| 必须 | sessions.list、session.snapshot、message.send、events.follow、requests.lookup | 认证、授权、既有会话、历史、事件与持久请求台账 |
| 优先实现 | session.cancel | 匹配 activityId，观察真实终止，不终止整个 DSH |
| 验证后启用 | message.steer、persona.update | 会话作用域正确，不改其他会话、不销毁历史 |
| 条件式扩展 | interaction.answer | 接入真实审批/问答唯一决定，不另建绕过通道 |
| 对端依赖扩展 | pet.tools | 桌宠完成工具声明、授权、执行与结果回传后才启用 |

完整开发不意味着伪造全部可选能力。不可用的能力从 info.capabilities 省略，写清目标版本限制和后续依赖。基础五项能力缺失则不能标记为可联调版本。

### 1.3 不在本次范围

不开发桌宠 ZIP 或修改 Electron；不另写模型循环、不索要模型 API Key；不模拟终端输入或读屏；不开放任意 shell/文件/URL 端点；不升级 DSH、自动改变模型、提高全局权限或清理用户会话；不把宿主取消传输等同于取消远端任务。

## 2. 事实来源与旧骨架

优先级：附录 A 共同协议 > 本文实现约定与 DTO > 本机实际 DSH 类型/服务/行为 > 附录 B 宿主限制 > 官方上游参考 > 历史骨架。

机器可读 dsh-bridge-v1.schema.json 覆盖核心信封，不能代替字节限额、认证、并发、状态机、审批唯一决定等语义校验。发现契约歧义要记录并提出修订，不偷偷改变路径/字段来迁就实现。

原仓库 dsh-pet-bridge/ 是旧阶段 0 骨架：/dsh-pet/act、conversationId、hello/delta/done、自动配对文件等不符合本协议。它的工具白名单与服务名也不是本次目标版本的已验证事实。保留用户改动，独立工作目录实现或正常合并；不能只复用 /status 返回 200 就宣称兼容。

交接包 MANIFEST.json 记录协议和 Schema 的原始字节 SHA-256，供两端核对基线，不代表发布者签名或安全认证。

## 3. 第一步：核实实际 DSH 扩展机制

编码前创建 COMPATIBILITY.md：

| 项目 | 必须记录 |
| --- | --- |
| 运行环境 | 精确 DSH 版本、安装来源、Node/宿主环境、系统架构 |
| 应用 | 当前真实 profile、web/desktop 等 carrier；只记录必要路径，不倾倒秘密配置 |
| 插件 | Host 导出、bundle patch、安装入口、依赖解析和生命周期 |
| 会话 | 活跃 Agent、会话索引、工作区归属、持久历史和正常恢复入口 |
| 输入 | UserMessage 必填标识/source，followup/steer 的本机准确签名 |
| 输出 | 已提交 Session 事件、实时助手流、活动边界、错误与终态 |
| 控制 | cancel 是否清 inbox、对子活动的影响、whenIdle 的实际语义 |
| 扩展 | scope 提示词、审批/问答回答器、工具注册与权限链 |
| 实证 | 用过的自省工具/类型文件/最小探针；缺失服务明确写不可用 |

ctx.agents、agent.followup、agent/assistant-stream 是官方参考中的候选接口，不保证每个发行版相同。用创造模式已有的服务自省或实际安装类型核实。缺依赖时关闭对应能力，不能使用空对象、硬编码响应、直接改日志文件或复制私有 agent-loop 作为兼容后备。

安装和 profile 修改使用当前 DSH 的正式管理/审批机制；不为绕过插件安装审批而修改全局权限。先验证源码和测试，再进行具体、可回滚的安装操作。

## 4. 推荐包结构

~~~text
dsh-pet-bridge/
  package.json
  cordis.patch.yml
  src/
    index.ts                 插件入口、依赖和清理
    config.ts                配置验证
    http-server.ts           loopback 监听和路由
    auth.ts                  客户端/token/会话与能力授权
    wire.ts                  Schema、DTO 和错误映射
    dsh-adapter.ts           所有 DSH 版本相关逻辑
    request-journal.ts       持久幂等台账与恢复
    session-projection.ts    安全历史和活动投影
    event-hub.ts             游标/快照/回放/SSE/背压
    interactions.ts          可选审批与问答
    persona.ts               可选会话人格
    pet-tools.ts             可选反向工具，默认关闭
  test/
  scripts/                   探针和模拟桌宠客户端
  protocol/
  README.md
  COMPATIBILITY.md
  TEST_REPORT.md
~~~

这是职责划分建议，不要求为目录数量拆分。一个独立 npm bundle 即可，包名可沿用 @local/dsh-pet-bridge，插件版本和 DSH/桌宠版本分别管理。peer 和构建依赖按实际验证的精确版本范围声明，不用通配范围冒充兼容。

插件运行在现有 DSH Host 内。推荐自身建立 node:http loopback 监听，避免依赖特定 Web carrier。若使用 DSH Web 路由服务，也必须证明其地址、Host/Origin、认证、端口和卸载行为满足契约。不要假定当前 GUI 的 3080 端口就是桥接地址。

建议内部接口如下；它是待实现适配器，不是 DSH 已有 API：

~~~ts
interface HarnessAdapter {
  listAuthorizedSessions(client: Client): Promise<SessionSummary[]>;
  snapshot(sessionId: string): Promise<SafeSessionView>;
  submit(
    sessionId: string, messageId: string, text: string,
    mode: 'followup' | 'steer'
  ): Promise<Receipt>;
  subscribe(listener: (event: AdapterEvent) => void): () => void;
  cancel?(sessionId: string, expectedActivityId: string): Promise<CancelReceipt>;
  updatePersona?(sessionId: string, input: PersonaInput): Promise<void>;
}
~~~

Agent、Context、AbortSignal、函数、原始内部事件不得直接 JSON 序列化给桌宠。

## 5. 配置、认证和 token 交接

配置分三类：

- 传输：host 默认 127.0.0.1，可配置端口（支持 0 由 OS 分配），basePath 默认 /pet-bridge/v1/，有界连接与缓存预算。
- 客户端：稳定 clientId、token 哈希或安全凭据引用、允许的会话集合/能力、启用状态。
- 持久数据：插件自己的数据目录、至少 24 小时台账保留、脱敏审计。不放在模型可任意读取的项目工作区。

clientId 来自服务端认证，不能相信请求自报身份。默认不共享会话，用户通过可信设置或正常管理入口登记。默认不授权全部工作区或全机项目。

token 至少 32 随机字节，可使用 hex 编码，使用恒定时间或等价哈希验证。桌宠接受 16–512 个 [A-Za-z0-9._~+/-] 字符，末尾可有至多两个等号。它是连接令牌，不是模型密钥。禁止出现在 URL、日志、模型可见工具返回、快照、报告和仓库。

优先在 DSH 可信设置页一次展示连接信息。缺少可信 UI 时，提供由用户明确执行的受保护本地导出流程：限制文件权限，不放进项目工作区，再人工复制到桌宠宿主窗口。不要宣称 Windows 上仅设置 POSIX mode 就等价于 ACL。服务端可以只保存 token 哈希；重启保持客户端授权、重新生成 instanceId。

撤销 token 立即拒绝新请求并关闭对应 SSE，不默认取消已经提交的项目任务。首版不自动读 ~/.dsh、不扫描端口、不创建未约定的配对 API。

## 6. 准确对接桌宠宿主

- 所有业务端点先认证再查询会话；验证实际监听地址和预期 Host。拒绝带 Origin 的业务请求，包括 Origin:null，不开启通配 CORS。
- JSON 使用 application/json; charset=utf-8、Cache-Control:no-store。错误也是 JSON，不返回登录重定向、HTML 或原始堆栈。
- 请求体先按 64 KiB 限额读取，再解析 JSON，再做 Schema 和语义校验。限制慢连接与请求速率。
- JSON 响应/快照≤256 KiB，SSE 事件≤64 KiB。标识/字符数限制与 UTF-8 字节预算分别验证。
- info/sessions/snapshot/requests 不调用模型。发送请求在正常负载下应约 1 秒内持久接收并返回 202，不能等待整轮执行。
- SSE 握手为 200 + text/event-stream；普通请求/握手 15 秒限时，每 15 秒注释心跳，避免触发宿主 45 秒无字节超时。
- 宿主 accepted 只是传输启动；DSH HTTP 202 是服务端接收；activity.ended 才是执行活动终态。
- 宿主只暴露响应 status/ok/data，不转发自定义响应头。分页游标和恢复信息必须在 JSON 内。
- 宿主 stream.event.data 是原始 SSE data 字符串；桌宠插件自行 JSON.parse 和协议校验。
- 宿主每插件最多 4 个 HTTP、1 条 SSE。因此首版一个时刻只订阅一个选定会话，切换时先关闭旧流；不要设计成每个会话一条流。
- 服务端不依赖 cookie、代理、重定向或桌宠直接读磁盘。

## 7. 身份映射与既有会话

分别维护客户端 requestId、DSH user/assistant messageId、bridge activityId。instanceId 仅标识这次运行，授权客户端身份和台账跨重启稳定。

DSH 内部 ID 如果不满足协议 1–100 个 ASCII 字母/数字/点/下划线/连字符，建立稳定且持久的 wireId↔internalId 映射。不能简单替换非法字符造成碰撞，也不能把绝对路径当 sessionId。

流程：认证 → 检查允许会话 → 查询活跃实例和权威会话信息。禁止先导出全部会话再由桌宠隐藏。基础版只向已存在活跃 Agent 发送；已授权历史会话可以列出 unavailable。恢复历史必须使用已验证的正常恢复入口，不额外暴露未约定的恢复命令，不重复创建 Agent。

既有项目会话沿用原模型、工具、沙盒与审批。不要为了桥接统一安装只读 preset 或替换用户的工具集合。连接授权不等于执行扩权；工作目录不等于隔离边界。

## 8. 六个端点与 DTO 补全约定

附录 A 固定路径、信封和语义。本节补全未展开的 items/messages/查询结果结构，供后续桌宠客户端对齐；不改变共同协议既有字段。时间为 UTC ISO 8601，无活动/无下一页使用 null。

### 8.1 GET /info

~~~json
{
  "protocols": ["pet-dsh/1"],
  "instanceId": "instance-a",
  "serverVersion": "0.1.0",
  "dshVersion": "实际运行的精确版本",
  "capabilities": [
    "sessions.list", "session.snapshot", "message.send",
    "events.follow", "requests.lookup"
  ],
  "limits": {
    "requestBytes": 65536, "responseBytes": 262144, "eventBytes": 65536,
    "messageChars": 4000, "eventsPerSecond": 30, "heartbeatMs": 15000,
    "journalRetentionHours": 24, "sessionPageSize": 20,
    "snapshotMessageLimit": 20
  }
}
~~~

示例没有声明可选取消。只有实际实现并验证后才添加。响应只展示当前客户端可用能力，不泄露其他客户端配置。

### 8.2 GET /sessions?cursor=...

~~~json
{
  "instanceId": "instance-a",
  "items": [{
    "sessionId": "session-a", "title": "桌宠项目开发",
    "workspace": "已授权的工作区展示名称", "status": "idle", "available": true
  }],
  "nextCursor": null
}
~~~

建议每页 20 项。workspace 默认展示名称，不默认暴露绝对路径。status 为 idle/running/unavailable，活动详情在 snapshot.activity。available 表示当前可以发送，不代表提升权限。分页 cursor 与 SSE cursor 不可混用；分页游标应绑定客户端和实例，不能改偏移越权。

### 8.3 GET /snapshot?sessionId=...

~~~json
{
  "instanceId": "instance-a", "sessionId": "session-a", "cursor": "instance-a.105",
  "messages": [
    {"messageId":"user-101","role":"user","text":"分析测试结构。","turn":12},
    {"messageId":"assistant-205","role":"assistant","text":"项目包含单元测试。","turn":12}
  ],
  "activity": null, "pendingInteractions": [], "pendingPetCalls": [],
  "truncated": false
}
~~~

messages 为已提交 user/assistant 显示文本，默认最后 20 条。单条展示文本最多 16000 字符，同时遵守总字节预算；超出时保留 ID、明确 truncated:true 并裁剪显示，完整内容在 DSH GUI 查看。隐藏工具原始参数、内部提示词与私密推理。裁剪不改变源历史，也不把已提交回复伪装成未完成输出。

活动存在时 activity 为 {activityId,status}。实时生成是临时投影，不冒充已提交 messages；如增加 currentAttempt 可选字段，必须带 attemptId、完整位置并证明与 cursor 同水位，否则重连时仅显示正在执行，等待已提交消息。

pendingInteractions/pendingPetCalls 只能返回当前客户端有权回答、未过期的项目；缺少相应能力时为空数组。不能拼接不同时刻的数据并冒充一致快照。

### 8.4 POST /commands

~~~json
{
  "protocol":"pet-dsh/1","instanceId":"instance-a","requestId":"req-001",
  "op":"message.send","sessionId":"session-a",
  "data":{"mode":"followup","text":"分析测试结构。"}
}
~~~

~~~json
{
  "protocol":"pet-dsh/1","instanceId":"instance-a","requestId":"req-001",
  "ok":true,"data":{"status":"accepted","messageId":"user-101"}
}
~~~

只执行共同协议中的操作。text.trim() 非空，最多 4000 字符，不把文本当本机代码执行。UserMessage 使用本机 DSH 正确的标识和来源格式构造。HTTP 断开不能自动撤回已经入队的消息。

### 8.5 GET /requests?requestId=...

~~~json
{
  "protocol":"pet-dsh/1","instanceId":"instance-b","requestId":"req-001","ok":true,
  "data":{
    "status":"ended","op":"message.send","sessionId":"session-a",
    "messageId":"user-101","activityId":"activity-a-12",
    "acceptedInstanceId":"instance-a","outcome":"completed"
  }
}
~~~

当前实例可与接收实例不同，这是重启后查询旧操作，不是重执行。received/accepted/running/ended/rejected/unknown 按实际证据填写。未知道的字段不要捏造；未知/过期请求使用 REQUEST_UNKNOWN 或 RESULT_UNKNOWN，不等于允许重新提交。客户端只能查询自己的台账。

### 8.6 GET /events?sessionId=...

event 固定 bridge，SSE id 等于信封 cursor；事件表和信封见附录 A。基础流也要覆盖 GUI 的用户输入变化：可用 session.changed 提示客户端刷新 snapshot，不能随意发明未约定的 user.message 事件。

## 9. 消息接收与活动关联

一条 followup 的流程：

1. 认证、授权、验证信封和实例，查询幂等台账。
2. 在会话短临界区检查当前活动/未决提交，忙碌返回 SESSION_BUSY。
3. 分配持久可映射的 messageId，落盘 received 意图。
4. 交给同一个既有 Agent 的正常消息入口，不直接调用模型或另建 Agent。
5. 确认提交边界，保存 accepted 回执，返回 202。
6. 在消息实际被认领后建立 messageId→turn/activity，持续观察权威终态。

~~~ts
// 仅为流程示意，辅助函数属于本插件；不是保证兼容所有 DSH 的可运行代码。
const agent = adapter.resolveAuthorizedActiveAgent(client, request.sessionId);
const message = adapter.buildIdentifiedUserMessage(request, persistedMessageId);
adapter.attachReceiptTracking(agent, request.requestId, message.id);
agent.followup(message);
// 先返回可靠回执，不能等待整轮 whenIdle 才结束 HTTP。
~~~

启动时先建立事件观测，再接受提交，避免同步开始事件丢失。whenIdle 反映整个 Agent 活动，不是某条 prompt 的精确结果。用户在 GUI 继续输入时，不把所有后续回复硬归给桌宠 requestId。

锁只保护验证、入队和台账更新，不覆盖整轮执行。取消、审批、工具结果与 SSE 必须有独立可进行的控制路径。GUI 不受本插件锁控制；有外部参与就如实呈现共同上下文，不假装拥有全局独占锁。

## 10. 持久台账、幂等与崩溃恢复

使用目标运行时支持的可靠数据库或串行日志加原子快照，说明事务、flush、损坏处理和测试。不要假定任意 Node 都有可用内置 SQLite；内存 Map 只能做缓存。

至少保存 clientId/requestId、规范化 payloadHash、op/sessionId、messageId、acceptedInstanceId、已知 activityId、接收/终态时间、状态和脱敏错误。不保存 token，避免无必要复制完整用户文本。

规范化 JSON 的键序和哈希跨重启一致。先识别同客户端同 requestId 的历史记录：完全相同内容返回原回执，不同内容 REQUEST_CONFLICT；只有新操作携带旧 instanceId 才拒绝 INSTANCE_CHANGED，不能因重启把旧请求重新执行。

| 崩溃窗口 | 恢复规则 |
| --- | --- |
| 意图落盘前 | 无可靠记录则 unknown，不自动补执行 |
| received 后、入队前 | 能证明未交给 DSH 才 rejected，证据不足 unknown |
| 已入队、accepted 未保存 | 用预分配 messageId 核对 DSH 持久 inbox/日志，不确定就 RESULT_UNKNOWN |
| accepted 后、HTTP 回包前 | 相同幂等请求返回原回执，不再 followup |
| 执行中重启 | 依据权威终态恢复，不能证明则 interrupted/unknown，不自动唤醒 |
| 终态已保存、客户端断线 | 查询/快照返回既有结果 |

至少保留 24 小时。清理过期终态，不删除活跃或不确定记录来腾空间；磁盘满就拒绝新操作，不绕过落盘。协议不承诺任意故障下 exactly-once，不能用“至少一次”重试掩盖副作用风险。

## 11. 输出、失败与活动边界

| DSH 事实 | 协议投影 | 要求 |
| --- | --- | --- |
| 输入被认领 | message.claimed | 真实 message/request/activity 关联 |
| 实时助手流 | assistant.delta | 按 attempt，bridge index 从 0 连续生成，只转允许展示文字 |
| 已提交助手消息 | assistant.message | 稳定 ID/turn，替换临时输出，重放不重复追加 |
| 工具开始/结束 | tool.started / tool.finished | 有界脱敏摘要，不默认原始参数和终端内容 |
| 等待用户 | activity.state / interaction.requested | 无回答能力时明确回 DSH GUI 操作 |
| 权威活动终态 | activity.ended | completed/failed/cancelled/interrupted |
| GUI 输入或会话变化 | session.changed | 驱动刷新，不强行归因、不当作任务成功 |

completed 表示执行活动正常结束，不保证测试通过、代码正确或部署成功。模型正常解释工具失败时保留真实结果；不能只靠自然语言是否出现“失败”推断终态。HTTP 202 或 idle 本身不能证明成功。

只有已提交消息而没有可靠增量时，如实写明输出粒度，不模拟虚假的逐字生成。不得输出原始私密推理、环境、凭据或未经授权的其他会话内容。

## 12. SSE、快照水位、回放与背压

为可观测会话维护串行安全投影，生成实例作用域 cursor。建议有界回放缓存：最多 5 分钟或 2000 个事件，并设总字节预算，实际值写入配置文档。过滤授权会话后出现序号间隙是正常现象。

快照和事件使用同一顺序边界：在同一临界区读取投影与水位 C，后续 C+1 由回放衔接；订阅先回放再原子接入实时流。不能把读取历史结束时的当前最大序号当成快照水位，否则会漏事件。

游标未知/过期/跨实例时，发送 resync.required 后关闭流，客户端重新 info/snapshot。缺少 Last-Event-ID 不偷偷回放全部历史。重启可查询旧台账，但不能把旧 cursor 当新实例水位。

模型高频文字以约 50–100 ms 合并再分配 bridge index；业务事件正常≤30/s。心跳使用 SSE 注释，不推进 cursor。处理 res.write 返回 false 和 drain；慢客户端缓冲有界，超限关闭该流并要求恢复，不能堵住 Agent 或其他客户端。

UTF-8 完整帧≤64 KiB。断线的未完成帧不能算已应用；终态与已提交消息不能在合并中丢弃。桌宠只有 1 条 SSE/插件，其他会话状态可切换后通过快照查询。

## 13. 可选取消、审批、人格与追加指令

### 13.1 session.cancel

校验活动仍与 expected activityId 匹配，旧请求不能取消新任务。取消请求返回 cancelling，不冒充已终止；以后用真实 activity.ended 确认。说明本机取消是否清 inbox/影响子活动，不能悄悄丢弃其他前端排队内容。不支持就不声明能力，不能终止整个 Host 代替。

### 13.2 interaction.answer

复用 DSH 真实审批/问答标识与唯一决定，只处理授权会话中正确路由的请求，不全局抢答。DSH GUI 先回答则桌宠请求立即失效，反向也一样；到期、取消、重复、竞态均验证。

没有安全跨前端提交入口时，保留 GUI 原审批，不声明 interaction.answer。不能默认允许、改变权限策略或另外创建“总能批准”的回答器。答案必须符合已发布的选项/问答 schema。

### 13.3 persona.update / message.steer

人格只作用于绑定的 Agent scope，不替换全局 prompt。同 revision 同内容幂等，内容冲突拒绝，更小 revision 不回退。忙碌无法安全应用就 SESSION_BUSY；空闲用官方机制更新，不能重建会话/删历史。记忆是用户背景，不是扩权指令。

steer 必须明确选择且授权，不能把忙碌 followup 自动转为追加。依然维护真实消息与活动关联。

## 14. 反向工具的实现边界

v4.2.2 没有桌宠通用工具注册/跨插件执行服务；基础 pet-dsh/1 也没有完整的动态工具注册端点。因此默认不声明 pet.tools，不硬编码“桌宠一定能创建待办”。

可以实现可注入工具桥接和模拟客户端，但报告应写“模拟验证，未与真实桌宠工具联调”。未来新增注册机制需形成双方明确的兼容扩展，不偷偷新增基础协议 op。满足对端依赖后的流程：

1. 客户端通过双方约定的可信机制声明工具名、参数 schema、权限和可用状态。
2. 在绑定会话 scope 注册具体工具，DSH 工具策略和桌宠权限都生效。
3. 模型调用生成 callId，绑定 client/instance/session/activity/name/参数哈希/过期时间。
4. 发送 pet.tool.requested，异步等待结果，继续处理 HTTP/SSE/取消。
5. pet.tool.result 只接受正确客户端的同一次未失效调用；相同结果幂等，不同结果冲突。
6. 桌宠实际完成副作用才回报成功；断线通过 pendingPetCalls/结果台账恢复，不确定就 unknown，不自动重做。
7. 超时、Agent 取消、插件卸载结束等待并释放注册，不能虚构成功。

未来首批工具为 todo.list/todo.create/todo.complete/ui.notify。当前未有名字映射时以实际协商声明为准，不开放通用 plugin.execute、shell 或凭据读取。

## 15. 生命周期与失败处理

启动：验证依赖/配置 → 载入授权和台账 → 恢复映射投影 → 注册事件 → 绑定 loopback → 公布非秘密地址/版本。部分启动失败要回滚资源，不能留一个无认证或无持久化的端口。

停用：停止新提交 → 关闭 SSE/心跳 → 结束本插件的待交互与工具等待 → 释放订阅和 scope → 刷新台账 → 关闭监听。不能销毁借用的用户 Agent，不默认取消已经提交的工作。

客户端撤销只释放其自身资源；配置重载不关闭所有用户会话。损坏/未来版本持久文件保留原件并拒绝危险写入，不自动重置导致重复执行。基础版不需要创建自己拥有的新 AgentHandle。

## 16. 开发阶段与可检查产物

| 阶段 | 工作 | 通过条件 |
| --- | --- | --- |
| D0 | 本机版本/类型/服务盘点 | COMPATIBILITY.md 和最小探针证据 |
| D1 | 插件包、loopback、认证 | 安装/停用、401/403、Host/Origin/限额 |
| D2 | 会话输入输出 | 复用活跃会话、回复、历史、GUI 可见性 |
| D3 | 事件投影、恢复与台账 | 崩溃/断线/幂等/快照订阅竞态通过 |
| D4 | 可选控制 | 每项单独验证后才声明能力 |
| D5 | 模拟桌宠 CLI、构建与打包 | 不依赖尚未完成的桌宠 ZIP |
| D6 | 真实 DSH 验证与交付 | 区分模拟、真实 DSH、未来真实桌宠证据 |

完成当前权限下可独立进行的开发，不在每个阶段只交计划就停止。需要用户参与时提供已经准备好的具体安装/测试操作与原因；未经执行的测试不能计入通过。

## 17. 测试矩阵

默认 fake HarnessAdapter + 真本地 HTTP/SSE，不消耗模型；真实 DSH/付费模型使用 opt-in 测试。

| 类别 | 必测内容 |
| --- | --- |
| 契约 | 六端点/方法、版本、Schema、旧实例、缺少可选能力 |
| 认证 | 缺/错/撤销 token、跨客户端会话越权、Origin:null、错误 Host |
| 输入 | 超 64 KiB、畸形 JSON、错误类型、空/长文本、陌生 op、URL/shell 字段 |
| 会话 | 原 Agent 复用、无自动创建、活跃/忙碌/历史不可用、GUI 输入关联 |
| 回执 | 202 快速返回，失败由真实事件呈现，不能将回执当成功 |
| 台账 | 同内容只执行一次、冲突拒绝、24h、磁盘满/损坏、各崩溃窗口 |
| SSE | 中文跨字节、各种换行、id、心跳、半帧 EOF、合并与 30/s |
| 恢复 | 快照与订阅间输出、游标过期、重启、会话过滤、重复消息 |
| 输出 | attempt 重试区分、私密字段过滤、完整替换、大输出明确裁剪 |
| 背压 | 慢客户端关闭、缓冲有界、其他客户端与 Agent 正常 |
| 可选 | 旧 activity 取消防护、审批双端竞态、人格 scope/revision |
| 未来工具 | callId 绑定/超时/断线/重复副作用/无死锁 |
| 生命周期 | 端口/流/timer/订阅释放、重启无重复注册、用户会话继续 |
| 包内容 | 必要文件齐全，无 token、用户状态和开发原始材料 |

每类记录命令、前置条件、实际结果和证据位置。测试生成包与实际安装包应来自同一源码；curl /info 成功不能代替端到端通过。

## 18. 无桌宠插件时的联调脚本

交付 bridge-smoke CLI，使用与桌宠相同的 HTTP JSON/SSE 语义，通过交互或受保护配置读取凭据，不写进命令历史/脚本。

1. GET info，检查精确协议和实例，输出无 token 诊断。
2. GET sessions，用户选择授权的测试会话。
3. GET snapshot，保存 cursor，再建立唯一 SSE。
4. POST 无副作用测试消息，记录 requestId/messageId。
5. 在请求超时内取得回执，继续等待真实事件。
6. 断开 SSE 并恢复，不重发 message.send。
7. 相同 requestId/内容检查去重，不同内容检查冲突。
8. 支持取消时只取消脚本已知的测试活动，不支持则明确 capability 缺失。
9. 停用插件确认端口关闭，原会话在 DSH GUI 仍可继续。

真实模型调用需在用户允许的测试会话进行并说明费用来源。桌宠 ZIP 尚不存在时报告“兼容宿主语义的模拟客户端通过”，不能报告“已在桌宠验证”。

## 19. 最终交付要求

- 独立源码、构建配置、锁文件、可安装 npm 包或本机 DSH 支持的等价 bundle。
- README：验证过的安装/启用/停用/卸载命令、根地址、token 生成/撤销、会话授权、六端点、错误、升级/降级。
- COMPATIBILITY.md：精确 DSH/Node/系统/profile、关键 API 实证、已开启与未开启能力。
- TEST_REPORT.md：模拟、真实 DSH、真实桌宠分别列出实际结果，附日志/截图。
- 无真实 token 的示例配置，默认会话允许列表为空。
- 协议/Schema 副本和 SHA-256，说明不是旧 /dsh-pet/act 协议。
- 最终简报：实际运行版本、实现功能、测试、包路径、未验证项和具体原因。

基础五项能力真实工作、用户会话不受破坏、模拟客户端跑通、恢复不重复副作用，才达到基础交付。不能用硬编码成功、空实现、永久 501 或“全部支持”表述替代。可选能力如受目标版本或对端限制，关闭并记录即可。

## 20. 官方参考与执行时复核

下列页面于 2026-10-21 核对，作为定位参考；必须以本机安装版本验证并锁定依赖。

- [DSH 架构](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)：profile/bundle 与扩展边界。
- [Agent 接口](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/agent/README.md)：既有 Agent、输入、事件与生命周期。
- [插件管理](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/boot/plugin-manager/README.md)：创造模式管理入口和审批。
- [提示词机制](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/system-prompt.md)：作用域和动态上下文。
- [审批机制](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/approval.md)：唯一决定与失败关闭。
- [工具机制](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/tools/README.md)：注册、作用域、执行策略。

本文的 adapter/目录/DTO 补全/台账/测试是本项目设计，不是声称 DSH 官方已有同名完整功能。不要直接依赖未来 master 的变化。

---

## 附录 A：共同协议原文

下文完整嵌入 DSH_BRIDGE_PROTOCOL.md；原文相对链接属于原仓库目录，单独发送本文件时以嵌入文字和交接包 Schema 为准。

<!-- embedded-protocol:start -->

# 桌宠 × DSH 共同协议声明

协议：`pet-dsh/1` · 修订：1.0.0 · 日期：2026-10-19 · 宿主基础版本：v4.2.2。

状态：供两端独立实现的第一版契约；本次仅交付契约和通用宿主通信能力，尚未完成两端插件或真实 DSH 联调。此协议不等于 DSH 官方协议，也不承诺支持未验证的 DSH 版本。

## 1. 责任与兼容性

- 桌宠插件负责连接流程、协议校验、会话绑定、事件投影、重连与用户界面。
- DSH 插件负责本地端点、认证、授权、会话适配、操作台账和事件转换；使用 DSH 正常 Agent/Session API，不直接改写会话文件。
- 宿主仅提供 `context.localService`：受控 HTTP、SSE、配置窗口、加密凭据和生命周期。宿主不得导入本协议、识别 DSH 字段或提供 `context.dsh`。
- DSH 是历史与执行状态的事实来源。桌宠缓存只供显示；桌宠侧业务（如待办）由对应功能负责。
- JSON Schema 见 [机器可读声明](schemas/dsh-bridge-v1.schema.json)。协议版本与宿主、插件、DSH 版本分别管理。
- 握手必须精确包含 `pet-dsh/1`。新增可选能力通过 `capabilities` 协商；缺少的能力不得显示为可用。未知事件类型可忽略，已知事件中的未知可选字段可忽略；禁止推测不兼容主版本的含义。

## 2. 传输与认证

DSH 插件监听 `127.0.0.1` 或 `::1`，桌宠主动连接。建议服务根路径 `/pet-bridge/v1/`，端口由实际实例提供，不固定为 3080。所有下列路径均相对于该根路径。

v1 使用 HTTP JSON 请求和 SSE。JSON 为 UTF-8，SSE 为 `text/event-stream`；无 WebSocket、文件附件、远程连接或任意命令执行端点。

所有业务请求均带 `Authorization: Bearer <connection-token>`。连接 token 是桥接授权凭据，不是模型 API Key；绑定客户端与允许的会话/能力。服务端不得回显 token，不允许 URL 参数传 token，不开启通配 CORS，不接受浏览器 Origin 的业务请求；认证失败为 401，授权不足为 403。

首版人工开通：用户在 DSH 侧生成/获取连接 token，在桌宠宿主专用窗口填写地址与 token。宿主加密保存并注入请求头，插件只能看到配置状态。自动读 `~/.dsh`、配对文件、配对码交换与凭据签发均不在 v4.2.2 宿主实现范围；未来可协商配对能力，但不得经普通插件 RPC 返回长期 token。

服务端必须验证 Host、认证及请求长度，并限制会话访问。loopback 不是充分认证。客户端不跟随重定向，不把凭据发往另一个地址。普通 HTTP 请求最长 15 秒；执行操作必须快速返回接收结果，长任务走事件。SSE 每 15 秒至少发一条注释心跳；客户端 45 秒未收到任何数据即可关闭并重连。

## 3. 标识与消息格式

通用标识为 1–100 个 ASCII 字母、数字、`_`、`-`、`.`；`requestId` 为客户端生成的唯一操作标识。`instanceId` 标识这次服务运行，重启必须变化；它不是认证凭据。`sessionId` 由服务端提供，客户端不能借提交陌生 ID 获取权限。

请求信封：

```json
{"protocol":"pet-dsh/1","instanceId":"instance-a","requestId":"req-001","op":"message.send","sessionId":"session-a","data":{"mode":"followup","text":"分析这个项目的测试结构。"}}
```

响应信封：

```json
{"protocol":"pet-dsh/1","instanceId":"instance-a","requestId":"req-001","ok":true,"data":{"status":"accepted","messageId":"message-101"}}
```

失败响应使用 `ok:false,error:{code,message,retryable}`，不同时返回 `data`。`retryable` 仅表示可以恢复，不授权自动重发会改变状态的请求。认证失败可不包含 instanceId/requestId，插件必须先看 HTTP 状态再解析业务响应。

建议错误码：`INVALID_REQUEST`、`UNAUTHORIZED`、`FORBIDDEN`、`VERSION_MISMATCH`、`INSTANCE_CHANGED`、`SESSION_NOT_FOUND`、`SESSION_BUSY`、`UNSUPPORTED_CAPABILITY`、`REQUEST_CONFLICT`、`REQUEST_UNKNOWN`、`RESULT_UNKNOWN`、`EXPIRED`、`CANCELLED`、`INTERNAL_ERROR`。对外消息不能包含密钥、完整环境、堆栈或未授权路径。

## 4. HTTP 端点

| 端点 | 行为 |
| --- | --- |
| `GET /info` | 认证后返回 `{protocols:["pet-dsh/1"],instanceId,serverVersion,dshVersion,capabilities,limits}`；不启动模型 |
| `GET /sessions?cursor=...` | 分页列出当前客户端可访问的会话，含 `sessionId,title,workspace,status`；分页游标为不透明字符串 |
| `GET /snapshot?sessionId=...` | 返回同一水位的 `{instanceId,sessionId,cursor,messages,activity,pendingInteractions,pendingPetCalls}`，供首次订阅和断线恢复 |
| `POST /commands` | 接收本节定义的请求信封；只执行声明且授权的操作 |
| `GET /requests?requestId=...` | 查询操作接收台账和可确认结果，不能触发重执行 |
| `GET /events?sessionId=...` | SSE；请求头 `Last-Event-ID` 为上次已应用的游标 |

`info` 的基础能力为 `sessions.list`、`session.snapshot`、`message.send`、`events.follow`、`requests.lookup`。`session.cancel`、`interaction.answer`、`pet.tools`、`persona.update`、`message.steer` 均需另外声明。能力字段不代表自动授权。

`POST /commands` 的操作和 data：

| op | data | 能力 |
| --- | --- | --- |
| `message.send` | `{mode:"followup",text}`；text 为非空，最多 4000 字符 | 基础 |
| `message.send` | `{mode:"steer",text}`；明确的用户追加指令 | `message.steer` |
| `session.cancel` | `{activityId}`；必须匹配当前活动，不能杀死整个 DSH 进程 | `session.cancel` |
| `interaction.answer` | `{interactionId,choiceId}` 或 `{interactionId,answers}`；答案须满足对应请求的 schema | `interaction.answer` |
| `pet.tool.result` | `{callId,ok,result}` 或 `{callId,ok:false,error}`；不能同时包含 result/error | `pet.tools` |
| `persona.update` | `{characterId,revision,persona,memory}`；persona≤2000、memory≤4000 字符；仅作用于绑定会话，按 revision 防止倒退 | `persona.update` |

普通提交遇到忙碌会话返回 `SESSION_BUSY`，不静默转为 steer。首版不开放自动新建/重置/删除会话、任意模型切换、任意 URL 或 shell 命令。历史会话恢复是否支持由 DSH 适配器验证后声明，不能对同一 session 重建第二个活跃 Agent。

成功接收为 HTTP 202，读操作/确定性控制结果为 200，参数错误 400、会话不存在 404、忙碌/标识冲突 409、体积超限 413、过载 429、不支持的能力 501；失败响应应尽可能携带对应协议错误。

## 5. SSE 事件

SSE `event` 固定为 `bridge`，`data` 是一个 JSON 信封；`id` 与信封 `cursor` 完全相同。注释心跳不推进游标。客户端必须先校验协议、实例、会话和字段再应用事件。

```text
id: instance-a.105
event: bridge
data: {"protocol":"pet-dsh/1","instanceId":"instance-a","sessionId":"session-a","cursor":"instance-a.105","type":"assistant.message","data":{"messageId":"assistant-205","text":"项目包含单元测试和界面验证。","turn":12}}

```

游标只要求同实例、同客户端授权事件流中有序且不重复，不允许客户端跨实例比较。首次先取 snapshot，再从其 cursor 订阅；服务端须保证快照水位与后续事件衔接。服务端过滤其他会话后可以产生序号间隙，客户端不能把数字不连续直接当丢包。

| type | data 的核心字段 | 含义 |
| --- | --- | --- |
| `message.claimed` | `requestId,messageId,activityId,turn` | 消息进入哪次执行 |
| `assistant.delta` | `activityId,attemptId,index,text` | 某次生成的增量文本；index 从 0 连续增长，重试换 attemptId |
| `assistant.message` | `messageId,turn,text,attemptId?` | 已提交的完整消息，替换对应临时输出；作为恢复依据 |
| `tool.started` | `activityId,callId,name,summary` | 工具开始；不默认发送完整参数、终端或凭据 |
| `tool.finished` | `activityId,callId,status,summary` | 工具结果摘要 |
| `activity.state` | `activityId,status` | running / waiting-approval / waiting-input / cancelling |
| `activity.ended` | `activityId,outcome` | completed / failed / cancelled / interrupted；idle 本身不等于任务成功 |
| `interaction.requested` | `interactionId,activityId,kind,summary,choices?,schema?,expiresAt` | 审批或问题，kind 为 approval / question |
| `interaction.resolved` | `interactionId,outcome` | 任意前端已回答或请求失效，其他界面移除按钮 |
| `pet.tool.requested` | `callId,activityId,name,arguments,expiresAt` | 调用桌宠声明的具体能力 |
| `pet.tool.resolved` | `callId,outcome` | 已有结果、取消或过期 |
| `session.changed` | `status` | 会话范围变化，不强行归到某个请求 |
| `resync.required` | `reason` | 游标已失效，客户端关闭流、读取新快照 |

只有确有因果关联时才在事件中附带 requestId；多个前端共同参与的活动不能虚构一条 prompt 对一条最终回复。不得通过转发原始 DSH 事件来省略字段筛选。原始 provider 流、私密推理、环境和其他会话数据不在协议默认展示范围。

流结束只说明连接结束；未收到确定性活动结果时，任务状态为 unknown。宿主不会自动重连，插件按 1、2、4、8、最多 30 秒退避，401/403 或协议不兼容停止重试。重连后重新核对实例与 snapshot，不重放历史动画/字幕提醒。

## 6. 幂等、并发和操作台账

- 幂等键为认证客户端 + requestId；相同键、相同规范化内容返回已记录状态，不再执行；不同内容返回 REQUEST_CONFLICT。
- DSH 侧必须维护持久操作台账及消息关联。崩溃发生在入队与记账之间时，先通过已保存消息标识核对；无法证明是否执行就返回 RESULT_UNKNOWN，不能为了“至少一次”自动重执行。协议不宣称任意故障下的 exactly-once。
- `requests` 返回 received / accepted / running / ended / rejected / unknown，以及已知 messageId、activityId 和结果。台账保留至少 24 小时；过期记录为 unknown，不当作从未执行。
- 每个绑定会话只接受一个桌宠主动活动；其他 DSH 前端仍可能参与，桥接不冒充全局独占锁。
- 取消以 activityId 校验目标，并反馈实际终止状态。取消模型/工具不能撤销已经完成的文件或待办修改。
- 审批遵循 DSH 的唯一决定与失效机制；不覆盖既有审批策略、不全局抢占其他前端请求。无法安全接入则不声明 interaction.answer，桌宠只提醒到 DSH 处理。

## 7. 反向工具、人格与生命周期

`pet.tools` 仅向明确绑定且在线的桌宠客户端派发调用；工具名称/参数/权限需由桌宠声明，当前 v4.2.2 未实现跨插件工具注册或调用。未来先开放 todo.list / todo.create / todo.complete / ui.notify，不开放通用 plugin.execute、文件路径、shell 或凭据读取。

callId 绑定客户端、实例、会话及工具参数；同一调用结果不得被其他会话复用。桌宠侧应按 callId 去重副作用，完成后才回报成功。过期/断线结果为 unavailable 或 unknown，不虚构成功。控制请求、SSE 消费和工具结果回传不得被主任务的串行锁阻塞。

人格/手工记忆由桌宠插件保存，仅向选定会话提交，不改全局 DSH 提示词。修改 revision 在下一次可安全入场时生效；运行中无法安全应用就返回 SESSION_BUSY，不销毁原有会话或抹除历史。清除记忆只停止未来携带，不能删除 DSH/服务商已收到的历史。

禁用桌宠插件关闭它的 HTTP/SSE 和回调，撤销本地工具权限；不自动停止已提交的 DSH 任务。卸载 DSH 桥接插件移除路由/订阅；只释放自己拥有的 AgentHandle，不销毁接入的用户会话。工作目录不等于文件隔离边界，工具限制还需与 DSH 实际沙盒和作用域规则共同验证。

## 8. 限额与验收

JSON 请求≤64 KiB、响应/快照≤256 KiB；SSE 单个事件≤64 KiB，正常平均不超过每秒 30 个业务事件，突发限流。分页结果和历史必须裁剪，不能靠无限加大快照绕过预算。v4.2.2 通用宿主最多并发 4 个 HTTP、1 条 SSE/插件，不重试变更请求。

双端未来必须验证：版本不符与未授权拒绝；既有会话双端可见；提交回执和真实完成分开；忙碌与追加区分；取消目标校验；SSE UTF-8/断线/快照恢复；重复请求不重复副作用；审批唯一决定；反向工具不死锁；停用资源释放且不销毁用户会话。

v4.2.2 仅验证通用宿主与模拟本地服务，真实 DSH 版本、插件安装、GUI 会话复用和上述业务流程仍待后续实现验收。

历史草案 [v0.3 桥接设计](design/dsh-pet-bridge.md) 中的专用 dsh.link、自动读取配对文件及重建会话等方案不属于本契约；现有 dsh-pet-bridge 骨架也不被声明为兼容服务。

<!-- embedded-protocol:end -->

## 附录 B：桌宠宿主实际接口原文

下文完整嵌入 LOCAL_SERVICE_API.md，供对齐传输行为，不要求 DSH 修改或实现 Electron 宿主。

<!-- embedded-host-api:start -->

# 通用本地服务能力（v4.2.2）

权限 `net.local`，插件 API v1 的增量能力。外部 ZIP 仍无 fetch、Node、系统文件或任意网络。宿主提供通道，不理解 DSH、Agent、会话、工具参数或消息内容。

## 授权与配置

1. 插件在 manifest.permissions 声明 `net.local`，用户在 ZIP 导入时确认权限。
2. 插件调用 `context.localService.configure()`，宿主打开独立可信窗口。可将此操作绑定到插件自己的 managerOnly 设置按钮。
3. 用户填写完整服务根地址及连接令牌，点击“授权并保存连接”。地址必须为 `http://127.0.0.1:明确端口/路径/` 或 `http://[::1]:明确端口/路径/`。不支持 localhost、DNS、远程地址、URL 凭据/查询、重定向或自动端口扫描。
4. 宿主按插件身份加密保存完整记录。插件仅能获取 configured、endpoint 和固定错误码，不能指定 Authorization/其他请求头，也不能通过配置接口读取令牌。连接服务本身是信任边界，不能防止用户授权的恶意服务另行泄露其已知令牌。
5. 路径授权覆盖根路径下的读取和变更请求，不等于只读授权。修改/移除配置停止该插件全部传输并发出 configuration.changed。配置保留到显式移除，禁用/卸载只撤销运行能力。

## 接口

```js
const local = context.localService; // 仅在实际授权 net.local 时注入
const release = await local.subscribe(event => {
  // event 是通用传输事件，由插件识别协议/错误/业务含义。
});
const status = await local.status(); // {configured, endpoint, error}
await local.configure(); // {opened:true}；不等待用户输入，不启动连接
await local.request({requestId:'info-1', method:'GET', path:'/info'});
await local.request({requestId:'send-1', method:'POST', path:'/commands', body:{example:true}});
await local.stream({streamId:'events-1', path:'/events', query:{sessionId:'session-a'}, lastEventId:'instance-a.105'});
await local.cancel({requestId:'send-1'}); // 或 {streamId:'events-1'}，不能同时提供
release(); // 只退订回调，不会自动取消传输
```

`request` / `stream` 快速返回 `{requestId|streamId,accepted:true}`。这是宿主接受传输的回执，不是服务端执行回执。须先 subscribe 再提交。HTTP 的 requestId 用于本地操作关联；与 body 内协议 requestId 的映射由插件负责。

请求方法：GET / POST / PUT / PATCH / DELETE；GET 不允许 body。body 必须为可 JSON 序列化数据。只允许文档列出的字段，禁止传 URL、headers、cookie、代理或 TLS 参数。

path 是以 `/` 开头的服务内路径，拼接到授权根路径；例如根地址 `http://127.0.0.1:3080/bridge/` 加 `/info` 实际访问 `/bridge/info`。拒绝绝对地址、双斜线、反斜线、百分号编码、`.` / `..` 路径段、查询与片段。query 为最多 20 个 string→string 参数，宿主编码；值不能被当作 URL 执行。`/` 表示根路径本身。

同一活跃操作不能重复使用 requestId/streamId。传输结束后可以复用，但业务 requestId 的长期幂等必须由插件与服务端实现。HTTP 结果包括 4xx/5xx，只要有合法 JSON 就以 response 返回，不自动重试；重定向直接拒绝。204 为 data:null。

## 事件

| type | 其他字段 | 行为 |
| --- | --- | --- |
| configuration.changed | configured,endpoint,error | 用户保存/移除配置 |
| response | requestId,status,ok,data | 有限大小的 JSON HTTP 响应；不提供响应头、cookie、URL |
| request.error | requestId,code | 本地请求失败/取消/超时；不回传原始异常 |
| stream.open | streamId | 已验证 HTTP 200 和 text/event-stream |
| stream.event | streamId,event,data,lastEventId,retry? | SSE framing 结果；data 是字符串，不解析业务 JSON |
| stream.end | streamId | EOF；不能推断业务任务成功 |
| stream.error | streamId,code | 取消、断线、超时或限额错误 |

SSE 支持 UTF-8 分片、CR/LF/CRLF、多行 data、注释心跳和持久 id；没有空行终止的半个事件在 EOF 丢弃。retry 仅报告，宿主不自动重连。Last-Event-ID 由插件选择，限 200 个可打印 ASCII 字符。配置令牌的直接明文回显会被替换为 `[redacted]`，插件仍不得把服务数据当作 HTML 或指令执行。

固定错误码包括：NOT_CONFIGURED、CONFIG_UNAVAILABLE、ENCRYPTION_UNAVAILABLE、NETWORK_ERROR、TIMEOUT、CANCELLED、HTTP_401、HTTP_403、INVALID_CONTENT_TYPE、INVALID_RESPONSE、RESPONSE_LIMIT、INVALID_EVENT_STREAM、EVENT_LIMIT、RATE_LIMIT。格式/权限/并发错误在 RPC 提交时拒绝；插件应显示通用错误并允许用户查看配置，不依赖内部异常文案。

## 预算与生命周期

- 每插件最多 4 个 HTTP、1 条 SSE；每个沙盒最多 1 个本地事件订阅。
- 请求 JSON≤64 KiB，HTTP JSON 响应≤256 KiB，SSE 事件≤64 KiB；事件类型≤100 字符、id≤200 字符。
- 请求/握手 15 秒超时，SSE 收到任何字节都会刷新 45 秒空闲超时。
- SSE 每秒最多 120 个事件或 1 MiB 数据，超限关闭流；业务插件应进一步合并文本，避免超过宿主 publish 预算。
- 禁用、卸载、进程崩溃和权限撤销取消全部传输并释放订阅；异步迟到结果不会发送给已撤销的实例。
- `cancel` 只取消网络传输，不能取消远端已经接收的任务；停止 DSH 任务需要插件另外发送协议命令。
- 同时保持 SSE 消费与短 HTTP 请求，不把整个远端执行塞进插件的 7 秒命令等待。

## 与 DSH 的关系

[pet-dsh/1 共同声明](DSH_BRIDGE_PROTOCOL.md) 和 [JSON Schema](schemas/dsh-bridge-v1.schema.json) 供后续插件实现。宿主代码不会导入这两份业务声明。已有 dsh-pet-bridge 旧骨架不属于已验收服务，也不会自动连接。

## 验证

`pnpm test:local-service` 使用本机模拟 HTTP/SSE 服务验证地址、授权路径、凭据隔离、响应与流、取消、超时和权限撤销。`pnpm test:local-service:sandbox` 使用真实 Electron ZIP 沙盒与宿主配置窗口验证 RPC、隔离和资源释放。不调用模型、不读取真实 DSH 配置、不产生 API 费用。

SSE framing 参考 [HTML Standard](https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation)；本实现是受控流客户端，不实现浏览器 EventSource 的自动重连/重定向行为。加密能力参考 [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)。

<!-- embedded-host-api:end -->
