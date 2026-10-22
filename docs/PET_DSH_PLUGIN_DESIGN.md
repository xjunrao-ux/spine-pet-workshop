# 桌宠 DSH 插件完整设计

> 保留的设计与开发交接记录；当前交付范围见 [实现说明](PET_DSH_PLUGIN_IMPLEMENTATION.md) 与 [正式版指南](versions/v5.1.2.md)。下文“尚未实现”描述的是设计当时的基线。

设计版本：1.0.0

日期：2026-10-21

状态：设计基线；本文及配套 JSON 仍是设计资料。2026-10-21 已另交付可安装客户端，见 [实现说明](PET_DSH_PLUGIN_IMPLEMENTATION.md) 与 [测试报告](DSH_PET_PLUGIN_TEST_REPORT.md)。

适用宿主：Spine 桌宠工坊 v4.2.2，插件 API v1，通用本地服务能力 `net.local`。

对接基线：`pet-dsh/1`，共同声明修订 1.0.0；仓库 `@local/dsh-pet-bridge@1.0.0`。

## 1. 产品目标与首版边界

让用户在桌宠面板中选择一个已经运行且明确授权的 DSH 会话，发送代码与项目任务，持续查看回复、工具摘要和执行状态，并在具备能力时请求停止当前活动。沿用 DSH 的模型、会话、工作目录、工具及审批规则。

桌宠插件负责连接、协议、界面、状态恢复和本机数据；DSH 插件负责复用 Agent、接收命令、投影会话、发布事件和保存请求回执；桌宠宿主只负责通用网络代理、凭据隔离、沙盒和标准组件。业务代码应在插件中完成。

首版交付范围：

| 功能 | 首版行为 |
| --- | --- |
| 连接配置 | 由宿主可信窗口录入服务根地址、连接令牌；插件只见配置状态和地址 |
| 协议握手 | 检查协议、实例、必需能力与限额，不以版本号代替能力协商 |
| 会话选择 | 列出授权会话，由用户明确选择；不自动创建、恢复或选择第一项 |
| 对话 | 普通 followup、已提交历史、流式可见文本；不展示私密推理 |
| 项目任务 | 显示工作区名称、活动状态、最近工具摘要、结束原因 |
| 停止任务 | 双方授权且声明 cancel 时，对明确的 activityId 请求取消 |
| 追加指令 | 服务声明 steer 且用户主动开启后提供；默认关闭 |
| 断线恢复 | 重新握手、快照和订阅；对未决命令查询回执，不自动重发 |
| 本机人设与记忆 | 一份可手动编辑的本机资料；当前服务不支持同步，保存后明确提示“未发送给 DSH” |
| 提醒 | 功能默认关闭；仅新收到的实时结束/待审批状态生成一次提醒 |
| 桌宠审批、日程工具 | 当前不可用；说明缺失能力，不生成可点击的虚假操作入口 |

API 聊天插件与 DSH 插件保持独立。此插件不要求模型 API Key，不把本机聊天缓存作为 messages 重新提交给模型，也不修改已有 DeepSeek 对话插件。

## 2. 基线、依据与契约优先级

共同声明：[DSH_BRIDGE_PROTOCOL.md](DSH_BRIDGE_PROTOCOL.md)。

宿主通道：[LOCAL_SERVICE_API.md](LOCAL_SERVICE_API.md)。

核心包络：[dsh-bridge-v1.schema.json](schemas/dsh-bridge-v1.schema.json)。

当前服务实现与能力依据：`dsh-pet-bridge/src/`、`COMPATIBILITY.md`、`TEST_REPORT.md`。

标准组件与参数校验依据：`electron/plugins/contracts.mjs`、`src/plugins/types.ts`。

共同声明决定跨端语义，宿主实现决定可调用的 API，当前服务源码决定本轮可落地范围。发现矛盾先记录为兼容问题，不新增私有字段让两端默默分叉。配套 `baseline.json` 记录文档、契约与服务源码哈希，供实现者确认是否使用同一基线。

当前 DSH 实现的兼容报告记录了 DSH 桌面端 0.2.0-rc.2、Harness 0.1.1-rc.2、Cordis 4.0.1。其测试报告属于 DSH 端已有验证，不是本次桌宠插件联调结果。本设计没有启动真实 Agent 或调用付费模型。

当前能力矩阵：

| info.capabilities | 当前服务 | 桌宠处理 |
| --- | --- | --- |
| sessions.list / session.snapshot / message.send / events.follow / requests.lookup | 基础实现 | 五项必须齐全，否则停在不兼容状态 |
| session.cancel | 服务默认启用，仍需客户端授权 | 按握手结果显示停止操作 |
| message.steer | 实现，默认关闭，还需客户端授权 | 双开关启用；无能力时禁用 |
| interaction.answer | 未声明，命令返回 501 | 只提示去 DSH 界面审批 |
| persona.update | 未声明，命令返回 501 | 本机可编辑，远程同步禁用 |
| pet.tools | 未声明，命令返回 501 | 无跨插件调用、无自动建日程 |

