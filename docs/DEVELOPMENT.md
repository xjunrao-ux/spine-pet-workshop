# 本地开发与 Git 使用

## 开发入口

维护者工作目录为 `X:\桌宠\spine-pet-workshop`。根目录包含最新正式源码；不要继续编辑旧的 `releases/*/source` 或 `public-repos` 副本。

- `main`：经过验收的正式源码。
- `dev/v2.3.1`：本地稳定线功能开发与修复，不推送；验收后再整理为正式快照。
- `dev/v3`：本地开发分支，包含 v3 探针与实验快照，不推送。
- `vX.Y.Z`：正式版本标签。
- 远端 `public`：`https://github.com/xjunrao-ux/spine-pet-workshop.git`。

切换分支会切换同一目录中的受 Git 管理文件。切换前保存并提交当前修改。

## GitHub Desktop

1. File → Add Local Repository。
2. 选择 `X:\桌宠\spine-pet-workshop`。
3. 日常开发选择 Current Branch → `dev/v3`。
4. 在 Changes 中检查文件，填写 Summary，Commit to dev/v3。
5. 在 History 中查看快照与差异。

开发分支保持本地，不点击 Publish branch。仓库的 pre-push 钩子会拒绝向公共远端推送开发分支。

## 命令行保存快照

```powershell
git status
git diff
git add electron src v3 docs
git commit -m "dev: 保存音乐控制阶段进展"
```

如果本次修改了配置或其他文件，在检查差异后单独加入。被忽略的依赖、缓存、素材原件和安装包不会自动进入提交。

## 运行与构建

```powershell
pnpm install --frozen-lockfile
pnpm dev
pnpm build
pnpm package:win
```

静态构建后也可双击根目录的 `启动桌宠.cmd`。普通用户从 GitHub Release 下载 EXE。

## 本地目录

- `release/`：当前打包结果。
- `releases/`：保留的正式安装包和离线使用说明。
- `.local/backups/2026-10-10/`：整理前的源码、v3 和 Git 历史备份。
- `.local/development-notes/`：旧版内部交接日志。
- `.local/inputs/`：原始素材和上游副本。
- `.local/reference/`：生成的协议参考。
- `node_modules/`、`dist/`：依赖与构建产物。

这些目录均不上传。只有本地 commit 的开发历史仍依赖这台电脑；需要备份时可导出完整 Git bundle：

```powershell
git bundle create .local/workshop-all-branches.bundle --all
```

恢复时请使用备份创建另一个仓库进行比较，不直接覆盖当前工作目录。

## 正式发布

按 [发布流程](RELEASING.md) 把验收后的成果整理到 main。普通 merge 会公开测试提交历史；如需只公开正式快照，使用 squash 并检查最终文件列表。

## 稳定修复同步到后续版本

使用单向合并：`稳定开发线 → dev/v3`，不把未完成的 v3 反向合并到 v2。每次修复先在稳定线上提交、构建并测试，再同步；Git 不会自动把一个分支的修改带到另一个分支。

```powershell
# 先在 dev/v2.3.1 检查、暂存具体改动并 commit
node --test scripts/test-character-parameters.mjs
pnpm build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Sync-StableToV3.ps1
```

脚本要求工作区干净，只允许从 main 或 dev/v2.x 分支向本地 dev/v3 合并，成功后构建并停留在 dev/v3，不执行推送。已合并的提交不会重复应用。涉及版本标记、界面或架构的冲突会停下，需保留 v3 的版本号和扩展功能，再完成合并、构建和回归。不要整文件覆盖 v3，避免抹掉新增功能。

也可以在 GitHub Desktop 中先提交稳定线修改，再切到 dev/v3，通过 Branch → Merge into current branch 选择稳定开发线。小而独立的紧急修复可以 `git cherry-pick <提交>`，但长期同步优先 merge，以便保留分支关系和避免重复解决同一个改动。未验证的实验不要每次 commit 自动合并。

正式发布时只把稳定开发分支 squash 到 main；保留 dev/v2.3.1 本地历史，并在发布后把 main 再合到稳定线及 dev/v3，使后续同步有共同基线。开发分支不发布到 GitHub。
