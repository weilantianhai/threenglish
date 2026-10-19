# Threenglish 介绍页

一个纯 HTML / CSS / JS 的静态介绍页，直接部署到 GitHub Pages，没有构建步骤。

页面的视觉语言和 App 共用一套：slate 底、白色圆角卡、indigo 主色、系统无衬线、Lucide 线性图标。
App 里的对话、改写卡片、单词弹层、词库、笔记、闪卡和画像，都在 `index.html` 里用 HTML 重写了一遍，
不是贴图；三张 Android 实机截图作为补充证据放在「界面」区块末尾。

```
site/
├── index.html      页面结构 + 用 HTML 重写的 App 界面
├── styles.css      设计变量、页面布局、App 组件样式
├── app.js          首屏入场、区块出场、一句句改写的滚动叙事
└── assets/         App 图标、三张实机截图
```

## 仓库与 APK

仓库地址已设为 `https://github.com/weilantianhai/threenglish`。页面上的「查看源码」和「下载 APK」都从这里拼出来，APK 走 Releases 固定链接：

```
<REPO_URL>/releases/latest/download/Threenglish-1.1.05.apk
```

发新版本时把 APK 传进 Releases 并改成同名文件，页面不用动。

## 部署到 GitHub Pages

GitHub Pages 从 `gh-pages` 分支的根目录发布；`main` 分支里的 `site/` 是源码。线上地址：

```
https://weilantianhai.github.io/threenglish/
```

`main` 更新后，把 `site/` 的内容同步到 `gh-pages` 根目录即可触发 Pages 重新构建。

## 本地预览

```bash
npx serve site
# 或
python -m http.server 8000 -d site
```

直接双击 `index.html` 也能看，但 `assets/` 的相对路径需要经服务器才稳。

## 内容维护

- **示例句子**：`index.html` 里 `.rewrite-card` 是滚动叙事的主角，`.a-card` 是首屏对话里的改写卡片；
  两处共用同一句，改的时候一起改，翻译和锚点词也一起换
- **首屏难度胶囊**：可点击切换「日常 / CET-4 / CET-6 / 考研」，选项文案在 `#level-menu` 里改；
  切换后胶囊标签和提示会更新，展示「选词库，AI 先查词再改写」这条能力
- **数字**：词库数量（1 987 / 3 743 / 4 544）、画像档位和用词分布都直接在对应区块里改
- **实机截图**：覆盖 `assets/live-words.png`、`live-word-sheet.png`、`live-dictionaries.png` 即可，
  尺寸建议 780 × 1688（2 倍图），页面会按 9:19.5 裁切
- **链接**：只需要改 `app.js` 顶部的 `REPO_URL`

## 动效

- 首屏：文案与手机浮起 → 改写卡片逐块出现
- 首屏难度胶囊：点开向上展开词库浮层，选中后更新标签并给 2.6 秒操作提示
- 首屏以下：区块按内容出场（ScrollTrigger，进入屏幕才播；滚回顶部离开后再进入会重播）
- 「这句，是怎么改出来的」：桌面固定 280vh 的滚动舞台，滚动依次划掉原句、写上改写、埋入锚点词和拆解；
  往回滚会倒放；窄屏缩到 260vh，只展示当前一步
- 动效库：GSAP 3.12 + ScrollTrigger，CDN 引入；不接管滚轮，滚动保持原生手感
- 减少动态效果：不固定、不缩放，所有区块直接可读
- GSAP 加载失败：`html.no-motion` 生效，页面同样完整可读
- `index.html?static=1`：跳过所有 JS 动效，用来整页截图或做静态验收

## 许可

页面里引用的词库数据来自 [KyleBing/dict](https://github.com/KyleBing/dict)（上游 [kajweb/dict](https://github.com/kajweb/dict)），页脚已署名。