每次握手都重算能力。隐藏在文档里的预期、上次缓存的能力、服务版本较新，都不能视为授权。

## 3. 模块结构与职责

建议未来实现目录为 `examples/dsh-pet-plugin/`，稳定插件 ID 为 `io.spine-workshop.dsh-pet`。对接配置按插件身份保存，发布后不要随意改 ID。

开发源码可拆分模块，最终构建为单个沙盒入口：

| 模块 | 职责 |
| --- | --- |
| provider | activate、execute、onSettingsChanged、dispose；连接宿主生命周期 |
| local-transport | 唯一 localService 订阅、传输 ID 分配、并发控制和错误归一化 |
| wire | 包络及 DTO 校验、端点映射、命令构造；不承担 UI |
| connection | 握手、选择会话、快照、订阅、重连与代际控制 |
| projection | 按实例/会话归并事件、消息、增量尝试、工具和活动 |
| command-journal | 写前日志、命令状态、回执查询和不确定结果 |
| storage | 配置迁移、配额控制、缓存与未决记录持久化 |
| view | 只读领域状态并生成标准快照、确认卡片与输入表单 |
| reminders | 可选、实时事件去重提醒；不改变远端任务 |

禁止把 DSH 协议、会话选取、人格提示拼接或任务语义下沉到宿主。首版所需网络、存储和 UI 均已有通用接口；没有角色动画控制、当前角色 ID、剪贴板、打开外部程序或通用跨插件执行接口，不假设这些能力存在。

## 4. 界面设计

所有状态都保留插件入口：`available:true`，`entryVisibility:"when-enabled"`。即使离线也可以进入连接页和查看故障原因。

使用现有 text、status、group、button、form、chat、list、progress 组件，无自定义 DOM、CSS 或下拉菜单协议。配套 `ui-snapshots.json` 给出可通过宿主校验的具体快照。

### 4.1 对话页 chat

顶部展示连接状态、会话标题、工作区名称；同步中或缓存显示必须有明显说明。正文包括最多 20 条近期已提交消息，加至多一条当前助手临时输出，总数不超过宿主 chat 的 24 条上限。

底部固定 composer，单 text 字段，最多 4000 个 JS UTF-16 单元，并再满足服务 messageChars 与请求字节限额。提交前拒绝全空白，但不擅自改写代码缩进和正文。空白检查用 trim，实际发送保留原文。

发送中的本机文本放在“发送记录”卡片，不冒充 DSH 已提交历史。只有服务 messageId 和快照证明提交后，才归入权威历史；临时卡片随后去重消失。

每个绑定会话最多一个未查清的桌宠提交；unknown 未决记录未查清前不开放新发送。默认模式 followup，运行中不允许继续排队普通发送，提示等待当前活动。启用 steer 后可切换到“追加指令”，文案注明将在 DSH 的后续步骤边界处理，并非立即中断。模式切换也是命令，提交时再次校验能力和代际。

composer.pending 会让宿主阻止提交，且有 stopAction 时发送按钮被替换。因此 followup 运行期可用 pending+stopAction；steer 输入模式需保持 pending:false（本地提交在途除外），将停止按钮放在独立 group 或任务页，保证追加指令确实可提交。

底部停止按钮走“确认停止当前活动 → 提交取消 → 等待终态”，不能调用 localService.cancel 代替远程取消。停止动作成功受理后显示“正在请求停止”；收到 ended/cancelled 才显示已取消。

当前服务对 message.send 返回 HTTP 202、data:{status:"accepted",messageId}；session.cancel 返回 HTTP 200、data:{status:"cancelling",activityId}。/requests 的 data 才提供 op、sessionId、acceptedInstanceId 与 ISO 时间戳等日志字段。不要要求普通发送回执包含完整台账。

已发送后不提供“重新生成”“重新运行上一条”的快捷自动重试。结果不明时提供“查询发送结果”和“查看任务”，用户可以另外明确撰写新指令。

### 4.2 任务页 task

展示当前活动 ID、running / waiting-approval / waiting-input / cancelling / unknown、开始后的可用时间信息，以及最近 5 个工具摘要。进度未知时 `progress.value:null`，不编造百分比。

结束结果区分 completed、failed、cancelled、interrupted，不以连接结束、消息出现或 session.changed 作为完成依据。流式文字是暂存展示；助手提交消息与活动结束是两个独立事实。

审批态显示“DSH 正在等待审批，请在 DSH 界面处理”。当前服务的 pendingInteractions 为空，不能凭 waiting-approval 合成“允许/拒绝”按钮。waiting-input 也只显示已知信息，不猜测问题和答案。

### 4.3 会话页 sessions

每页最多 20 行，每行用 group 包含标题、工作区、状态和“选择”按钮。列表组件本身没有行点击能力，不设计隐含点击事件。

