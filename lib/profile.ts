// lib/profile.ts
// 本地学习者画像：只用 IndexedDB 里的笔记 + 当前会话历史，不联网、不跑模型。
//
// 能力估值不再拍一个 0~100 的加权分，而是拆成三个可解释的分项档位（词汇 / 句法 / 准确度），
// 各自按固定阈值映射到 A1~C2（含 + 半档），再合成总档位。阈值写在 BAND_* 常量里，随时可调。

import type { NoteCard, NoteTurn } from "../app/db";
import type { ChatMessage } from "./chatStore";
import { buildVocabularyReport, type TierShare, type VocabularyReport, type WordUsage } from "./wordStats";
import { TIERS, getBookRank } from "./dictCatalog";
import { getWordsByLevel } from "./dictionary";
import { isPastParticiple, looksLikeParticiple, maxNounPhraseLength } from "./nlp";

/** 模型反馈的错误类型受控词表（顺序即优先级） */
export const ERROR_TYPES = [
  "article",
  "tense",
  "subject_verb",
  "preposition",
  "collocation",
  "word_order",
  "clause",
  "nonfinite",
  "word_form",
  "plural",
  "pronoun",
  "comparison",
  "modal",
  "spelling",
  "other",
] as const;

export type ErrorType = (typeof ERROR_TYPES)[number];

/**
 * 错误严重度分级（参考 error gravity 研究里的 global / local errors 划分）：
 *   致命：破坏句子结构或改变意思
 *   中等：语法细节，不影响理解
 *   轻微：措辞 / 搭配 / 拼写，属于「可以更好」而不是「写错了」
 * AI 顺手润色出来的改动不该按「写错」计权，所以权重递减。
 */
const FATAL_ERRORS = new Set<string>([
  "subject_verb",
  "tense",
  "word_form",
  "nonfinite",
  "clause",
]);
const MEDIUM_ERRORS = new Set<string>([
  "article",
  "plural",
  "preposition",
  "pronoun",
  "comparison",
  "modal",
  "word_order",
]);

function errorWeight(type: string): number {
  if (FATAL_ERRORS.has(type)) return 1;
  if (MEDIUM_ERRORS.has(type)) return 0.7;
  return 0.4; // collocation / spelling / other：润色与笔误
}

/**
 * 词库等级 → 词汇量下限（词族，CEFR 粗略对应）。
 * 用「在哪一档产出过足够多的词」作为证据，而不是用已经算好的综合档位，
 * 避免「档位影响词汇量、词汇量又影响档位」的循环。
 */
const TIER_VOCAB_FLOOR = [700, 1500, 2500, 3500, 4500, 5500, 6500];

/** 单档至少产出这么多不同的词，才认为该档有证据 */
const TIER_EVIDENCE_MIN = 3;

/**
 * 证据量上限：句子太少时不给最高档。
 * 语言测评里有同样的规则 —— 证据不足不能授予顶级水平。
 */
const EVIDENCE_CAP = [
  { sentences: 20, cap: 11 }, // 11 档全部可用（= C2）
  { sentences: 8, cap: 9 }, // 8~19 句：最高 C1
  { sentences: 0, cap: 7 }, // 8 句以下：最高 B2+
];

export const ERROR_LABEL: Record<ErrorType, string> = {
  article: "冠词",
  tense: "时态",
  subject_verb: "主谓一致",
  preposition: "介词",
  collocation: "搭配",
  word_order: "语序",
  clause: "从句",
  nonfinite: "非谓语",
  word_form: "词形",
  plural: "单复数",
  pronoun: "代词",
  comparison: "比较级",
  modal: "情态动词",
  spelling: "拼写",
  other: "其他",
};

/** 档位名：A1~C2 的 6 个等级 + 中间 5 个 + 半档 */
export const BAND_NAMES = [
  "A1",
  "A1+",
  "A2",
  "A2+",
  "B1",
  "B1+",
  "B2",
  "B2+",
  "C1",
  "C1+",
  "C2",
] as const;

export type Confidence = "低" | "中" | "高";

