// lib/words.ts
// 抽词层：把「当前词库」映射到「具体单词」。

import { getWordsByLevel, type DictLevel } from "./dictionary";

/** daily 表示日常模式，其余是词库 id（cet4 / cet6 / kaoyan / level4 / level8） */
export type WordLevel = "daily" | string;

/**
 * 日常模式不限定词库，用一组生活场景高频词作为「轻提示」，
 * 避免日常对话被考试词汇绑架。
 */
const DAILY_WORDS: string[] = [
  "morning", "coffee", "desk", "window", "weather", "rain", "sunny", "cloud",
  "phone", "screen", "chair", "lamp", "kitchen", "breakfast", "noodle", "fruit",
  "street", "crowded", "quiet", "busy", "tired", "relax", "weekend", "hobby",
  "music", "movie", "friend", "family", "neighbor", "shopping", "market", "wallet",
  "traffic", "subway", "office", "meeting", "project", "deadline", "schedule", "commute",
  "grocery", "laundry", "balcony", "plant", "blanket", "pillow", "alarm", "nap",
];

function shuffle<T>(items: readonly T[]): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * 从词池中随机抽取 count 个不重复单词。
 * 词池不足时会循环补足，保证调用方拿到的数量稳定（例如始终 4 个）。
 */
function sampleWords(pool: readonly string[], count: number): string[] {
  if (count <= 0 || pool.length === 0) return [];

  const picked: string[] = [];
  const seen = new Set<string>();

  while (picked.length < count) {
    const round = shuffle(pool);
    for (const word of round) {
      if (picked.length >= count) break;
      if (seen.has(word)) continue;
      seen.add(word);
      picked.push(word);
    }
    // 词池本身比 count 小：第二轮开始允许复用已有单词
    if (seen.size >= pool.length && picked.length < count) {
      for (const word of shuffle(pool)) {
        if (picked.length >= count) break;
        picked.push(word);
      }
    }
  }

  return picked.slice(0, count);
}

/**
 * 按等级随机抽词。
 * - daily：生活场景高频词
 * - cet4 / cet6：分别从对应离线词库中抽取
 */
export function getRandomWords(level: WordLevel, count: number): string[] {
  if (count <= 0) return [];

  if (level === "daily") {
    return sampleWords(DAILY_WORDS, count);
  }

  const pool = getWordsByLevel(level as DictLevel);
  return sampleWords(pool, count);
}

export { DAILY_WORDS };