游标分页保存返回栈；游标视为不透明字符串。当前授权会话不存在时取消在线绑定，不偷偷选别的会话。available:false 的历史会话可按实际 snapshot 支持只读查看，不尝试创建或恢复 Agent，发送和取消禁用。

切换先显示确认卡片，说明会离开当前视图且未发送输入可能丢失；正在运行的 DSH 任务会继续。确认后更换绑定、关闭旧 SSE、拉取新快照再订阅。命令附带绑定版本，避免旧按钮操作新会话。

### 4.4 连接页 connection

展示 endpoint、协议、serverVersion、dshVersion、当前 instanceId、能力列表与最近固定错误码。endpoint 只读来自宿主；令牌不出现在插件表单、日志或缓存。

操作：配置连接、连接、断开、重新同步、清理本机缓存。配置按钮只打开宿主可信窗口，返回“窗口已打开”不等于配置成功；等待 configuration.changed 再查询状态。

断开只关闭本地网络。提示远端任务可能继续，任务状态变为“未知，尚未重新同步”。“停止任务”是另一项明确动作。

清理缓存需要确认，清理范围写清楚：本机展示历史与已结束记录。不得顺便清除未决发送凭证；未决记录独立保留用于查证。此操作不会删除 DSH 历史、会话或连接令牌。

### 4.5 本机资料页 persona

一个手工配置：人设最多 2000 单元、记忆最多 4000 单元，可独立保存和删除。明确标注“仅本机保存；当前 DSH 桥未提供 persona.update，不会影响 DSH 回答”。

不要把资料悄悄拼接成普通用户消息来模拟人格同步。将来能力可用后新增显式“同步到当前会话”，展示本机 revision；远端确认字段需在双方实现 persona.update 时明确，不能假设当前已有 appliedRevision。手动资料不等于自动记忆提取；首版没有提取、向量检索或自动写回。

当前宿主不提供角色身份事件，这份资料也不自动随桌宠角色切换。后续若要按角色隔离，先新增通用宿主能力再设计迁移。

## 5. 插件清单、权限和命令

配套 `manifest.design.json` 是通过当前宿主清单校验的设计样例。仅声明：

- `net.local`：通过宿主访问用户授权的本机服务。
- `storage.own`：本机资料、少量显示缓存与写前日志。
- `ui.reminders`：提醒功能使用，默认关闭。当前导入器整体授权清单权限，并不支持单项可选授权。

宿主当前没有逐条可选权限的清单字段；不增加 optionalPermissions 字段。实现发提醒前检查 getPermissions()，权限不可用时禁用提醒且不影响对话；如需完全不申请提醒权限，应发布另一份删去该权限的清单。不申请 ai.deepseek、codex.read、文件系统或任意网络。

命令分组：

| 命令 | 参数 | 作用 |
| --- | --- | --- |
| configure / configureManager | 无 | 打开宿主可信配置窗口；后者 managerOnly |
| connect / disconnect | 无 | 启停本地连接 |
| refresh | sessionId, bindingEpoch | 同步当前绑定 |
| loadSessions | 可选 cursor | 加载一页授权会话 |
| selectSession / confirmSession | sessionId, bindingEpoch | 提出/确认切换；确认卡记录目标及代际 |
| setMode | sessionId, bindingEpoch, mode | followup / steer，本机选项 |
| send | sessionId, bindingEpoch, text | 持久化发送意图后提交 |
| requestCancel / confirmCancel | sessionId, bindingEpoch, activityId | 确认并取消指定活动 |
| lookupRequest | wireRequestId | 查询已存在的本机发送记录 |
| savePersona | persona, memory | 仅本机保存 |
| requestClearCache / confirmClearCache | 无 | 仅清理本机显示缓存 |
| dismissConfirmation | 无 | 关闭本机确认卡 |

参数仅字符串、数字、布尔值，逐命令声明；不接受任意 JSON、URL、headers、可执行脚本或动态命令名。wireRequestId 必须来自本机记录，lookup 不能充当任意标识符探测器。所有按钮参数仍需领域校验，不能只依赖宿主类型校验。selectSession / confirmSession 的 sessionId 是目标会话，应对照本次授权列表和确认卡校验；其 bindingEpoch 表示发起选择时的绑定代际，不能错误地要求目标等于当前会话。未选择会话时也有初始代际。

setting：autoConnect=false、enableSteer=false、cacheHistory=true、notify=false。通知仅授予 ui.reminders 后有效；开关本身不授予权限。人格长文本走 form 与 storage，不塞入仅支持简单类型的 settingsSchema。

## 6. 状态模型

连接状态与远端活动状态分开保存：

```text
unconfigured → disconnected → handshaking → selecting / syncing
syncing → subscribing → ready
ready → reconnecting → handshaking
任意态 → auth-required / incompatible / disconnected / disposed
```

连接和页面状态映射：

