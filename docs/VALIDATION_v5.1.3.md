# v5.1.3 验证记录

日期：2026-10-23。目标为 Windows x64 的 SpinePet 5.1.3 正式快照。以下为本次实际执行结果；远端工作流以 GitHub Actions 状态为准。

## 自动化与真实界面

| 检查 | 实际结果与范围 |
| --- | --- |
| pnpm test:release | 101 项通过，0 失败；参数、启动、插件生命周期、天气、社区目录、本地服务与凭据边界 |
| 主题、DeepSeek、DSH 插件与 presentation Node 测试 | 37 项通过，0 失败；触发方式/宽度校验及重载、纯界面设置不重新配置插件 |
| DSH 桥模拟测试 | 62 项通过，1 项真实 DSH 专项按默认条件跳过；不调用收费模型或用户真实会话 |
| pnpm build / pnpm package:win | TypeScript、Vite、安装版与便携版构建通过 |
| pnpm test:companion-ui | 20 项真实 Electron/Worker/ZIP 检查通过；在正式工作区使用最终发行插件再次执行 |
| 点击模式 | 真实模型点击打开；悬停、按下未松开、快速拖动不会打开；Esc 关闭后悬停/状态刷新不重开；再次点击可打开 |
| 输入框缩放 | 左右边缘原生拖动、设置宽度滑条、240–720 px 边界、固定对侧边缘、持久化重载、草稿保留与持续尺寸稳定均通过 |
| 聊天及设置 | 圆形发送按钮/SVG 箭头、删除重复齿轮、上方原有设置入口、中文输入法、流式回复、停止、禁用/重启/锁屏清理均通过 |
| pnpm test:ui-main | 3 项正式入口冒烟通过 |
| pnpm test:manager-layout | 7 项通过；角色状态、真实模型卡片、六参数保存、主题、导入/切换/删除和小窗口布局 |
| pnpm docs:check | 正式快照 77 份 Markdown 的本地链接通过 |
| 社区目录 | 五个最终 ZIP 的 manifest、固定版本链接、权限与完整 SHA-256 均通过校验 |

交互回归没有发起付费请求；回复、天气与 Harness 使用隔离模拟资料。

## 发行包

- 复用干净 main 工作区，安装锁定依赖后构建 5.1.3；公开提交仅包含本次差异，不包含内部研究历史。
- pnpm test:packaged 通过：57 份运行源码/资源与 app.asar 一致，包含内置模型与待办 1.3.0，没有开发或用户资料。
- scripts/Test-ReleaseBinaries.ps1 通过解包管理器、解包桌宠、便携管理器、便携桌宠四次实际启动；截图非空，管理器显示 5.1.3，角色正常渲染。
- 安装版和便携版 ProductVersion 均为 5.1.3。独立提取安装包中的 app.asar 与 SpinePet.exe，SHA-256 均与已启动验收的解包程序一致。
- 安装版 app.asar SHA-256：434DB560DBA498957BD9FDDCCA124B1CC4A31EB506E62E2B664BC4C7DC1041FB。
- 可选桥组件按 23 文件白名单封装并通过协议固定摘要检查；在 .gitattributes 固定协议文件 LF，防止 Windows 检出改变协议原始字节。
- 附件为两个 EXE、五个插件 ZIP、桥 TGZ、离线使用说明和 SHA256SUMS，共 10 个；DeepSeek 插件为 1.1.1，其余插件和桥版本不变。各附件的最终摘要以 Release 的 SHA256SUMS.txt 为准。

## 证据与边界

真实 EXE 的启动截图、包内源码核对与安装包提取报告保留在正式工作区的 .local/release-v5.1.3-validation。聊天回归结果位于 .local/v4.3.1-hotfix-validation；版本命名沿用既有脚本，不表示实际宿主仍是旧版。

没有运行会修改真实安装目录或注册表的安装/卸载向导。真实收费 DeepSeek、外网天气、Codex 登录与真实 DSH 会话不属于本次模拟测试范围。原用户数据位置与外部插件手动更新机制保持不变。
