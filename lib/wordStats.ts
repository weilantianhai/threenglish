// lib/wordStats.ts
// 词库使用统计：用户实际用过哪些词、覆盖了多少词库、哪些词从没用过。
// 纯本地计算，输入是「用户练过的句子」，输出是一份可展示、也可给模型当资源用的报告。

import { getBookRank, TIERS } from "./dictCatalog";
import { getInstalledLevels, getWordsByLevel, resolveWord, type DictLevel } from "./dictionary";

/** 功能词：只承担语法功能，不进词汇统计 */
const FUNCTION_WORDS = new Set<string>([
  // 冠词
  "a", "an", "the",
  // be / do / have
  "be", "am", "is", "are", "was", "were", "been", "being",
  "do", "does", "did", "done", "doing",
  "have", "has", "had", "having",
  // 代词
  "i", "me", "my", "mine",
  "we", "us", "our", "ours",
  "you", "your", "yours",
  "he", "him", "his",
  "she", "her", "hers",
  "it", "its",
  "they", "them", "their", "theirs",
  "something", "anything", "everything", "nothing", "none",
  // 疑问 / 关系
  "what", "which", "who", "whom", "whose", "where", "why", "how",
  // 介词
  "about", "above", "across", "after", "against", "along", "among", "around",
  "as", "at", "before", "behind", "below", "between", "by", "down", "during",
  "except", "for", "from", "in", "inside", "into", "like", "near", "of", "off",
  "on", "onto", "out", "over", "past", "since", "through", "to",
  "under", "until", "up", "with", "without",
  // 连词
  "and", "or", "but", "so", "yet", "nor", "because", "although", "though",
  "while", "whereas", "if", "unless", "when", "whether", "than", "that",
  "both", "either",
  // 情态
  "can", "could", "may", "might", "must", "shall", "should", "will", "would",
  // 数词
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  // 限定词 / 量化
  "this", "these", "those", "some", "any", "no", "all", "each", "every",
  "few", "many", "much", "more", "most", "such", "another", "other", "enough",
  // 常用副词
  "there", "here", "not", "now", "then", "too", "very", "just", "also",
  "only", "still", "always", "never", "often",
  // 缩写
  "don't", "doesn't", "didn't", "isn't", "aren't", "wasn't", "weren't",
  "can't", "cannot", "won't", "couldn't", "wouldn't", "shouldn't", "haven't",
]);

