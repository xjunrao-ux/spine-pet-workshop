# SpinePet 项目介绍页

GitHub Pages 静态网站：使用指南、可搜索的插件社区和开发者窗口。网站与桌面程序独立，部署不需要安装 Electron 或第三方模型。

项目网站：[SpinePet / ARKS](https://xjunrao-ux.github.io/spine-pet-workshop/)。通过 GitHub Actions 构建和部署到 GitHub Pages。构建后也可直接双击 `.local/website/index.html` 查看，不需要启动服务。

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
- 截图和图标：当前界面图来自 `docs/images/website-current/`，是 2026-11-03 重新构建并运行 v5.3.1 后拍摄的角色管理器、模型与语音检索、插件管理和真实桌宠窗口。拍摄使用独立资料目录，不包含个人账号、密钥或日常待办。
- 补充图片：`website/images/desktop-scene.png` 保留用户图片文件夹内的桌面搭配原图，转换器图标取自同工作区的转换器项目；两者随网站构建复制。
- 标题字体：`website/fonts/` 本地保存 Barlow Condensed 和 Noto Sans SC 显示字形子集及 OFL 许可，不依赖访客安装字体或在线字体服务。字形子集覆盖当前页面文案，新增中文标题时需更新子集或保留系统字体回退。

搜索、筛选、权限详情和命令复制需要 JavaScript；关闭 JavaScript 后仍可查看介绍、下载插件和打开文档。社区投稿、问题与讨论通过 GitHub Issue/PR 完成，没有账号、评分或网站上传后台。

## 页面与社区共创

页面分为介绍、新手教程、插件社区、参与共创、开发者窗口、常见问题和转换器推荐七个章节。新手教程的第一步仍称「初次使用」。桌面使用原生纵向滚动吸附，支持滚轮、触控板、键盘和章节锚点；较长章节可在内部继续滚动。手机使用较宽松的吸附，保留长文和大字号的完整阅读空间。

页面配色参考「孤星」的黄色、冷白与灰黑科研终端方向，首页保留 ARKS 字样与项目自己的阿米娅图标。英文关键字使用瘦长字体，中文标题使用方正黑体字形。介绍明确区分干员基建小人、动态立绘和包含首领的敌人战斗模型；动作、语音和字幕以具体素材及兼容性为准。

首页与顶栏默认采用浅色，搭配黄色强调；标题和关键文字使用深蓝灰色。鼠标移入顶栏时，顶栏过渡为深蓝灰背景与浅色文字，移出后恢复；键盘聚焦导航时同样强调。SpinePet 字标保持完整字形和原有图标。

首页截图可切换「桌宠实拍」「管理器」「模型检索」「桌面搭配」，首页与指南图片均支持点击放大。桌宠实拍使用真实待机动作；管理器使用与网站黄色主题一致的真实自定义浅色配色，拍摄设置只作用于隔离资料目录。

首页默认展示模型检索图，右下角的桌宠按接近日常使用的尺寸展示。鼠标接近图片或贴图时，桌宠保持原来的高度向右滑出，移开后滑回；贴图不接收指针事件，按钮与说明保留独立空间。键盘聚焦操作区时也会避让。手机端固定在预留区域；查看大桌宠图时隐藏小贴图，防止重复。

页面底部的 SCROLL 箭头具有更通透的磨砂背景与上下浮动提示，跳转到下一章，最后一章隐藏。新手教程保留关键操作的加粗强调，第三步取消文字与整行背景。指南图片采用透明圆角边框，查看完整截图的提示仅在悬停或键盘聚焦时显示。导航下划线、卡片边框、按压波纹、截图切换和章节入场提供轻量反馈；系统开启减少动态效果时关闭平滑滚动与这些动画。

最后一页推荐同一作者的 [Spine → Codex 桌宠转换器](https://github.com/xjunrao-ux/spine-codex-pet-converter)，链接到项目使用说明及正式版下载，不在网页中执行转换。

参与共创提供三类入口：

- **上传插件**：作者先在自己的 GitHub Release 上传 ZIP，表单收集插件名、版本、ID、源码、固定下载链接、SHA-256 和使用条件，再生成收录申请草稿。
- **提交意见**：填写主题、具体情况与可选的系统/桌宠版本，前往 GitHub 确认。
- **功能许愿**：填写功能、实际使用场景和期望效果，前往 GitHub 确认。

表单通过 [GitHub 官方支持的议题参数](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue)打开预填草稿。只有用户在 GitHub 登录并确认后才会提交，网页不直接发送议题或存储 ZIP。草稿仅在当前页面内存中保留，刷新页面后清除。