| 内部状态 | 宿主 snapshot.status | 可写 |
| --- | --- | --- |
| unconfigured / selecting / handshaking / syncing / subscribing | waiting | 否 |
| ready | ready | 还需会话 available、能力与命令规则 |
| reconnecting / disconnected / auth-required | degraded | 否 |
| incompatible / 持久数据不可识别 | error | 否 |

活动独立为 null、running、waiting-approval、waiting-input、cancelling、unknown 或已确认终态。离线时不得保留绿色 running 假装实时；保留“上次状态”并标注更新时间。

内存包含 connectionEpoch、selectionEpoch、bindingEpoch、currentInstanceId、selectedSessionId、capabilities、projection、pendingTransports、confirmation、mode。每次配置变更、切换会话或销毁使相关代际失效。bindingEpoch 是当前激活内单调安全整数，不作为跨重启身份。

每条异步效果捕获当前代际。返回时先清理传输资源，再检查是否仍属活跃连接/会话；不匹配时不得改当前页面、通知或重新启用发送。旧请求仍可更新独立、已匹配的本机未决日志，但绝不能套到新的会话投影。

## 7. 激活与握手流程

1. 检查 context.localService 与 storage 是否实际可用；权限缺失保留诊断页。
2. 注册唯一 localService.subscribe，随后读取配置状态和本机版本化数据。
3. 返回初始 provider 与快照；不要等待网络。autoConnect 开启时异步发起连接，否则等用户点击。
4. GET /info：检查协议、实例、五项必需能力与可接受限额，建立此次能力表。
5. GET /sessions：更新授权列表；曾选会话只能作为候选，仍需本次授权列表和快照确认。没有有效选择时停在 selecting。
6. 对选定会话 GET /snapshot，建立完整投影，记录其 cursor=C。
7. 开启 /events?sessionId，传 lastEventId=C。只有 stream.open 且代际一致后才进入 ready。
8. 只读查询本机未决记录，恢复每个请求的真实状态；不重发任何变更命令。

接口配置例：用户从 DSH 管理命令取得 `http://127.0.0.1:3080/pet-bridge/v1/` 和单独签发的令牌，再在宿主窗口保存。示例端口不是固定值。禁止从 ~/.dsh、runtime.json、GUI 端口、其他插件存储自动读取凭据；禁止扫描端口。

每个插件只有一条 SSE。新建流前等待旧流终止；localService.cancel 的快速返回并不保证槽位已经释放。若配置切换抑制了旧流终态，使用有界退避重新占用，遇并发占用只重试读连接，不修改任务。

配置变更触发 epoch 失效、停旧传输并重新握手。相同 endpoint 不足以证明仍是同一客户端授权，instanceId 也不是凭据身份。旧缓存先隔离，新的授权未确认前不显示为当前会话历史。

## 8. 通道与参数映射

`localService.request` 的立即返回是宿主传输受理；服务响应稍后经回调送达。必须区分：

| 标识符 | 生成/来源 | 用途 |
| --- | --- | --- |
| transport requestId | 插件生成，如 http.42 | 关联一次宿主 HTTP 回调 |
| wire requestId | 安全随机唯一 ID，如 pet.UUID | 关联一次业务变更及长期回执 |
| streamId | 插件生成，如 sse.7 | 关联当前一条宿主流 |
| sessionId / activityId / messageId | DSH 返回 | 领域身份，不能自己猜 |
| cursor / attemptId | DSH 返回 | 事件恢复与临时输出身份 |

传输映射条目保存 kind、wireRequestId?、sessionId?、connectionEpoch、selectionEpoch。不要让 send HTTP ID 直接充当 wire 幂等 ID。业务 ID 使用沙盒可用的 WebCrypto UUID / 随机数，限制为标识符文法且不超过 100 字符；不依赖 Node。

| 操作 | 宿主参数 | response.data 形态 |
| --- | --- | --- |
| 握手 | GET path:/info | 原始 info DTO，不包 ok/data |
| 会话列表 | GET /sessions，query:{cursor?} | 原始 {instanceId,items,nextCursor} |
| 快照 | GET /snapshot，query:{sessionId} | 原始 snapshot DTO |
| 发指令 | POST /commands，body:command | pet-dsh/1 成功/错误包络 |
| 查回执 | GET /requests，query:{requestId:wireRequestId} | pet-dsh/1 成功/错误包络 |
| 订阅 | stream /events，query:{sessionId}，lastEventId | stream.event.data 为字符串，JSON 解析后是 wire event |

query 必须是 string→string 映射，用宿主编码，不把 ?sessionId 拼进 path。所有 path 相对于已授权服务根路径，不包含完整 URL。

发送命令例：

```json
{
  "protocol": "pet-dsh/1",
  "instanceId": "bridge-A",
  "requestId": "pet.9f2c604e-bf92-42ec-a83a-f2dc506554b2",
  "op": "message.send",
  "sessionId": "session-A",
  "data": {"mode": "followup", "text": "分析当前仓库的测试失败原因"}
}
```