export interface UserProfile {
  /** 参与统计的句子数 */
  sentences: number;
  /** 0~100，仅用于进度条展示；由总档位换算 */
  ability: number;
  band: string;
  targetBand: string;
  /** 档位是否因为样本不足被封顶 */
  capped: boolean;
  confidence: Confidence;
  /** 按词库等级分档（多词库共有的词算最低级） */
  vocab: {
    tiers: TierShare[];
    /** 不在任何词库里的占比 */
    outside: number;
  };
  /** 去重词数 / 等级推断下限 / 样本覆盖率 */
  vocabSize: {
    unique: number;
    /** 按等级证据推断的「至少认识多少词」 */
    tierFloor: number | null;
    /** Good–Turing 样本覆盖率（%），越低说明还有越多新词没出现 */
    coveragePercent: number;
  };
  /** 活跃度：最近 30 天 / 最近一年 练了几组 */
  activity: { month: number; year: number };
  /** 词库覆盖率（%） */
  /** 各已安装词库的覆盖率（%），key 是词库 id */
  coverage: Record<string, number>;
  syntax: { clause: number; nonfinite: number; passive: number };
  rewriteDistance: number;
  errors: Array<{ type: ErrorType; count: number }>;
  /** 三个分项各自落在哪个档位 */
  subBands: { vocab: string; syntax: string; accuracy: string };
  mastered: number;
  totalCards: number;
  /** 使用次数最多的词（给展示页的表格用） */
  usage: WordUsage[];
}

export interface Pair {
  text: string;
  corrected: string;
  errorTypes?: string[];
}

// ---------- 句法辅助 ----------

/** 常见动词表：只有 to + 这些词才算不定式，避免 to school / to the 误判 */
const VERB_WORDS = new Set<string>([
  "go", "be", "have", "do", "make", "get", "take", "see", "keep", "avoid",
  "improve", "consider", "want", "need", "try", "use", "find", "give", "know", "think",
  "tell", "say", "speak", "talk", "ask", "answer", "learn", "study", "read", "write",
  "listen", "hear", "watch", "look", "play", "work", "live", "stay", "leave", "come",
  "arrive", "start", "stop", "finish", "begin", "help", "change", "grow", "become", "feel",
  "seem", "appear", "happen", "allow", "decide", "choose", "plan", "hope", "expect", "agree",
  "refuse", "offer", "promise", "manage", "fail", "afford", "practice", "enjoy", "mind", "suggest",
  "remember", "forget", "understand", "explain", "describe", "discuss", "develop", "create", "build",
  "buy", "pay", "send", "bring", "show", "meet", "open", "close", "move", "run",
  "walk", "drive", "eat", "drink", "sleep", "wait", "return", "continue", "like", "love",
  "travel",
]);

/** -ing 结尾但不是分词的高频词 */
const ING_NOT_PARTICIPLE = new Set<string>([
  "nothing", "something", "anything", "everything",
  "thing", "things", "morning", "evening", "spring",
  "during", "including", "according", "having",
  // 这些是介词 / 连词，句首出现时会被 ^\w+ing 误判成分词
  "notwithstanding", "regarding", "concerning", "considering",
  "pending", "following", "excluding", "owing", "seeing", "provided",
]);

/** 进行时不算非谓语：先剔除 be + -ing，再匹配分词结构 */
function withoutProgressive(text: string): string {
  return text.replace(
    /\b(?:is|are|was|were|be|been|being)\s+(?:not\s+)?(?:\w+ly\s+)?[a-z]+ing\b/g,
    " ",
  );
}

/** 被动语态：be + (副词) + 过去分词。规则形式看后缀，不规则形式（made/built/sent）交给 compromise */
function countPassive(lower: string): number {
  let count = 0;
  for (const match of lower.matchAll(
    /\b(is|are|was|were|be|been|being)\s+(?:[a-z]+ly\s+)?([a-z]+)\b/g,
  )) {
    const word = match[1];
    const next = match[2];
    if (next === "not") continue;
    if (looksLikeParticiple(next) || isPastParticiple(next)) count += 1;
  }
  return count;
}

/** 非谓语计数：句首分词 / 逗号后分词 / having + ed / to + 常见动词 */function countNonfinite(lower: string): number {
  const text = withoutProgressive(lower);
  let count = 0;

  const head = text.match(/^\s*([a-z]+ing)\b/);
  if (head && !ING_NOT_PARTICIPLE.has(head[1])) count += 1;

  for (const match of text.match(/,\s*([a-z]+ing)\b/g) ?? []) {
    const word = match.replace(/^,\s*/, "");
    if (!ING_NOT_PARTICIPLE.has(word)) count += 1;
  }

  count += (text.match(/\bhaving\s+[a-z]+ed\b/g) ?? []).length;

  for (const match of text.matchAll(/\bto\s+([a-z]+)\b/g)) {
    if (VERB_WORDS.has(match[1])) count += 1;
  }

  return count;
}

