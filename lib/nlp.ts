// lib/nlp.ts
// 用 compromise 做词形还原和动词变形判断，补上正则处理不了的屈折形式。
// compromise 只做规则/词典匹配，纯本地、同步执行，不会发网络请求。

import nlp from "compromise";

/** 缓存：同一个词在一轮统计里会被查很多次 */
const lemmaCache = new Map<string, string[]>();
const participleCache = new Map<string, boolean>();

/**
 * 用 NLP 库还原本形：went → go、children → child、better → good。
 * 返回候选原形（不含原词本身）。
 */
export function nlpLemmas(word: string): string[] {
  const key = word.toLowerCase();
  const cached = lemmaCache.get(key);
  if (cached) return cached;

  const out: string[] = [];

  try {
    const verb = nlp(key).verbs().toInfinitive().out("text").trim().toLowerCase();
    if (verb && verb !== key && /^[a-z]+$/.test(verb)) out.push(verb);
  } catch {
    // 忽略单词语法解析失败
  }

  try {
    const noun = nlp(key).nouns().toSingular().out("text").trim().toLowerCase();
    if (noun && noun !== key && /^[a-z]+$/.test(noun) && !out.includes(noun)) out.push(noun);
  } catch {
    // 忽略
  }

  lemmaCache.set(key, out);
  return out;
}

/**
 * 判断一个词是否是过去分词（were made / was built / has broken）。
 * 只在前一个词是 be 动词时调用，避免把一般过去时误判成被动。
 */
export function isPastParticiple(word: string): boolean {
  const key = word.toLowerCase();
  const cached = participleCache.get(key);
  if (cached !== undefined) return cached;

  let result = false;

  try {
    const conjugation = nlp(key).verbs().conjugate()[0] as Record<string, string> | undefined;
    const past = conjugation?.PastTense?.toLowerCase();
    const infinitive = conjugation?.Infinitive?.toLowerCase();
    result = Boolean(past && infinitive && past === key && infinitive !== key);
  } catch {
    result = false;
  }

  participleCache.set(key, result);
  return result;
}

/** 规则形式的过去分词（-ed / -en），不走 NLP，快 */
export function looksLikeParticiple(word: string): boolean {
  return /(?:ed|en)$/.test(word) && word.length > 3;
}

const npCache = new Map<string, number>();

/**
 * 一句里最长的名词短语有几个词。
 * compromise 的 nouns() 做浅层 chunk，够用来识别「多层修饰的 NP」；
 * 比正则多看一层短语结构，但达不到依存句法的精度。
 */
export function maxNounPhraseLength(sentence: string): number {
  const key = sentence.slice(0, 120);
  const cached = npCache.get(key);
  if (cached !== undefined) return cached;

  let max = 0;

  try {
    const phrases = nlp(sentence).nouns().out("array") as string[];
    for (const phrase of phrases) {
      const length = phrase.trim().split(/\s+/).filter(Boolean).length;
      if (length > max) max = length;
    }
  } catch {
    max = 0;
  }

  npCache.set(key, max);
  return max;
}