取消命令仍是 POST /commands，只将 op 改为 session.cancel、data 改为 {"activityId":"activity-A"}，并分配新的 wire requestId。数据中的 requestId、activityId 含义不能互换。

## 9. 发送状态机与不确定结果

本机日志状态：

```text
prepared → submitting → accepted → running → ended
                    ↘ rejected
任何可能已发送的非终态 → unknown → 只读查询 → 已证明的状态
```

一条发送的操作顺序：

1. 校验 payload、文本长度、当前会话/代际、ready、available、能力、模式和单次发送锁。
2. 分配唯一 wire ID，将完整意图及原始文本写入 storage。写入失败则不发网络。
3. 异步存储返回后再次核对代际与绑定；若已切换则中止本次本地提交并标注未发。
4. 记录宿主传输映射并提交 HTTP；设置独立发送锁，不能因 execute 返回就再次提交。
5. 宿主接受传输后可 resetForm:true，因为原文已在日志中保留；不等待远端任务运行完。
6. 202/ok 只更新 accepted。message.claimed 关联 requestId/messageId/activityId/turn；活动 ended 才更新任务结论。

如果在“可能发出”边界崩溃，恢复时一律查询；prepared 也不能仅凭本机状态就确信没发过。超时、HTTP EOF、取消传输、进程关闭都不证明远端没收到。

未知结果显示原始文本和“查询结果”，不自动重发，即便 error.retryable=true。REQUEST_UNKNOWN、RESULT_UNKNOWN 也不等于“确认从未执行”，不会自动创建新 requestId 重跑。

同 ID 不同内容会 REQUEST_CONFLICT。首版不提供自动原 ID 重投策略；协议幂等窗口并非无限。确需再次执行由用户重新提出一条明确的新任务。

回执查询可能在新实例返回，包络 instanceId 是现在的服务，acceptedInstanceId 是原受理实例。查询历史记录的允许逻辑不同于应用当前活动事件；不能简单把跨实例回执全部丢弃，也不能把旧回执渲染为当前任务。

SSE 可能先于 POST 响应到达。状态归并保留已经确认的 messageId、activityId 和终态；迟到 accepted 不得把 ended 降级。没有 requestId 关联的 DSH 原生界面活动，只标为会话活动，不能算作某条桌宠发送的完成证明。

停止操作确认卡捕获 activityId、sessionId、bindingEpoch。确认前重查当前活动是否仍匹配；若活动已结束或换成另一条，卡片失效，绝不自动取消新活动。重复点击确认由本地锁阻止。

## 10. SSE、历史和临时输出

仅处理当前 streamId 的 event:bridge。JSON 包络必须通过协议、实例、会话、字段限额和语义校验，并检查 SSE lastEventId 与 JSON cursor 一致。

cursor 是不透明恢复标记：只做相等比较和有限去重集合；不解析数字、不猜连续性、不跨实例比较。服务过滤事件可能产生合法间隔。

| 事件 | 客户端动作 |
| --- | --- |
| message.claimed | 关联本机请求，建立活动；历史仍由 messageId/快照去重 |
| assistant.delta | 按 activityId+attemptId 累积 text，检查同一 attempt 内 index 连续 |
| assistant.message | 以 messageId 更新权威历史，替换相应临时输出 |
| tool.started / tool.finished | 按 callId 归并最近工具状态，不执行内容 |
| activity.state | 更新活动状态，不能由 running 推导成功 |
| activity.ended | 记录对应 activityId 终态；不清空别的活动 |
| session.changed | 合并触发一次快照重同步，包含原生界面输入的历史更新 |
| resync.required | 关闭流，重新 info/snapshot/subscribe |
| 未知事件 type | 本修订 Schema 的 type 为闭集，视为不兼容数据；停止应用并有界重同步，不跳过后冒充完整历史 |

同一 attempt 已处理过的 delta 忽略；首次在快照后观测某个 attempt 时，index 可大于 0，此时标注仅显示同步后的增量；已观测范围内出现 index 缺口、冲突正文或无法匹配提交消息时，丢弃临时展示并重同步。index 与全局 cursor 完全不同。

当前投影无法可靠关联某条临时输出到已提交 messageId 时，优先重新快照；不要把临时文本再次作为独立完整消息加入历史。

session.changed 使用 150ms 合并窗口，最多一个重同步在途。安全的重同步方式是先关闭/排空当前流，再拉快照并从新 cursor 订阅；不得用较早 HTTP 快照覆盖已应用的新流事件后继续使用旧订阅。重同步期间只允许读和查回执，发送禁用。每次重同步后都查询未决请求，补回暂停流期间可能发生的 claimed/ended；快照 activity:null 只证明当前无活动，不能单独证明某个旧任务成功。

首次启动、断线恢复、会话切换、实例变化均以新快照为基础。首版不以持久化的旧 cursor 单独恢复内存投影；如果缓存和 cursor 不在同一次原子写入中，就无法安全增量续接。