/** 归一化编辑距离：改动了多少比例的字符 */
function editDistance(a: string, b: string): number {
  const s = a || "";
  const t = b || "";
  if (!s && !t) return 0;
  if (!s || !t) return 1;

  const rows = s.length + 1;
  const cols = t.length + 1;
  let prev = new Array<number>(cols);
  let cur = new Array<number>(cols);

  for (let j = 0; j < cols; j++) prev[j] = j;

  for (let i = 1; i < rows; i++) {
    cur[0] = i;
    for (let j = 1; j < cols; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }

  return prev[cols - 1] / Math.max(s.length, t.length);
}

// ---------- 档位映射 ----------
//
// 内部先算 1~6 的连续档位（1=A1 … 6=C2）：整数就是原来的档位阈值，小数表示落在两档之间。
// 最后再映射到 BAND_NAMES 的 11 个槽位，多出来的偶数位就是 + 半档。

/** 分段线性插值：stops 按 x 升序，取到整数处即原来的档位边界 */
function interpolate(x: number, stops: ReadonlyArray<readonly [number, number]>): number {
  if (!Number.isFinite(x) || x <= stops[0][0]) return stops[0][1];

  for (let i = 1; i < stops.length; i += 1) {
    const [x1, y1] = stops[i - 1];
    const [x2, y2] = stops[i];
    if (x <= x2) {
      if (x2 === x1) return y2;
      return y1 + ((x - x1) / (x2 - x1)) * (y2 - y1);
    }
  }

  return stops[stops.length - 1][1];
}

/** 连续档位（1~6）→ 档位下标（1~11）：1.0→A1、1.5→A1+、2.0→A2 … 6.0→C2 */
function toBandIndex(value: number): number {
  return Math.min(BAND_NAMES.length, Math.max(1, Math.round((value - 1) * 2) + 1));
}

/**
 * 词汇档位：看 CET-6 词占去重词的比例。
 * 阈值是经验值 —— 用六级词说明表达已经脱离「够用就行」，这是区分度最强的信号。
 */
const VOCAB_STOPS = [
  [0, 1],
  [3, 2],
  [8, 3],
  [15, 4],
  [25, 5],
  // C1 要 25% 高阶词，C2 要 45%：不能被几个碰巧用对的难词顶上去
  [35, 5.5],
  [45, 6],
] as const;

function vocabBandValue(highShare: number, midShare: number, unique: number): number {
  if (unique < 8) return 3; // 样本太少，先给中间档 B1，不瞎猜
  const value = interpolate(highShare, VOCAB_STOPS);
  // 四级及以上词都用得很少，说明基础还没铺开，别报太高
  return midShare < 25 ? Math.min(value, 2) : value;
}

/** 句法档位：每句的复杂结构数（从句 + 1.2×非谓语 + 0.8×被动） */
const SYNTAX_STOPS = [
  [0, 1],
  [0.3, 2],
  [0.6, 3],
  [1.0, 4],
  [1.5, 5],
  // C2 需要明显更强的句法证据：2.2 结构/句只到 C1+，3.0 才给 C2
  [2.2, 5.5],
  [3.0, 6],
] as const;

function syntaxBandValue(complexity: number): number {
  return interpolate(complexity, SYNTAX_STOPS);
}

/**
 * 准确度档位：只看模型标注的 errorTypes，错误越多档越低。
 * 不用「改写幅度」兜底 —— 那是 AI 改了多少，不是用户写了多少错误。
 * 完全没有 errorTypes 数据时给中性档，不猜。
 * 单位：每 100 词。按「每 100 词」而不是「每句」算，长句和短句的错误才能公平比较
 * （原阈值按平均每句约 10 词标定，换算成每 100 词约 ×10）。
 */
const ACCURACY_STOPS = [
  [0, 6],
  [1.5, 5],
  [4, 4],
  [8, 3],
  [12, 2],
  [20, 1],
] as const;

function accuracyBandValue(errorsPer100Words: number, hasErrorData: boolean): number {
  if (!hasErrorData) return 3; // 无数据 → 中性档，避免用错误信号反向误伤
  return interpolate(errorsPer100Words, ACCURACY_STOPS);
}

function bandName(index: number): string {
  return BAND_NAMES[Math.min(BAND_NAMES.length - 1, Math.max(0, index - 1))];
}

function confidenceOf(sentences: number): Confidence {
  if (sentences >= 30) return "高";
  if (sentences >= 10) return "中";
  return "低";
}

// ---------- 主流程 ----------

/** 只统计最近一年：更久远的练习代表不了当前水平 */
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
/** 一年可能有上千句，全算太慢，取最近这么多句 */
const MAX_PAIRS = 120;

export function collectPairs(cards: NoteCard[], history: ChatMessage[]): Pair[] {
  const pairs: Pair[] = [];

  const now = Date.now();
  const cutoff = now - YEAR_MS;
  const recentCards = cards
    .filter((card) => (card.createdAt ?? now) >= cutoff)
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

  for (const card of recentCards) {
    for (const turn of [card.turn1, card.turn2, card.turn3] as NoteTurn[]) {
      if (turn?.corrected?.trim()) {
        pairs.push({ text: turn.text, corrected: turn.corrected, errorTypes: turn.errorTypes });
      }
    }
  }

  for (let i = 0; i < history.length; i++) {
    const msg = history[i];
    if (msg.role !== "user") continue;
    const next = history[i + 1];
    if (next && next.role === "ai" && next.content.corrected?.trim()) {
      pairs.push({
        text: msg.content,
        corrected: next.content.corrected,
        errorTypes: next.content.errorTypes,
      });
    }
  }

  // 一轮结束后该组会入库，同时历史里还留着这 3 句 —— 按「原句 + 改写句」去重，避免重复计入
  const seen = new Set<string>();
  const unique = pairs.filter((pair) => {
    const key = `${pair.text.trim().toLowerCase()}→${pair.corrected.trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique.slice(-MAX_PAIRS);
}

/** 最近 30 天 / 最近一年 的练习组数 */
export function countActivity(cards: NoteCard[]): { month: number; year: number } {
  const now = Date.now();
  let month = 0;
  let year = 0;

  for (const card of cards) {
    const created = card.createdAt ?? 0;
    if (created >= now - YEAR_MS) year += 1;
    if (created >= now - MONTH_MS) month += 1;
  }

  return { month, year };
}

export function computeProfile(
  cards: NoteCard[],
  history: ChatMessage[],
  report?: VocabularyReport,
): UserProfile {
  const pairs = collectPairs(cards, history);
  const totalCards = cards.length;
  const mastered = cards.filter((card) => card.isMastered).length;

  if (pairs.length === 0) {
    return {
      sentences: 0,
      ability: 44,
      band: "B1",
      targetBand: "B1+",
      capped: false,
      confidence: "低",
      vocab: {
        tiers: TIERS.map((tier) => ({ rank: tier.rank, label: tier.label, percent: 0, count: 0 })),
        outside: 0,
      },
      vocabSize: { unique: 0, tierFloor: null, coveragePercent: 0 },
      activity: countActivity(cards),
      coverage: {},
      syntax: { clause: 0, nonfinite: 0, passive: 0 },
      rewriteDistance: 0,
      errors: [],
      subBands: { vocab: "B1", syntax: "B1", accuracy: "B1" },
      mastered,
      totalCards,
      usage: [],
    };
  }

  const vocabReport = report ?? buildVocabularyReport(pairs.map((pair) => pair.text));

  let clauses = 0;
  let nonfinite = 0;
  let passive = 0;
  let npLengthSum = 0;
  let distanceSum = 0;
  let errorTotal = 0;
  let errorSamples = 0;

  // 每句的句法复杂度：说话不是句句都在巅峰，用 75 分位看「他能写出多复杂的句子」，
  // 再和均值混合，避免一句 hello 把整体拉低；也避免只挑最好的一句把分吹高。
  const sentenceComplexities: number[] = [];

  const errorCount = new Map<string, number>();
  // 只要任意一句带 errorTypes 字段（哪怕是空数组），就说明模型给了判定数据
  let hasErrorData = false;

  for (const pair of pairs) {
    // 评分读用户原句：AI 改写成什么样，不该反过来决定用户水平
    const lower = pair.text.toLowerCase();
    const clauseHit = (lower.match(/\b(that|which|who|whom|whose|because|although|though|while|whereas|if|unless|when|since|as)\b/g) ?? []).length;
    const nonfiniteHit = countNonfinite(lower);
    const passiveHit = countPassive(lower);
    // 最长名词短语：找「多层修饰的 NP」，正则看不到这一层
    const npLength = maxNounPhraseLength(pair.text);
    const npBonus = Math.min(0.9, Math.max(0, (npLength - 2.5) * 0.5));

    clauses += clauseHit;
    nonfinite += nonfiniteHit;
    passive += passiveHit;
    npLengthSum += npLength;
    sentenceComplexities.push(clauseHit + nonfiniteHit * 1.2 + passiveHit * 0.8 + npBonus);

    // 改写幅度只做展示，不参与打分
    distanceSum += editDistance(pair.text, pair.corrected);

    const types = pair.errorTypes ?? [];
    if (pair.errorTypes !== undefined) hasErrorData = true;
    errorSamples += 1;
    for (const type of types) {
      // 按严重度加权：致命 1 / 中等 0.7 / 轻微 0.4
      errorTotal += errorWeight(type);
      errorCount.set(type, (errorCount.get(type) ?? 0) + 1);
    }
  }

  // 用户原句的总词数（全部英文词，不是内容词）；只统计原句，不看 AI 改写后的句子
  const wordTotal = pairs.reduce(
    (sum, pair) => sum + (pair.text.match(/[a-zA-Z']+/g)?.length ?? 0),
    0,
  );

  const perSentence = pairs.length;
  const syntax = {
    clause: Math.round((clauses / perSentence) * 10) / 10,
    nonfinite: Math.round((nonfinite / perSentence) * 10) / 10,
    passive: Math.round((passive / perSentence) * 10) / 10,
  };
  const rewriteDistance = Math.round((distanceSum / perSentence) * 100) / 100;

  // 等级分档：只在「词库里认识」的词上算，表外词不参与分母。
  // 但表外里那些长词 / 拉丁词缀词，多半是超出当前词库的高阶词 —— 不能当成「水平低」，
  // 把它们算作高阶证据，剩下的表外（疑似拼错的基础词）才真正算「判断不了」。
  const knownTotal = Math.max(0, vocabReport.unique - vocabReport.outside.count + vocabReport.advancedOutside);
  const unknownShare =
    vocabReport.unique > 0
      ? ((vocabReport.outside.count - vocabReport.advancedOutside) / vocabReport.unique) * 100
      : 0;

  const advancedCount =
    vocabReport.tiers
      .filter((tier) => tier.rank >= 4)
      .reduce((sum, tier) => sum + tier.count, 0) + vocabReport.advancedOutside;
  const cetPlusCount =
    vocabReport.tiers
      .filter((tier) => tier.rank >= 3)
      .reduce((sum, tier) => sum + tier.count, 0) + vocabReport.advancedOutside;

  const advancedShare = knownTotal > 0 ? (advancedCount / knownTotal) * 100 : 0;
  const cetPlusShare = knownTotal > 0 ? (cetPlusCount / knownTotal) * 100 : 0;

  const canJudgeVocab = knownTotal >= 8 && unknownShare < 40;
  const vocabValue = canJudgeVocab
    ? vocabBandValue(advancedShare, cetPlusShare, knownTotal)
    : null;

  // 句法：均值 + 75 分位各半。均值代表「平时怎么写」，75 分位代表「认真写能写到什么程度」，
  // 这样日常打招呼的短句不会把上限拉死，也不会被一句长句带飞。
  const avgMaxNp = npLengthSum / perSentence;
  const npBonus = Math.min(0.9, Math.max(0, (avgMaxNp - 2.5) * 0.5));
  const avgComplexity =
    syntax.clause + syntax.nonfinite * 1.2 + syntax.passive * 0.8 + npBonus;
  const sortedComplexities = [...sentenceComplexities].sort((a, b) => a - b);
  const p75 =
    sortedComplexities[Math.min(sortedComplexities.length - 1, Math.floor(sortedComplexities.length * 0.75))] ??
    avgComplexity;
  const syntaxValue = syntaxBandValue(avgComplexity * 0.5 + p75 * 0.5);
  // 准确度按「每 100 词错误数」算；不到 30 词的样本不足以判断，走中性档
  const errorDensity = wordTotal >= 30 ? (errorTotal / wordTotal) * 100 : null;
  const accuracyValue = accuracyBandValue(errorDensity ?? 0, hasErrorData && errorDensity !== null);

  // 词汇档缺失时，把权重让给句法和准确度，而不是按 0 分算
  const weighted = [
    { value: vocabValue, weight: 0.45 },
    { value: syntaxValue, weight: 0.3 },
    { value: accuracyValue, weight: 0.25 },
  ].filter((item): item is { value: number; weight: number } => item.value !== null);

  const weightSum = weighted.reduce((sum, item) => sum + item.weight, 0);
  const blended = weighted.reduce((sum, item) => sum + item.value * item.weight, 0) / weightSum;

  // 加权结果是 1~6 的连续值，转成 1~11 的档位下标（含 + 半档）
  const rawOverall = toBandIndex(blended);

  // 证据不足时封顶：3 句全对不能直接给 C2
  const evidenceCap =
    EVIDENCE_CAP.find((item) => pairs.length >= item.sentences)?.cap ?? 7;
  const overall = Math.min(rawOverall, evidenceCap);

  const errors = [...errorCount.entries()]
    .map(([type, count]) => ({ type: type as ErrorType, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);

  // 词汇量三路信号取最大：
  //   1) Chao1 偏差校正（捕获-再捕获）
  //   2) Good–Turing 覆盖率反推（U / Ĉ），小样本下更稳
  //   3) 等级证据下限：在哪一档产出过足够多的词，就至少认识底下那批词
  //      —— 这就是「会一个六级词，说明四级那批大概率也会」
  const vocabSignals = [vocabReport.estimatedSize, vocabReport.coverageEstimate].filter(
    (value): value is number => value !== null,
  );
  const heuristic = vocabSignals.length > 0 ? Math.max(...vocabSignals) : 0;

  // 有证据的最高等级（该档至少用到 TIER_EVIDENCE_MIN 个不同的词）
  let evidenceRank = -1;
  for (const tier of vocabReport.tiers) {
    if (tier.count >= TIER_EVIDENCE_MIN && tier.rank > evidenceRank) evidenceRank = tier.rank;
  }

  // 词库外的长词 / 拉丁词缀词，多半是六级及以上的词 —— 也算「高阶证据」
  if (vocabReport.advancedOutside >= 8) evidenceRank = Math.max(evidenceRank, 5);
  else if (vocabReport.advancedOutside >= TIER_EVIDENCE_MIN) {
    evidenceRank = Math.max(evidenceRank, 4);
  }

  const tierFloor =
    evidenceRank >= 0 ? (TIER_VOCAB_FLOOR[evidenceRank] ?? 0) : 0;
  // 样本越少，这个下限越不该全额生效
  const sampleFactor = Math.min(1, vocabReport.tokens / 200);
  const bandFloor = Math.round(tierFloor * sampleFactor);

  // 样本太小时不做跨档外推，免得「30 个词估出 8000」。
  // 只给「等级推断下限」这一个数字：覆盖率外推估的是「这类文本里还会出现多少新词」，
  // 和「总共认识多少词」不是一回事，两个数字并列会互相打架，所以只留覆盖率百分比做质量提示。
  const coveragePercent = Math.round(vocabReport.sampleCoverage * 100);

  // 词库覆盖率改用「推断认识量」而不是「实际用过几个词」：
  // 只练了几句就说 CET-4 覆盖 0.3% 没有意义。
  // 分母取「该词库 + 它下面所有已安装词库」的总量，这样低阶词库不会一律 100%，
  // 高阶词库也不会被同一个词重复计数太多（词库之间有重叠，这里只做近似）。
  const installed = Object.keys(vocabReport.coverage);
  const rankOf = (level: string) => getBookRank(level);
  const sizeOf = (level: string) => getWordsByLevel(level).length;

  const coverage: Record<string, number> = {};
  if (tierFloor > 0) {
    for (const level of installed) {
      const rank = rankOf(level);
      const base = installed
        .filter((other) => rankOf(other) <= rank)
        .reduce((sum, other) => sum + sizeOf(other), 0);
      if (base > 0) {
        coverage[level] = Math.min(100, Math.round((tierFloor / base) * 1000) / 10);
      }
    }
  } else {
    Object.assign(coverage, vocabReport.coverage);
  }

  return {
    sentences: pairs.length,
    ability: Math.round(((overall - 1) / (BAND_NAMES.length - 1)) * 85 + 10),
    band: bandName(overall),
    targetBand: bandName(Math.min(BAND_NAMES.length, overall + 1)),
    capped: rawOverall > evidenceCap,
    confidence: canJudgeVocab ? confidenceOf(pairs.length) : "低",
    vocab: {
      tiers: vocabReport.tiers,
      outside: vocabReport.outside.percent,
    },
    vocabSize: {
      unique: vocabReport.unique,
      tierFloor: bandFloor > 0 ? bandFloor : null,
      coveragePercent,
    },
    activity: countActivity(cards),
    coverage,
    syntax,
    rewriteDistance,
    errors,
    subBands: {
      // 表外词太多时词汇档判断不了，显示「—」而不是猜一个低档
      vocab: vocabValue === null ? "—" : bandName(toBandIndex(vocabValue)),
      syntax: bandName(toBandIndex(syntaxValue)),
      accuracy: bandName(toBandIndex(accuracyValue)),
    },
    mastered,
    totalCards,
    usage: vocabReport.usage.slice(0, 50),
  };
}

/** 给模型看的画像摘要（控制篇幅，别把 token 烧在描述上） */
export function formatProfile(profile: UserProfile, dictLabel: string): string {
  if (profile.sentences === 0) {
    return `- 暂无历史数据（新用户），按 ${dictLabel} 中上水平出题，改写比原句高半档即可。`;
  }

  const tierText = profile.vocab.tiers
    .filter((tier) => tier.percent > 0)
    .map((tier) => `${tier.label} ${tier.percent}%`)
    .join("、");

  const lines: string[] = [
    `- 以下指标全部来自用户的原句（不是你的改写结果），请据此判断他现在的真实水平。`,
    `- 综合档位 ${profile.band}（分项：词汇 ${profile.subBands.vocab} / 句法 ${profile.subBands.syntax} / 准确度 ${profile.subBands.accuracy}），本轮目标 ${profile.targetBand}。`,
    `- 置信度${profile.confidence}（样本 ${profile.sentences} 句）。`,
    `- 用词等级：${tierText || "无"}、表外 ${profile.vocab.outside}%（多词库共有的词按最低级算）。`,
    `- 句法（每句）：从句 ${profile.syntax.clause}，非谓语 ${profile.syntax.nonfinite}，被动 ${profile.syntax.passive}。`,
    `- 活跃度：最近 30 天 ${profile.activity.month} 组、最近一年 ${profile.activity.year} 组（更久远的不计入）。`,
  ];

  if (profile.errors.length > 0) {
    const top = profile.errors
      .map((item) => `${ERROR_LABEL[item.type] ?? item.type}×${item.count}`)
      .join("、");
    lines.push(`- 高频错误：${top}（已稳定的别再出，最多挑 1 个巩固）。`);
  }

  if (profile.totalCards > 0) {
    lines.push(`- 已练 ${profile.totalCards} 组，其中 ${profile.mastered} 组标记已掌握。`);
  }

  const advancedShare = profile.vocab.tiers
    .filter((tier) => tier.rank >= 4)
    .reduce((sum, tier) => sum + tier.percent, 0);

  const weak: string[] = [];
  if (profile.syntax.nonfinite < 0.3) weak.push("非谓语几乎不用");
  if (profile.syntax.clause < 0.4) weak.push("从句偏少");
  if (profile.syntax.passive < 0.05) weak.push("被动语态没出现过");
  if (advancedShare < 5) weak.push("几乎不主动用六级及以上的词");

  if (weak.length > 0) lines.push(`- 本轮可重点推：${weak.join("、")}。`);

  return lines.join("\n");
}

/** 给提示词的「本轮建议练的薄弱点」 */
export function buildPracticeFocus(profile: UserProfile): string {
  if (profile.sentences === 0) return "";

  const advancedShare = profile.vocab.tiers
    .filter((tier) => tier.rank >= 4)
    .reduce((sum, tier) => sum + tier.percent, 0);

  const focus: string[] = [];
  if (profile.syntax.nonfinite < 0.3) focus.push("非谓语（分词/不定式）");
  if (profile.syntax.clause < 0.4) focus.push("从句");
  if (profile.syntax.passive < 0.05) focus.push("被动语态");
  if (advancedShare < 5) focus.push("用 1 个六级及以上的词替换口语词");

  if (profile.errors.length > 0) {
    const top = profile.errors[0];
    focus.push(`巩固「${ERROR_LABEL[top.type] ?? top.type}」`);
  }

  return focus.length > 0 ? focus.join("；") : "";
}
