# 社区插件投稿、更新与审核

## 投稿流程

1. 阅读[快速入门](../docs/PLUGIN_QUICKSTART.md)和[开发规范](../docs/PLUGIN_DEVELOPMENT.md)，使用稳定且唯一的 ID。正式发布前替换 `com.example` 演示 ID。
2. 在你自己的 GitHub 仓库维护源码、README、许可和变更记录。README 说明功能、截图或效果描述、兼容版本、权限、存储/联网行为和卸载保留行为。无需另建网站。
3. 使用宿主打包脚本生成根目录含 `plugin.json` 的插件 ZIP，在你的 GitHub Release 上传 ZIP 附件。固定版本链接不要使用 `latest`；不要覆盖同一版本附件，更新时增加版本号。
4. 使用 PowerShell `Get-FileHash -Algorithm SHA256 -LiteralPath '你的插件.zip'` 取得完整 ZIP 摘要，小写填写到条目。
5. Fork 本仓库，复制 `community/plugins/com.example.hello-counter.json` 为 `community/plugins/<你的ID>.json`，替换全部信息。不要复制示例的 hash，也不要提交 ZIP、依赖或用户数据到 Git。
6. 在仓库根目录运行 `pnpm community:generate`、`pnpm community:check`，提交条目与生成后的表格，创建 PR，注明首次收录或更新。
7. 等待检查与审核，通过后由维护者合并。收录不需要修改宿主注册表，不触发新的 EXE 发行。

## 字段规范

条目必须满足 [schema.json](schema.json)，不允许未定义字段。每个文件只包含一个插件，文件名必须是 ID 加 `.json`。

| 字段 | 含义 |
| --- | --- |
| id / name | 与 ZIP 清单一致的稳定 ID、名称；`workshop.` 为内置保留前缀 |
| author | 可核对的 GitHub 登录名；不是已验证的发布者签名 |
| description / category | 简短功能说明；分类仅用 schema 枚举 |
| version / apiVersion | 与 ZIP 一致；目录版本采用三段数字，当前 API 为 1 |
| minHostVersion | 作者实际验证的最低宿主版本；仅目录元数据，不改变 API v1 |
| sourceUrl | HTTPS GitHub 仓库或固定版本源码页面 |
| downloadUrl | HTTPS GitHub 固定 Release 的 `.zip` 附件，不支持任意网站或 latest 链接 |
| sha256 | 完整 ZIP 的 64 位小写 SHA-256；不是宿主安装缓存 hash |
| permissions | 与 ZIP 清单完全一致；当前外部可用独立存储、提醒、天气及 Codex 只读四种权限 |
| license | 源码中明确说明的许可；不得把未获许可的代码或素材声明为开源 |

源码仓库与下载仓库可以不同，但 PR 中必须说明原因和作者关系。不要把令牌、账号或私人资料放在条目、截图或 ZIP 中。

## 更新、归属与下架

- 更新保持 ID，修改版本、固定链接、SHA-256、权限和兼容版本。涉及权限或数据结构变更，必须解释迁移与降级行为。
- 维护者核对 PR 作者与既有作者身份；更换维护者需原作者确认或可核验的交接记录。不能仅凭同名 ID 接管条目。
- 新增权限要重点审核，用户更新时仍需确认。自动检查不会自动批准更新。
- 失效、停止维护或存在实际风险的插件，可通过 Issue 报告并由维护者移除目录条目。移除目录不会远程卸载用户已安装插件。

## 维护者验收

1. 检查字段、唯一 ID、作者来源、源码许可、效果说明、权限和兼容声明。
2. 自动化只校验本地目录与表格；不下载、不 import、不执行陌生插件入口，不向 PR 提供发布凭据。GitHub 的检查通过不等同业务或安全审核通过。
3. 在隔离下载目录取得附件；检查大小和摘要，再运行 `inspectPluginZip` 做非执行式包校验，核对 ID、名称、版本、API 和权限。不要在 Node 主进程直接 import 未审阅插件。
4. 审阅源码后，使用隔离桌宠测试配置检查安装、功能、禁用、重启、更新和卸载；不得拿真实用户数据做测试。
5. 审核通过再合并 PR。首次来自 Fork 的工作流可能需要维护者批准运行；不要为方便投稿改成自动执行特权 PR 代码。

目录校验已有下载包时可运行 `node scripts/community-catalog.mjs --archives <本地包目录>`，它核对所有在目录中的附件且不执行插件代码。只有部分包时，维护者可调用脚本导出的 `verifyArchive(entry, bytes)` 单独检查。

## 不会提交 PR

填写[插件收录申请](https://github.com/xjunrao-ux/spine-pet-workshop/issues/new?template=plugin-submission.yml)，维护者可以协助创建条目。仅有想法时填写[插件点子](https://github.com/xjunrao-ux/spine-pet-workshop/issues/new?template=plugin-idea.yml)，说明目标和需要的数据，不要求先写代码。