assistant.message 的 text 是已提交权威正文。宿主 chat 内容最多 16000 个 UTF-16 单元，服务可能按 Unicode code point 限制；界面需要安全截断，避免截断代理对，并显示“内容仅展示部分”。不修改远端历史，不伪造省略部分。

chat 消息 ID 最多 100 字符，wire messageId 已可能占满上限，不能直接添加长前缀。使用 messageId 本身或有界 UI 映射；临时消息分配独立短 ID。

## 11. 断线、错误与恢复

| 情况 | 页面与恢复 |
| --- | --- |
| 未配置 / net.local 未授权 | 保留入口，配置按钮和明确说明 |
| HTTP/SSE 401 | auth-required，停止自动重连，提示重新授权 |
| 403 | 停止相关写入与重试，刷新授权会话；不要切别的会话重试命令 |
| SESSION_NOT_FOUND / unavailable | 解除可写绑定、回会话页；不创建 Agent |
| INSTANCE_CHANGED / 实例变化 | 新握手、新快照、旧临时输出失效，未决命令只读查询 |
| SESSION_BUSY | 本次命令按服务明确拒绝处理，刷新活动；不自动排队 |
| UNSUPPORTED_CAPABILITY / 501 | 禁用对应本地动作并刷新能力，不降级成普通消息 |
| REQUEST_CONFLICT / RESULT_UNKNOWN | 保留记录和原因，需要用户审查，禁止自动重发 |
| 网络错误、EOF、45 秒空闲超时 | 远端活动标未知；只读重连，不提示任务完成 |
| 429 / OVERLOADED / 宿主并发占用 | 读连接按退避重试；变更命令按回执事实处理 |
| schema / DTO / event 不合法 | 停止应用相关数据，显示协议错误并有限重同步 |
| 未知但合法 error.code | 按 HTTP 与通用错误处理，保留固定码；不能令整个插件崩溃 |

只读自动重连采用 1、2、4、8、30 秒上限的退避并加少量抖动，稳定连接后重置。连续失败达到 5 次则保留“手动重连”入口，避免永久循环。401/403、版本不兼容、用户断开、禁用、配置移除不自动重试。

POST 得到明确合法错误包络时可记录 rejected；丢失响应时只能 unknown。不能因为某类 HTTP 错误平时意味着未执行，就在没有完整业务回执时替用户重投。

SSE 注释心跳、: superseded、: revoked 不会作为业务消息送到插件。EOF 只表示流结束；先重新检查 info，401 时停，不能依赖读取注释文字区分原因。

显示固定错误码和用户能采取的动作。调试日志不输出 token、完整会话正文、工具参数、请求原文或本机完整路径。

## 12. 并发、性能与沙盒约束

- 宿主限额：最多 4 个 HTTP、1 条 SSE，1 个本地事件订阅；业务调度器最多 3 个普通 HTTP，留一个控制/恢复槽位。
- 请求/事件 ≤64KiB，HTTP 响应 ≤256KiB，还需遵守 info.limits 更小值；JSON UTF-8 字节与 JS 字符长度分开计算。
- activate 不能等待 15 秒 HTTP；execute 不等待 DSH 执行，宿主命令窗口约 7 秒，激活窗口约 4.5 秒。
- 领域 reducer 同步、短小；网络与存储作为效果运行，回调先做传输结算再投递领域事件。不要持有串行队列等待其自身回调才能完成的网络 Promise。
- 提交锁覆盖写前日志和提交边界，保存状态按版本合并，避免并发 persistence 覆盖别的请求终态。
- 增量正文合并后约每 150ms 发布一次 UI，终态立即刷新；内存仍逐事件处理，不丢中间 delta。
- 发布快照不超过宿主 1MiB，页面和历史按实际限额裁剪。工具只保留最近 5 个摘要，诊断只保留最近 20 个固定码。
- 单 JS 入口最终不超过宿主 512KiB；无 Node、任意 fetch、DOM、文件访问或运行时模块加载。
- 校验器可手写或离线编译进 bundle；不要在沙盒中动态 Ajv compile/new Function/eval。共同 Schema 只覆盖核心包络，sessions/snapshot、data 语义仍须额外校验。

输入渲染使用标准组件文本，不把服务文字当 HTML、宿主命令、插件脚本或系统提示执行。

## 13. 草稿、存储和数据恢复

宿主目前仅在当前渲染周期通过稳定 form.id 恢复 DOM 草稿，不会把每个按键回传给 provider。设计不能承诺关闭面板、重启或切换会话后完整自动保存未发送草稿。

同一绑定期间保持 composer.id 稳定，以保留输入、光标和 IME；会话切换、恢复原文等有明确意图的动作再改变 ID。恢复失败发送的原文必须先提示覆盖风险，首版可直接在记录卡展示原文供用户处理，不自动覆盖新输入。

