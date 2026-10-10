# 本地运行素材

公共 Git 仓库不提交第三方角色模型、贴图或角色音频。维护者本地开发使用：

```text
public/models/amiya/
public/voicepacks/amiya-base/ja-JP/
```

这些目录由 `.gitignore` 排除，构建时 Vite 会把本地已有资源复制进 `dist/`。从源码复现固定角色版本前，需要准备对应素材。普通用户请下载 GitHub Release 中的安装版或便携版。

v2.2 的 `ark-data/` 保存语音时间轴与中文字幕配置，并附来源说明；不含角色音频。
