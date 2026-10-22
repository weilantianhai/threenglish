# Threenglish

把脑海里的画面直接用英文说出来，AI 帮你改写成「比现在水平高半档」的版本，并告诉你为什么这么改。

纯前端应用：所有数据（笔记、画像、词库）都存在本机，只有一个请求会发出去 —— 调用 DeepSeek 改写你的句子。

- 项目展示页：https://weilantianhai.github.io/threenglish/  （源码在 `docs/`）
- 最新 Android 安装包：https://github.com/weilantianhai/threenglish/releases/latest

---

## 功能

| 模块 | 说明 |
|---|---|
| 首页练习 | 一句话一组，每轮 3 句；模型返回改写句、中文翻译、重点锚点分析、语法点、错误类型 |
| 单词卡片 | 任意英文词点击即查：音标、释义、词形变化、常用搭配、例句、真题例句 |
| 词库 | 本地离线查词，支持多本词库按需下载、国内镜像加速 |
| 笔记 | 每组对话自动存档，可标记已掌握、删除 |
| 我的画像 | 能力档位（A1~C2）、按词库等级分档的用词分布、高频错误、词库覆盖率 |
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

下载任务是全局的：切页面、按返回键都不会中断，回到词库管理页能接上进度；底部进度条可以取消。同一本词库同时只会有一个任务（重复点击复用它），镜像前缀和内容档位在任务开始时锁定，中途改设置只影响下一次下载。

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

**所有指标都从用户原句计算，不看 AI 的改写结果**——否则会形成「AI 改得越多 → 用户分越低」的倒灌回路。

拆成三个分项各自映射档位，再加权合成（`0.45 词汇 + 0.30 句法 + 0.25 准确度`；某个分项判断不了时，把它的权重让给其余分项）：

- **词汇**：按词库等级分档（小学 / 初中 / 高中 / 四级 / 六级 / 考研·专四·留学 / 专八），多词库共有的词**按最低等级算**。
  表外词里的长词 / 拉丁词缀词算作高阶证据；剩下的表外占比 ≥ 40% 时不判词汇档，显示「—」而不是猜一个低档。
- **句法**：每句的复杂结构数（从句 + 1.2×非谓语 + 0.8×被动）+ 名词短语加分。
  NP 加分用 compromise 的 `nouns()` 取最长名词短语，平均超过 2.5 词才计分（封顶 0.9），
  用来捕捉「多层修饰的 NP」这种正则看不见的结构。
- **准确度**：只看模型标注的 `errorTypes`。`errorTypes: []` 视为「零错误」而不是「没数据」；完全没有该字段时才给中性档。
  错误按严重度计权（参考 error gravity 的 global / local 划分）：

  | 级别 | 类型 | 权重 |
  |---|---|---|
  | 致命 | 主谓一致 / 时态 / 词形 / 非谓语 / 从句 | 1.0 |
  | 中等 | 冠词 / 单复数 / 介词 / 代词 / 比较级 / 情态 / 语序 | 0.7 |
  | 轻微 | 搭配 / 拼写 / 其他（润色与笔误） | 0.4 |

  同时提示词里明确要求：AI 自己的润色、换更高级的同义词、调语序，不许写进 `errorTypes`。

改写幅度（原句与改写句的编辑距离）**只做展示，不参与打分**。

统计先按「原句 + 改写句」去重，避免同一句既在笔记里又在对话历史里被算两次。窗口是最近一年、最多 120 句。

### 证据不足封顶

句子太少时不给最高档（语言测评同样规则：证据不足不能授予顶级水平）：

| 样本 | 综合档位上限 |
|---|---|
| < 8 句 | B2 |
| 8~19 句 | C1 |
| ≥ 20 句 | C2 |

被封顶时画像页会提示「单项表现不错，但样本还不够」。

### 词汇量估计

不再把几个估计器取 `max` 凑成一个数（它们答的是不同问题，取最大只会挑最乐观的那个）。
现在画像页分三行，各自标明性质：

| 显示 | 性质 | 来源 |
|---|---|---|
| 已主动使用 N 个不同的词 | **事实** | 去重后的实际用词数 |
| 至少认识 M 个词 | **推断** | 等级证据下限：在哪一档产出过 ≥3 个不同的词，就至少认识底下那批（小学 700 → 专八 6500 词族），再乘 `min(1, 内容词/200)` 的样本系数；词库外的长词也算高阶证据 |
| 样本覆盖率 X% | **质量指标** | Good–Turing `Ĉ = 1 − f1/n`，越低说明还有越多新词没出现 |

等级下限刻意不读综合档位，避免「档位影响词汇量、词汇量又影响档位」的循环。

词库覆盖率也用这个「至少认识」的量来估：分母取「该词库 + 它下面所有已安装词库」的总量，
这样练几句也能看到 100% / 96% / 54% 这种有区分度的数，而不是一律 0.x%。

### 句法用「均值 + 75 分位」

说话不会句句都在巅峰（打招呼、寒暄的句子必然更简单）。所以句法分 = `0.5 × 平均复杂度 + 0.5 × 75 分位复杂度`：
均值代表平时状态，75 分位代表「认真写能写到什么程度」，既不被一句 hello 拉死，也不会被一句长句带飞。

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