/** 缩写按词干再查一次（it's → it、they're → they），student's 不会被误伤 */
export function isFunctionWord(word: string): boolean {
  return (
    FUNCTION_WORDS.has(word) ||
    FUNCTION_WORDS.has(word.replace(/'(?:s|re|ve|ll|d|m|t)$/, ""))
  );
}

/** 单词按词库等级分档（多词库共有的词按最低级算） */
export interface TierShare {
  rank: number;
  label: string;
  percent: number;
  count: number;
}

export interface WordUsage {
  word: string;
  count: number;
  levels: DictLevel[];
}

export interface VocabularyReport {
  /** 内容词总次数（分母） */
  tokens: number;
  /** 去重后的词数 */
  unique: number;
  /** Chao1 估计的「实际词汇量」；样本不足时为 null（别硬给数字） */
  estimatedSize: number | null;
  /** 样本是否够算出可信的词汇量估计 */
  estimateConfident: boolean;
  /** 按等级分档的去重词数占比 */
  tiers: TierShare[];
  /** 不在任何词库里的词数 / 占比 */
  outside: { count: number; percent: number };
  /** 按使用次数降序 */
  usage: WordUsage[];
  /** 各词库的词条覆盖率（百分比，按词库 id） */
  coverage: Record<string, number>;
  /** 各词库里还没被用过的词（给 practice_words 用，最多 800 个） */
  unused: Record<string, string[]>;
}

/** 从句子集合里抽内容词并统计 */
export function buildVocabularyReport(sentences: string[]): VocabularyReport {
  const counts = new Map<string, { count: number; levels: DictLevel[] }>();
  let tokens = 0;

  for (const sentence of sentences) {
    for (const raw of sentence.toLowerCase().match(/[a-z']+/g) ?? []) {
      if (isFunctionWord(raw)) continue;
      if (raw.length <= 2) continue;

      tokens += 1;

      // 词形还原后再计数：suggested 和 suggest 算同一个词
      const resolved = resolveWord(raw);
      const key = resolved?.entry.word ?? raw;
      const levels = resolved?.entry.levels ?? [];

      const current = counts.get(key);
      if (current) current.count += 1;
      else counts.set(key, { count: 1, levels });
    }
  }

  const usage: WordUsage[] = [...counts.entries()]
    .map(([word, value]) => ({ word, count: value.count, levels: value.levels }))
    .sort((a, b) => b.count - a.count);

  const unique = usage.length;

  // Chao1：用「只出现一次」和「出现两次」的词频估计还有多少词没见过
  let f1 = 0;
  let f2 = 0;
  for (const item of usage) {
    if (item.count === 1) f1 += 1;
    else if (item.count === 2) f2 += 1;
  }
  // Chao1：用「只出现一次」和「出现两次」的词频估计还有多少词没见过。
  // 它是生态学算法，极度依赖样本量：样本里 singleton 太多时会疯狂外推，
  // 所以样本不足时不给数字（estimatedSize = null），足够时也加一个上限。
  const singletonRatio = unique > 0 ? f1 / unique : 1;
  const confident = tokens >= 50 && unique >= 30 && singletonRatio <= 0.8;
  const rawEstimate =
    f2 > 0 ? unique + (f1 * f1) / (2 * f2) : unique + (f1 * (f1 - 1)) / 2;
  // 上限：最多估算为观测词数的 2.5 倍，避免「21 个词估出 231」这种离谱数字
  const estimatedSize = confident ? Math.round(Math.min(rawEstimate, unique * 2.5)) : null;

  // 按词库等级分档：一个词若被多本词库收录，按最低等级算
  const rankCounts = new Map<number, number>();
  let outsideCount = 0;

  for (const item of usage) {
    const ranks = item.levels
      .map((level) => getBookRank(level))
      .filter((rank) => rank >= 0);

    if (ranks.length === 0) {
      outsideCount += 1;
      continue;
    }

    const lowest = Math.min(...ranks);
    rankCounts.set(lowest, (rankCounts.get(lowest) ?? 0) + 1);
  }

  const tiers: TierShare[] = TIERS.map((tier) => ({
    rank: tier.rank,
    label: tier.label,
    percent: pct(rankCounts.get(tier.rank) ?? 0, unique),
    count: rankCounts.get(tier.rank) ?? 0,
  }));

  // 覆盖率和「未用过的词」按当前已安装的词库逐个算
  const installed = getInstalledLevels();
  const usedByLevel: Record<string, Set<string>> = {};
  for (const level of installed) usedByLevel[level] = new Set();

  for (const item of usage) {
    for (const level of item.levels) usedByLevel[level]?.add(item.word);
  }

  const coverage: Record<string, number> = {};
  const unused: Record<string, string[]> = {};

  for (const level of installed) {
    const all = getWordsByLevel(level);
    // 覆盖率保留一位小数：几百个词库里用过的词往往不到 1%
    coverage[level] = Math.round((usedByLevel[level].size / all.length) * 1000) / 10;

    const missing: string[] = [];
    for (const word of all) {
      if (missing.length >= 800) break;
      if (!usedByLevel[level].has(word)) missing.push(word);
    }
    unused[level] = missing;
  }

  return {
    tokens,
    unique,
    estimatedSize,
    estimateConfident: confident,
    tiers,
    outside: { count: outsideCount, percent: pct(outsideCount, unique) },
    usage,
    coverage,
    unused,
  };
}

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}