storage.own 单插件总配额约 512KiB，设计将完整持久数据序列化后的 UTF-8 大小限制为 384KiB，给宿主包装留空间。

建议一个版本化 state 键，结构如下：

```text
schemaVersion: 1
preferences: { lastSelectedSessionId, lastEndpointDisplay }
persona: { text, memory, localRevision, remoteAppliedRevision:null }
outbox: [{ wireRequestId, op, sessionId, acceptedInstanceId?,
           status, text?, activityId?, createdAt, updatedAt, outcome? }]
cache: [{ instanceId, sessionId, messages, activity, capturedAt }]
recentEnded: [...精简回执...]
notificationKeys: [...最多64项...]
```

控制预算：最多 8 条保留原文的未决变更；最多 2 个会话的显示缓存，合计 ≤160KiB；已结束记录最多 32 条，只留精简身份、时间与结果；人设只保留一份。缓存关闭时不保存远程正文，但未决命令原文在查清之前仍保留，并在界面说明。

写入超预算先淘汰旧显示缓存，再淘汰已结束记录；绝不静默丢弃 unknown 请求。仍超限时拒绝新提交并说明原因。未知 schemaVersion 或损坏数据保留原始存储，不自动覆盖成空白，也不重发旧任务。

缓存只作带时间戳的离线参考。当前授权未验证前不把旧缓存显示为新的在线历史。instanceId、endpoint、sessionId 都不构成稳定客户端凭据身份；配置变化先隔离旧数据，用户可显式清理。

历史、本机人设及发送记录在插件独立空间中以明文数据保存，并非凭据保险箱；可关闭历史缓存和清理显示数据。连接令牌仅宿主加密保存。清理本机资料不会修改已发送给 DSH 的内容或远端历史。

首版不主动保存模型 API Key、DSH 配置全文、工作区完整路径、原始工具参数/输出、私密推理或服务日志。

## 14. 提醒与生命周期

notify 默认关闭。仅在权限存在且用户开启后，针对当前绑定新收到的 activity.ended、首次进入 waiting-approval 发出宿主提醒。

去重键由绑定作用域、sessionId、activityId、提醒种类构成，持久保存有界集合。同一活动重同步、重连回放、历史快照不得再次提醒；没有明确活动关联不声称“你的任务已完成”。私密摘要使用“DSH 会话任务已结束”“DSH 会话需要审批”，不把代码、文件路径和完整对话放进提醒。

dispose / signal.abort / cleanup 必须幂等：使 epoch 失效、停止定时器和发布、取消 HTTP/SSE、退订、释放所有映射。unsubscribe 本身不会关闭传输，必须显式 cancel。销毁不发送 session.cancel，不把结束网络视为停止 Agent。

## 15. 后续能力扩展

### 15.1 人格同步

只有 persona.update 声明且 revision 语义经过双方验证后，新增显式同步动作，携带共同声明中的 characterId、revision、persona、memory。characterId 由本插件人工资料产生，不能声称是宿主角色 ID。远端确认对应 revision 前 UI 始终显示未同步；现有协议没有规定成功 data 内必须有 appliedRevision，后续须共同补充回执细则再实现。

### 15.2 审批和问题

interaction.answer 需要 DSH 先实现唯一决定通道和过期/重复/跨客户端规则。到时选择型审批可用固定参数 interactionId/choiceId 按钮实现。任意动态 answers 表单不适配现有清单的固定参数集合，须额外设计编码与语义校验或扩展通用表单能力；首版不承诺支持。

### 15.3 桌宠日程与反向工具

pet.tool.requested 只是请求，不能直接当作宿主命令。要实现 DSH 建日程，需先由宿主提供通用工具注册、权限、用户确认、调用幂等和结果回传服务，再给日程插件实现相应工具提供者。桌宠 DSH 插件只负责验证请求、调度已授权工具并返回 pet.tool.result。

当前不能通过猜测其他插件命令 ID、直接改日程存储、执行脚本或把“已创建日程”文字当真实结果实现这一目标。此能力作为后续独立阶段，不阻塞首版对话和任务控制。

## 16. 分阶段开发与交付

| 阶段 | 工作 | 完成标准 |
| --- | --- | --- |
| A：纯客户端内核 | wire 校验、transport、代际、投影与日志，无真实网络 | 下表关键异常顺序用例通过 |
| B：标准界面 | 四个业务页加本机资料、命令声明、确认卡、配额 | 快照与所有 payload 通过宿主契约 |
| C：模拟服务联调 | 对接 DSH dev fake，完整 HTTP+SSE，取消和重启 | 不确定发送不重跑、历史不重复、旧事件不串会话 |
| D：真实沙盒 | ZIP 单入口、权限、配置窗口、生命周期 | 真 Electron 宿主实际导入与撤权检查通过 |
| E：真实 DSH | 用户已有授权会话，先只读后发送一条任务 | 两端可见同一消息/活动及明确终态 |
| F：发布 | 打包、说明、兼容基线和测试报告 | 产出可安装插件 ZIP；与本设计交付 ZIP 区分 |

