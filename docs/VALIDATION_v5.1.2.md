# v5.1.2 验证记录

日期：2026-10-22。目标为 Windows x64 的 SpinePet 5.1.2 正式快照。以下为本地实际执行结果；GitHub 工作流以仓库 Actions 的执行状态为准。

## 自动化与真实界面

| 检查 | 实际结果与范围 |
| --- | --- |
| pnpm test:release | 101 项通过，0 失败；参数、启动、插件生命周期、天气、社区目录、本地服务与凭据边界 |
| 主题、DeepSeek、DSH 桌宠插件和 presentation Node 测试 | 37 项通过，0 失败 |
| DSH 桥模拟测试 | 62 项通过，真实 Harness 专项 1 项按默认条件跳过；真实 HTTP/SSE，模拟 Harness，无收费调用 |
| pnpm build | TypeScript 检查与 Vite 构建通过 |
| pnpm test:manager-layout | 7 项通过；真实模型卡片、六参数保存、主题/自定义配色、导入/切换/删除、小窗口独立滚动、导入指引显著性 |
| 桌宠状态 | 实际隐藏/显示、无响应/恢复、坏模型/恢复均通过；名称跟随活动角色，信号色固定 |
| pnpm test:companion-ui | 真实 Electron/Worker/ZIP；原生输入、独立编辑框、流式回复、主题、凭据窗口、拖动排序和禁用恢复通过 |
| pnpm test:local-service:sandbox | 9 项通过；受控 HTTP/SSE、凭据隔离、未授权窗口拒绝与生命周期清理 |
| pnpm test:dsh-pet:sandbox | 9 项通过；真实桌宠 Worker/桥 HTTP/SSE，模拟 Harness，不使用用户现有 DSH 会话 |
| pnpm test:ui-main | 正式工作区 3 项主窗口冒烟通过 |
| pnpm docs:check | 正式快照 74 份 Markdown 的本地链接通过 |
| 社区插件归档 | 五个 ZIP 的 manifest、固定标签链接和 SHA-256 全部与目录匹配 |

文档截图来自隔离资料下的真实界面，使用本地模型和真实插件 ZIP，无模型付费请求。可通过 pnpm docs:capture 重新生成。

## 发行包

- 在正式 main 工作区运行 pnpm install --frozen-lockfile 和 pnpm package:win，生成安装版与便携版 5.1.2。
- pnpm test:packaged 通过：57 份运行源码与 app.asar 一致，内置模型存在，内置待办为 1.3.0，五个外置插件信息有效，未混入开发/用户资料。
- scripts/Test-ReleaseBinaries.ps1 通过四次实际启动：解包管理器、解包桌宠、便携管理器、便携桌宠。四张截图均非空，管理器显示 5.1.2，桌宠成功渲染。
- 安装版 ProductVersion 与便携版均为 5.1.2；独立提取安装版 app.asar，其 SHA-256 与已启动验收的解包程序完全一致。
- 安装版载荷 SHA-256：19F5A33C21983159F2782D912440E66A2B5C948D77547FB23EEA829E8096466B。
- DSH TGZ 按 23 文件白名单封装，绑定协议哈希与禁入文件检查通过；不含令牌、运行配置和测试资料。
- 发布附件为两个 EXE、五个插件 ZIP、桥 TGZ、离线手册和 SHA256SUMS，共 10 个；具体附件哈希以 Release 校验文件为准。

## 证据与边界

原始 JSON、日志、截图和清理清单保留在本地 .local/release-v5.1.2-validation 与对应 UI 验证目录；正式二进制启动报告位于正式工作区的同名验证目录。关键摘要与截图进入版本文档，测试 Profile 及重复解包构建按清单清理。

本次未修改真实用户安装目录或注册表，因此没有把卸载/升级向导的人工操作记为已测。真实收费 DeepSeek、天气外网、Codex 登录及真实 DSH 会话兼容性不由本轮模拟回归保证；桥文档中的早期真实 DSH 证据保留其当时版本范围。微信/企业微信聊天提醒、自动更新以及 DSH 自动建 Agent/审批/人格同步不在本版范围。
