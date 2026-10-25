# 正式发布流程

当前版本为 v5.2.1，产品名 SpinePet。发布必须对应同一份 main 提交、vX.Y.Z 标签、二进制、插件和校验清单；已发布版本不覆盖。

## 应用内更新

v5.2.1 是首个接入应用内更新的正式版。v5.1.3 及更早版本需先手动安装 v5.2.1，以后可在应用内检查并升级。不得覆盖已发布的同版本附件。

“角色管理器 → 更新与开发”提供主程序检查、下载进度、重启安装、插件更新以及仓库与开发文档入口。安装版使用 `electron-updater` 的 GitHub provider（公开仓库 `xjunrao-ux/spine-pet-workshop`），仅接受更新的正式版本，不自动降级。默认启动 15 秒后及每 6 小时检查、发现主程序更新后后台下载；用户点击“重启并安装”才退出升级，不在普通退出时自动安装。两个自动选项可关闭。开发模式不自动联网；便携版可检查但需到发布页下载，不能覆盖临时解包目录。

升级保持 `appId`、产品标识与安装范围不变。用户数据继续存放在原 `%APPDATA%/spine-pet-workshop`，程序包中不包含用户角色、插件配置或凭据。没有更新功能的早期版本需先手动安装一次带此功能的新版本。

NSIS 构建必须同时发布 `SpinePet-Setup-vX.Y.Z-x64.exe`、对应 `.exe.blockmap` 与 `latest.yml`。`build.publish` 会让 electron-builder 生成 `app-update.yml`、`latest.yml` 和校验值；仍用 `--publish never` 构建，本地不会自动上传。安装包先完整上传到 draft，最后公开，避免客户端看到不完整更新。签名校验保持更新器默认行为；如后续接入 Windows 代码签名，保持发布者证书身份连续。SHA-512/SHA-256 完整性检查不等同于发布者签名。

插件更新由固定的 GitHub main 分支 `community/catalog.json` 驱动，与主程序 Release 分开。首次安装仍需 ZIP；后续仅检查已安装且已收录的插件，兼容版本与 ZIP 哈希均通过后由用户确认替换。独立作者可在自己的仓库发布插件 ZIP，再通过 PR 更新本仓库条目，运行 `pnpm community:generate` 并提交生成的 README 和 catalog.json；无需重新发布主程序。发布插件时不要把插件专用 Release 标为本仓库的主程序 latest。

验证命令：`pnpm test:updates`、`pnpm test:updates:ui`、`pnpm community:check`、`pnpm build`。构建 NSIS 后，可运行 `pnpm test:updates:transport <产物目录>`，通过本机回环服务器验证真实更新器下载和 SHA-512 成功/损坏拦截，不执行安装。首次端到端上线仍需两个不同正式版本的安装包验证真实覆盖升级；测试不得覆盖个人安装或用户目录。

## 1. 准备与验收

在开发分支完成改动，更新 package.json、界面版本、README、CHANGELOG、ROADMAP、版本使用说明、RELEASE 和 VALIDATION 文档。运行 [开发文档](DEVELOPMENT.md) 中与本版有关的 Node、Electron 与打包检查。

公共源码不包含 .local、artifacts、node_modules、第三方模型/音频、缓存、用户资料和旧研究目录。保留可重跑的测试与关键版本结果。

## 2. 整理 main

复用现有的 main 工作区，确认其没有用户改动。先 fetch public/main 并确认与远端一致，再将开发分支 squash 到 main，检查文件列表后提交 release: vX.Y.Z。不要直接把开发分支或含内部研究提交的历史推送到公共仓库。

```powershell
git merge --squash dev/v3
git diff --cached --stat
git diff --cached --check
# 检查源码、凭据/素材排除与文档后提交
git commit -m "release: v5.2.1"
```

在正式工作区安装锁定依赖，准备本地构建素材后重建。运行 pnpm package:win、pnpm test:packaged 和 scripts/Test-ReleaseBinaries.ps1。安装版版本和内容结构、便携/解包程序的隔离启动均需核对；不要用真实用户安装目录或个人配置执行测试。

## 3. 插件与额外附件

用 package:* 命令生成五个桌宠 ZIP，复制到正式版本目录。社区条目的版本、固定标签下载 URL、权限及完整 ZIP SHA-256 必须与附件一致：

```powershell
pnpm community:generate
pnpm community:check
node scripts/community-catalog.mjs --archives release/v5.2.1
```

DSH 桥是单独 TGZ，在 dsh-pet-bridge 目录运行 node scripts/pack.mjs --out ../release/v5.2.1。保留白名单检查，不把令牌、运行配置、日志或测试 Profile 放入包。

## 4. 上传和公开

GitHub 账户与 public 远端必须与目标仓库匹配。脚本只允许 main，拒绝未提交改动、研究历史或不完整附件。安装包名称从 package.json 的发行规则读取；使用说明优先选择精确版本文件。

```powershell
& scripts/Publish-Release.ps1 -Version 5.2.1 -PluginArchives @(
  'release/v5.2.1/Weather-Plugin-v1.2.0.zip',
  'release/v5.2.1/Codex-Plugin-v1.1.0.zip',
  'release/v5.2.1/DeepSeek-Plugin-v1.1.1.zip',
  'release/v5.2.1/DSH-Pet-Plugin-v1.1.0.zip',
  'release/v5.2.1/Hello-Counter-v1.0.0.zip'
) -AdditionalAssets @('release/v5.2.1/local-dsh-pet-bridge-1.0.0.tgz')
```

脚本先核对 `latest.yml` 中的版本、安装包名及 SHA-512，要求对应 blockmap 存在；然后生成所有自定义附件的 SHA256SUMS 和离线使用说明，再原子推送 main 与指定标签；创建 draft、上传安装包、更新清单、blockmap 与其他完整附件后公开为 latest。构建始终 --publish never。若上传中断，先检查已有 draft 和附件，不覆盖同版本 Release 或重复创建标签。

## 5. 发布后确认

核对远端 main/tag 指向、Release 非草稿与 latest 状态、每个附件名称/体积/SHA-256、源码测试工作流与 README 下载链接。GitHub 自动源码归档不含第三方本地素材；正式安装包才是普通用户的运行入口。

清理临时产物时先写清单、解析绝对路径并验证位于项目内，保护原始素材、用户目录、备份及活动 Git 工作区。保留本次正式 EXE、ZIP、校验文件、关键截图和版本验收摘要。
