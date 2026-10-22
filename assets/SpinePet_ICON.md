# SpinePet 透明应用图标

- 编辑来源：本仓库既有 `amiya-app-icon.png`。
- 制作方式：内置 imagegen 编辑，透明背景；未通过 Python 或程序算法抠图。
- 最终素材：`spinepet-icon.png`（RGBA，透明背景）；`spinepet-icon.ico`（16 / 24 / 32 / 48 / 64 / 128 / 256）。
- `pnpm icons:build` 只通过 Electron nativeImage 缩放和封装 PNG 到 ICO，保留 alpha，不另绘制背景。
- Electron 图形检查验证 PNG 四角 alpha 为 0、透明与不透明区域均存在、ICO 包含七个分辨率。现有素材的使用授权范围不因去底而改变。

使用的编辑提示词：

> Edit the provided existing SpinePet application icon. Remove ONLY the white background surrounding the seated brown-haired rabbit-eared chibi character and the faint background speckles. Keep the original character's face, pose, blue clothing, hair, ears, thick black outlines and hand-drawn style as faithfully as possible. The gaps between the character's hair and body that are background should also be transparent. Preserve white highlights and the white areas INSIDE the character. Deliver a clean 1024x1024 RGBA PNG icon with an actually transparent alpha background, softly antialiased cutout edges, no white square, no white halo, no black rectangular backing, no added shadow, no border, no new text, no extra elements. This is the final transparent application icon asset for SpinePet.
