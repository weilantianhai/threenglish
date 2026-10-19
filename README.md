# Threenglish

把脑海里的画面直接用英文说出来，AI 帮你改写成「比现在水平高半档」的版本，并告诉你为什么这么改。

纯前端应用：所有数据（笔记、画像、词库）都存在本机，只有一个请求会发出去 —— 调用 DeepSeek 改写你的句子。

---

## 功能

| 模块 | 说明 |
|---|---|
| 首页练习 | 一句话一组，每轮 3 句；模型返回改写句、中文翻译、重点锚点分析、语法点、错误类型 |
| 单词卡片 | 任意英文词点击即查：音标、释义、词形变化、常用搭配、例句、真题例句 |
| 词库 | 本地离线查词，支持多本词库按需下载、国内镜像加速 |
| 笔记 | 每组对话自动存档，可标记已掌握、删除 |
| 我的画像 | 能力档位（A2~C1）、按词库等级分档的用词分布、高频错误、词库覆盖率 |
| 设置 | API Key、AI 兜底查词开关、AI 生成场景提示开关、词库管理入口 |

---

## 技术栈

- Next.js 16（App Router）+ React 19 + TypeScript（`strict`）
- Tailwind CSS v4
- Dexie（IndexedDB）：笔记、已下载词库
- OpenAI SDK → DeepSeek API（`deepseek-chat`，JSON 模式 + function calling）
- compromise：本地词形还原 / 过去分词判断
- Capacitor 8（Android）

---

## 目录结构

```
app/
  page.tsx           首页对话
  words/page.tsx     词库浏览与搜索
  dictionaries/      词库管理（分类横向分页）
  word/page.tsx      单词详情（直接访问用）
  notes/page.tsx     笔记
  profile/page.tsx   学习者画像
  settings/page.tsx  设置
  db.ts              Dexie 数据库（cards / dicts）
components/          共用组件（WordCard、WordCardSheet、LevelPill…）
lib/
  prompts.ts         提示词（按变化频率分段，静态内容在前）
  profile.ts         画像计算：词汇/句法/准确度三项分档
  wordStats.ts       词库使用统计（覆盖率、Chao1 词汇量估计）
  dictionary.ts      词库运行时索引（内置 3 本 + 可替换槽位）
  dictRuntime.ts     词库下载、镜像、版本、IndexedDB 持久化
  dictCatalog.ts     词库目录（分类 + 等级 + 分卷）
  nlp.ts             compromise 封装（lemma / 过去分词）
  lemma.ts           规则词形还原（不规则动词表 + 后缀规则）
  aiLookup.ts        AI 兜底查词（带本地缓存）
scripts/
  build-dict.mjs     生成内置词库 JSON
  make-icons.py      生成图标
```

---

## 开发

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # 静态导出到 out/
npx tsc --noEmit     # 类型检查
```

首次使用需要在「设置」里填 DeepSeek API Key（只存 localStorage）。

---

## 词库系统

### 内置（随包，不需要联网）

| 词库 | 词数 | 说明 |
|---|---|---|
| 初中基础 | 1987 | 初中大纲，轻量版 |
| 高中基础 | 3743 | 高中大纲，轻量版 |
| CET-4 | 4544 | 含音标 / 例句 / 常用搭配 |

内置词库是**独立槽位**，下载其他词库不会覆盖它们。

### 可下载

数据来自 [KyleBing/dict](https://github.com/KyleBing/dict)：

- 大学考试：CET-6、考研
- 英语专业：专四、专八
- 留学考试：雅思、托福、GRE、GMAT、SAT
- 商务英语：BEC
- 小学 / 初中 / 高中：人教、外研社、北师大等教材版

### 下载内容三档

| 档位 | 目录 | 内容 |
|---|---|---|
| 轻量 | `book-json-simple` | 词 + 释义 + 短语 |
| 标准（默认） | `book-json-sentence` | + 例句 + 英美音标 |
| 完整 | `book-json-full` | + 真题例句、同义词、词形变化 |

入口：词库页右上角 `⋯` → 词库管理。分类是横向分页的，镜像配置和下载进度固定在底部。

### 镜像

默认直连 GitHub。国内可填镜像前缀，例如：

```
https://ghproxy.net/https://raw.githubusercontent.com/KyleBing/dict/master
```

下载每个分卷单独计时 3 分钟，超时会提示换镜像。

### 重新生成内置词库

```bash
npm run build:dict            # 用 cet/ 本地分卷
npm run build:dict:full       # 从网络拉例句版（需要联网）
```

---

## 画像算法

拆成三个分项各自映射档位，再加权合成（`0.45 词汇 + 0.30 句法 + 0.25 准确度`）：

- **词汇**：按词库等级分档（小学 / 初中 / 高中 / 四级 / 六级 / 考研·专四·留学 / 专八），一个词被多本词库收录时**按最低等级算**
- **句法**：每句的复杂结构数（从句 + 1.2×非谓语 + 0.8×被动）
- **准确度**：每句错误数；没有错误类型数据时退回改写幅度

样本不足时给置信度提示，词汇量估计（Chao1）在样本 < 50 个内容词时直接显示「评估中」，不硬给数字。

统计窗口是最近一年，最多取最近 120 句。

---

## 打包 Android

```bash
npm run build
npx cap sync android
cd android
gradlew.bat assembleRelease
```

环境变量：

```
JAVA_HOME=D:\Java\ms-21.0.10
ANDROID_HOME=D:\config\SDK
```

签名配置在 `android/keystore.properties`（jks 在 `android/app/`）。同一个 keystore + 递增 `versionCode` 即可覆盖安装更新。

产物：`android/app/build/outputs/apk/release/app-release.apk`，发布版复制到 `dist/`。

---

## 已知限制

- 内置基础词（初中/高中）是轻量版，没有例句和音标
- 完整版词库体积较大（CET-4 三卷约 18MB），没有断点续传
- 被动语态识别依赖 compromise，个别不规则分词仍可能漏判
- 一轮对话结束后历史仍保留，长对话会累积 token
- 词库覆盖率按「主动用过的词」算，会随练习量自然增长

---

## 许可

词库数据来自 [KyleBing/dict](https://github.com/KyleBing/dict)（上游 [kajweb/dict](https://github.com/kajweb/dict)），使用时请遵守其许可。
