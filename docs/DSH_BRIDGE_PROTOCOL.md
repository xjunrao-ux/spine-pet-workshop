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
