# SpinePet 项目介绍页

GitHub Pages 静态网站：使用指南、可搜索的插件社区和开发者窗口。网站与桌面程序独立，部署不需要安装 Electron 或第三方模型。

当前状态：按用户要求仅保留本地，尚未启用或发布 GitHub Pages。构建后也可直接双击 `.local/website/index.html` 查看，不需要启动服务。

## 本地预览

在仓库根目录运行（只需要 Node.js 24，不需要安装依赖）：

```powershell
node scripts/preview-website.mjs
```

打开 [本地预览](http://127.0.0.1:4178/spine-pet-workshop/)。该命令先构建，再启动本机服务；修改后重新运行即可。仅构建可运行 `node scripts/build-website.mjs`，输出到忽略目录 `.local/website/`。

## 发布到 GitHub Pages

1. 将网站源文件和 `.github/workflows/pages.yml` 合入公共 `main`，不要推送本地完整开发历史。
2. 在仓库 **Settings → Pages → Build and deployment → Source** 中选择 **GitHub Actions**。
3. 推送网站更改或在 Actions 手动运行 **Project website**。部署成功后访问 [项目网站](https://xjunrao-ux.github.io/spine-pet-workshop/)。

工作流只上传 `.local/website/`，不会上传本地模型、用户资料或发布包。PR 只构建，不发布；正式部署限 `main`。

## 更新内容

- 文案与布局：`website/index.html`、`styles.css`；交互：`app.js`。
- 正式版本和 EXE 链接：构建时读取根目录 `package.json`；先发布对应 Release，再更新版本。
- 插件列表：读取 [现有社区目录](../community/catalog.json)，保持该目录原有的固定下载链接、版本、权限和 SHA-256；不自动替换为未经核对的最新附件。
- 收录插件：按 [投稿规范](../community/CONTRIBUTING.md) 更新条目，运行 `pnpm community:generate`，提交条目和生成目录；网站下次构建会自动同步。新插件默认使用通用图标与说明，可在 `scripts/build-website.mjs` 补充使用准备。
- 截图和图标：构建时复制仓库内已经用于公开文档的图片。演示截图沿用 v5.1.2 界面，文字与下载对应当前正式版。

搜索、筛选、权限详情和命令复制需要 JavaScript；关闭 JavaScript 后仍可查看介绍、下载插件和打开文档。社区投稿、问题与讨论通过 GitHub Issue/PR 完成，没有账号、评分或网站上传后台。
