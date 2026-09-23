# 正式发布流程

公共仓库只保存正式发行快照。v3 等研究内容继续留在原开发目录、私人仓库或本地分支。

## 版本来源

- `main`：最近一个正式版本。
- `vX.Y.Z` 标签：不可变的正式发行点。
- 本地或私人开发分支：测试版、候选版和研究版。

不要把整个 `X:\桌宠` 复制到公共仓库。只从已冻结的版本目录同步源码、配置和文档，排除 `node_modules`、`dist`、`release`、测试截图、用户数据和第三方素材。

## 发布门槛

1. 冻结版本范围并更新 `package.json`。
2. 更新该版本的用户说明、`CHANGELOG.md`、`ROADMAP.md` 和 README 版本表。
3. 从干净依赖执行 `corepack pnpm install --frozen-lockfile`。
4. 执行 `corepack pnpm build` 和 `corepack pnpm package:win`。
5. 实机测试安装版、便携版、首次启动、托盘、退出和卸载。
6. 确认公开包内没有无权分发的角色、语音、密钥或用户数据。
7. 为安装包生成 `SHA256SUMS.txt`。
8. 用 `git status --short` 和 `git ls-files` 复查上传范围。

## 正式提交和标签

开发历史保留在本地或私人仓库，公共仓库通过 squash 得到一个正式提交：

```powershell
git switch main
git merge --squash dev/v2.2
git commit -m "release: v2.2.0"
git tag -a v2.2.0 -m "Spine Pet Workshop v2.2.0"
git push public main
git push public v2.2.0
```

在 GitHub Release 中上传安装版、便携版、`SHA256SUMS.txt`，并粘贴 `CHANGELOG.md` 对应版本内容。不要上传内部测试包或 `release/win-unpacked`。

## 本地同步原则

稳定发布工作区只接受冻结版本；日常开发继续在 `X:\桌宠` 原有位置进行。同步新版本时先在临时分支检查差异，不能直接覆盖 `main` 后立即推送。

仓库使用 `.githooks/pre-push` 保护名为 `public` 的远程：开发分支会被拒绝，`main` 只有在提交点存在 `vX.Y.Z` 标签时才能推送。首次克隆后运行：

```powershell
git config core.hooksPath .githooks
```
