# 正式发布流程

公共 main 和正式标签只保存验收后的版本。日常测试提交留在本地 dev/v3。

版本提交使用 `release: vX.Y.Z`，产物自动输出到 `release/vX.Y.Z/`。每次可交付修订递增版本号，不使用 `-pages`、`-polish` 等测试后缀替代版本；已发布版本不覆盖。发布脚本默认读取当前版本目录。

## 发布准备

1. 在 dev/v3 完成验证并提交修改。
2. 确定正式版本号，例如 3.0.0。
3. 确认功能范围、使用说明、素材来源、安装版和便携版的运行结果。
4. 检查没有把依赖、缓存、用户数据、密钥或内部研究文件纳入正式源码。

## 整理正式提交

以下为将来发布 v3 的示例，当前不执行：

```powershell
git switch main
git merge --squash dev/v3
```

squash 会带入开发分支的最终文件内容，仍需检查是否含实验目录。把已经成熟的功能放入 electron/src/scripts，未完成探针不要进入正式提交；v3 目录的研究原件继续保留在开发分支或本地备份。

更新 package.json、README、CHANGELOG、ROADMAP、版本使用说明和 RELEASE 文档，然后构建和检查：

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm package:win
git diff --cached
git status --short
```

选定正式文件并提交：

```powershell
git add electron src assets public docs scripts .github .githooks
git add package.json pnpm-lock.yaml pnpm-workspace.yaml README.md CHANGELOG.md ROADMAP.md
git commit -m "release: v3.0.0"
```

发布前应保证 main 工作区干净。不要使用普通合并把所有内部测试提交带入公共历史。

## 上传源码和 Release

登录 GitHub CLI 后，在 main 调用发布脚本：

```powershell
gh auth status
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Publish-Release.ps1 -Version 3.0.0
```

脚本检查当前分支、package 版本、工作区、研究文件和安装包，创建正式标签，推送 main 与这个标签，再上传 EXE、SHA-256 和版本说明。构建脚本使用 --publish never，打包本身不会自动发布。

已存在的 Release 或版本标签不会被覆盖。修复已发布软件时使用新的修订号。

## 推送保护

仓库使用 .githooks/pre-push。初始化已配置：

```powershell
git config core.hooksPath .githooks
```

新克隆的维护者也需要运行这条命令。钩子只允许向 public 推送 main 和 vX.Y.Z 正式标签，并拒绝包含 v3 研究历史的推送。

只推送明确的正式分支和标签；不要使用 --all、--mirror 或 --tags。本地钩子是维护约定，不能替代代码审查。

## 版本对应关系

每次发布固定对应一份源码提交、一个标签、安装包和校验文件。v2.1.0 历史标签保留；固定角色系列发行 v2.1.1，工坊系列发行 v2.2.4。中间测试包不公开。
