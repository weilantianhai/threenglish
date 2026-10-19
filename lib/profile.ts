// lib/profile.ts
// 本地学习者画像：只用 IndexedDB 里的笔记 + 当前会话历史，不联网、不跑模型。
//
// 能力估值不再拍一个 0~100 的加权分，而是拆成三个可解释的分项档位（词汇 / 句法 / 准确度），
// 各自按固定阈值映射到 A2~C1，再合成总档位。阈值写在 BAND_* 常量里，随时可调。

import type { NoteCard, NoteTurn } from "../app/db";
import type { ChatMessage } from "./chatStore";
import { buildVocabularyReport, type TierShare, type VocabularyReport, type WordUsage } from "./wordStats";
import { TIERS } from "./dictCatalog";
import { isPastParticiple, looksLikeParticiple } from "./nlp";

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

/** 档位名（索引 0~5 对应 A2~C1） */
export const BAND_NAMES = ["A2", "B1", "B1+", "B2", "B2+", "C1"] as const;

export type Confidence = "低" | "中" | "高";

export interface UserProfile {
  /** 参与统计的句子数 */
  sentences: number;
  /** 0~100，仅用于进度条展示；由总档位换算 */
  ability: number;
  band: string;
  targetBand: string;
  confidence: Confidence;
  /** 按词库等级分档（多词库共有的词算最低级） */
  vocab: {
    tiers: TierShare[];
    /** 不在任何词库里的占比 */
    outside: number;
  };
  /** 去重词数 / Chao1 估计词汇量（样本不足时为 null） */
  vocabSize: { unique: number; estimated: number | null };
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

/**
 * 词汇档位：看 CET-6 词占去重词的比例。
 * 阈值是经验值 —— 用六级词说明表达已经脱离「够用就行」，这是区分度最强的信号。
 */
function vocabBandIndex(highShare: number, midShare: number, unique: number): number {
  if (unique < 8) return 2; // 样本太少，先给 B1，不瞎猜
  let index = 1;
  if (highShare >= 3) index = 2;
  if (highShare >= 8) index = 3;
  if (highShare >= 15) index = 4;
  if (highShare >= 25) index = 5;
  if (highShare >= 35) index = 6;
  // 四级及以上词都用得很少，说明基础还没铺开，别报太高
  if (midShare < 25) index = Math.min(index, 2);
  return index;
}

/** 句法档位：每句的复杂结构数（从句 + 1.2×非谓语 + 0.8×被动） */
function syntaxBandIndex(complexity: number): number {
  if (complexity < 0.3) return 1;
  if (complexity < 0.6) return 2;
  if (complexity < 1.0) return 3;
  if (complexity < 1.5) return 4;
  if (complexity < 2.2) return 5;
  return 6;
}

/** 准确度档位：每句错误数（没有 errorTypes 数据时退回改写幅度） */
function accuracyBandIndex(errorsPerSentence: number, hasErrorData: boolean, distance: number): number {
  if (hasErrorData) {
    if (errorsPerSentence > 2) return 1;
    if (errorsPerSentence > 1.2) return 2;
    if (errorsPerSentence > 0.8) return 3;
    if (errorsPerSentence > 0.4) return 4;
    if (errorsPerSentence > 0.15) return 5;
    return 6;
  }
  if (distance > 0.7) return 1;
  if (distance > 0.55) return 2;
  if (distance > 0.4) return 3;
  if (distance > 0.25) return 4;
  if (distance > 0.12) return 5;
  return 6;
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

  return pairs.slice(-MAX_PAIRS);
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
      ability: 60,
      band: "B1",
      targetBand: "B1+",
      confidence: "低",
      vocab: {
        tiers: TIERS.map((tier) => ({ rank: tier.rank, label: tier.label, percent: 0, count: 0 })),
        outside: 0,
      },
      vocabSize: { unique: 0, estimated: null },
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

  const vocabReport = report ?? buildVocabularyReport(pairs.map((pair) => pair.corrected));

  let clauses = 0;
  let nonfinite = 0;
  let passive = 0;
  let distanceSum = 0;
  let errorTotal = 0;
  let errorSamples = 0;

  const errorCount = new Map<string, number>();

  for (const pair of pairs) {
    const lower = pair.corrected.toLowerCase();
    clauses += (lower.match(/\b(that|which|who|whom|whose|because|although|though|while|whereas|if|unless|when|since|as)\b/g) ?? []).length;
    nonfinite += countNonfinite(lower);
    passive += countPassive(lower);

    distanceSum += editDistance(pair.text, pair.corrected);

    const types = pair.errorTypes ?? [];
    errorTotal += types.length;
    errorSamples += 1;
    for (const type of types) {
      errorCount.set(type, (errorCount.get(type) ?? 0) + 1);
    }
  }

  const perSentence = pairs.length;
  const syntax = {
    clause: Math.round((clauses / perSentence) * 10) / 10,
    nonfinite: Math.round((nonfinite / perSentence) * 10) / 10,
    passive: Math.round((passive / perSentence) * 10) / 10,
  };
  const rewriteDistance = Math.round((distanceSum / perSentence) * 100) / 100;

  // 等级分档：rank>=4 算「高阶词」，rank>=3 算「四级及以上」
  const advancedShare = vocabReport.tiers
    .filter((tier) => tier.rank >= 4)
    .reduce((sum, tier) => sum + tier.percent, 0);
  const cetPlusShare = vocabReport.tiers
    .filter((tier) => tier.rank >= 3)
    .reduce((sum, tier) => sum + tier.percent, 0);

  const vocabIndex = vocabBandIndex(advancedShare, cetPlusShare, vocabReport.unique);
  const syntaxIndex = syntaxBandIndex(
    syntax.clause + syntax.nonfinite * 1.2 + syntax.passive * 0.8,
  );
  const accuracyIndex = accuracyBandIndex(
    errorTotal / perSentence,
    errorTotal > 0,
    rewriteDistance,
  );

  // 三项合计：词汇最能区分水平，句法次之，准确度最不稳定
  const overall = Math.min(
    6,
    Math.max(
      1,
      Math.round(vocabIndex * 0.45 + syntaxIndex * 0.3 + accuracyIndex * 0.25),
    ),
  );

  const errors = [...errorCount.entries()]
    .map(([type, count]) => ({ type: type as ErrorType, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);

  return {
    sentences: pairs.length,
    ability: Math.round(((overall - 1) / 5) * 85 + 10),
    band: bandName(overall),
    targetBand: bandName(Math.min(6, overall + 1)),
    confidence: confidenceOf(pairs.length),
    vocab: {
      tiers: vocabReport.tiers,
      outside: vocabReport.outside.percent,
    },
    vocabSize: { unique: vocabReport.unique, estimated: vocabReport.estimatedSize },
    activity: countActivity(cards),
    coverage: vocabReport.coverage,
    syntax,
    rewriteDistance,
    errors,
    subBands: {
      vocab: bandName(vocabIndex),
      syntax: bandName(syntaxIndex),
      accuracy: bandName(accuracyIndex),
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
    `- 综合档位 ${profile.band}（分项：词汇 ${profile.subBands.vocab} / 句法 ${profile.subBands.syntax} / 准确度 ${profile.subBands.accuracy}），本轮目标 ${profile.targetBand}。`,
    `- 置信度${profile.confidence}（样本 ${profile.sentences} 句）。`,
    `- 用词等级：${tierText || "无"}、表外 ${profile.vocab.outside}%（多词库共有的词按最低级算）。`,
    `- 句法（每句）：从句 ${profile.syntax.clause}，非谓语 ${profile.syntax.nonfinite}，被动 ${profile.syntax.passive}。`,
    `- 平均改写幅度：${profile.rewriteDistance}。`,
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