真实模型调用若涉及账户费用，在实际运行阶段按用户授权执行；设计与模拟验证不需要模型费用。首版无须改桌宠宿主主进程，也不需要修改 DSH 原生 Agent 所有权或工具集合。

建议未来实现产物：provider.js、plugin.json、README.md、CHANGELOG.md、内核测试、沙盒联调脚本、测试报告、可安装 ZIP。这些是最初设计交付的实现输入；可安装 provider 入口现已另行实现，见文首链接。

## 17. 双端验收用例

配套 wire-scenarios.json 中的场景数据是实现输入与断言说明，不是已执行的客户端测试。实际开发至少覆盖：

| 编号 | 场景 | 必须满足 |
| --- | --- | --- |
| C01 | 未配置、无权限、服务关闭 | 入口和配置可用，无自动扫描 |
| C02 | 配置窗口打开但未保存 | 不显示已连接 |
| C03 | 缺任一必需能力 | 不兼容且禁止发送 |
| C04 | 空会话列表、未选择 | 不自动建 Agent 或选首项 |
| C05 | 正常 info/list/snapshot/stream.open | 仅完整就绪后可写 |
| C06 | HTTP transport 接受但无服务回执 | 仍 submitting/unknown，不当作任务成功 |
| C07 | claimed/ended 早于 POST202 | 迟到回执不回退终态 |
| C08 | POST超时但 DSH 已执行 | 只查 requests，不自动重发 |
| C09 | REQUEST_UNKNOWN / RESULT_UNKNOWN | 保留原文与不确定性，不生成新请求 |
| C10 | 同 messageId 重放 | 聊天只出现一次 |
| C11 | 重复 delta / attempt切换 / index缺口 | 不重复拼接，必要时快照恢复 |
| C12 | cursor有间隔、SSE id不匹配 | 合法间隔接受；身份冲突停止应用 |
| C13 | session.changed 与新输出交错 | 重同步不回滚新投影，无重复订阅 |
| C14 | 切会话后旧响应与按钮迟到 | 不修改新会话、不取消新活动 |
| C15 | 取消传输与取消 DSH | 断开不发取消；取消需activityId与终态 |
| C16 | 确认停止时活动已更换 | 拒绝旧确认，不转而取消新活动 |
| C17 | 服务重启、新实例查旧请求 | 新快照；acceptedInstanceId保持原事实 |
| C18 | waiting-approval但无interaction.answer | 显示去DSH处理，无伪审批按钮 |
| C19 | steer取消授权或返回501 | 禁用相关动作，不改为followup偷偷发送 |
| C20 | 存储失败、超配额、状态损坏 | 不发送，不丢未决，不覆盖原数据 |
| C21 | 高频流、长Unicode正文 | 限流发布、截断合法、无宿主快照超限 |
| C22 | 401/403、429、未知错误 | 鉴权失败停重试，只读退避，无写入重投 |
| C23 | 禁用/卸载/关闭沙盒 | 网络和定时器释放，DSH继续运行 |
| C24 | 重连回放和快照终态 | 不重复提醒 |
| C25 | 运行中编辑草稿与流式刷新 | 同绑定composer稳定，不丢IME/光标 |
| C26 | 本机人设保存 | 明确未同步，不增加远端用户消息 |
| C27 | 原生DSH前端发送内容 | 历史可同步，不能冒充桌宠请求完成 |
| C28 | 配置改到相同地址的新客户端 | 旧授权缓存隔离，不复用旧能力/自动提交 |

最终联调报告应分别记录：契约静态校验、模拟 HTTP/SSE、真实 Electron 沙盒、真实 DSH、真实模型调用，不能用其中一项代替其余项。

## 18. 本次设计包清单

- 本文：产品、界面、模块、状态机、持久化、故障处理和开发计划。
- fixtures/pet-dsh-v1/manifest.design.json：设计清单，通过当前宿主清单与示例参数校验。
- fixtures/pet-dsh-v1/ui-snapshots.json：未配置、待选、就绪、运行、待审批、离线未知、不兼容的标准组件快照。
- fixtures/pet-dsh-v1/wire-scenarios.json：HTTP/SSE、迟到回执、恢复及可选能力的具体交互材料。
- fixtures/pet-dsh-v1/baseline.json：设计依据的版本、来源和内容哈希。
- fixtures/pet-dsh-v1/validation-report.json：本次已实际执行的静态检查及范围限制。
- fixtures/pet-dsh-v1/README.md：配套资料使用方式。
- release/handoffs/Pet-DSH-Plugin-Design-v1.0.0.zip：可转交的设计交接包，包含共同声明、宿主 API、Schema 和上述资料；不是插件安装包。

本文未更改共同声明或宿主 API，没有对当前 DSH 服务补充未实现的能力。
