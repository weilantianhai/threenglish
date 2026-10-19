// lib/dictionaryTools.ts
// 把本地词库暴露成模型可调用的工具：英文查词 + 中文反查。
// 全部在内存里完成（词库已打进 bundle），不发任何网络请求。

import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { getWordsByLevel, lookupWord, resolveWord, type DictLevel } from "./dictionary";
import { pickStructures } from "./structures";
import type { VocabularyReport } from "./wordStats";

/** 每次请求给模型配的工具定义 */
export const DICTIONARY_TOOLS: ChatCompletionTool[] = [
  {
    type: "function" as const,
    function: {
      name: "lookup_word",
      description:
        "在离线 CET 词库里查一个英文单词。会自动还原时态/单复数（abandoned→abandon）。返回是否收录、属于 CET-4/CET-6、中文释义。",
      parameters: {
        type: "object",
        properties: {
          word: { type: "string", description: "要查的英文单词，可以是变形" },
        },
        required: ["word"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_meaning",
      description:
        "用中文意思反查英文词。返回当前词库里释义包含该中文的单词列表，用于「想不起英文怎么说」时找词。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "中文关键词，例如「放弃」「犹豫」" },
          limit: { type: "number", description: "返回条数，1~8，默认 5" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "practice_words",
      description:
        "取用户还没用过、或练得最少的词（来自当前词库）。想给他补词汇缺口时调用，返回词 + 中文释义。",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "返回几个词，1~5，默认 3" },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "structure_hint",
      description:
        "从内置句式库里取 1~3 个「本轮可以教的新结构」，带骨架和例句。想给句子加新结构时调用。",
      parameters: {
        type: "object",
        properties: {
          max_level: { type: "number", description: "允许的最高难度 1~5，默认 3" },
          limit: { type: "number", description: "返回几个，1~3，默认 2" },
        },
        required: [],
      },
    },
  },
];

export interface ToolBudget {
  /** 当前等级，决定查哪个词库 */
  level: DictLevel;
  /** 每个词查失败的次数 */
  failures: Map<string, number>;
  /** 已经调用了几次工具 */
  calls: number;
  maxCalls: number;
  /** 同一个词失败多少次就强制放弃 */
  maxFailures: number;
  /** 词汇统计报告，practice_words 用 */
  report?: VocabularyReport;
}

export function createToolBudget(level: DictLevel, report?: VocabularyReport): ToolBudget {
  return { level, failures: new Map(), calls: 0, maxCalls: 10, maxFailures: 2, report };
}

// 词库是静态的，按等级缓存一份单词表，避免每次查词都遍历整张 Map
const levelWords = new Map<DictLevel, string[]>();
function wordsOf(level: DictLevel): string[] {
  let list = levelWords.get(level);
  if (!list) {
    list = getWordsByLevel(level);
    levelWords.set(level, list);
  }
  return list;
}

function suggestionsFor(word: string, level: DictLevel, limit = 4): string[] {
  const prefix = word.toLowerCase().slice(0, 4);
  if (prefix.length < 2) return [];

  const out: string[] = [];
  for (const candidate of wordsOf(level)) {
    if (candidate !== word && candidate.startsWith(prefix)) out.push(candidate);
    if (out.length >= limit) break;
  }
  return out;
}

function lookupDetail(word: string, level: DictLevel): string {
  const resolution = resolveWord(word);
  if (!resolution) return "";

  return JSON.stringify({
    found: true,
    query: word,
    word: resolution.entry.word,
    restoredFrom: resolution.matchedWord !== resolution.query ? resolution.query : undefined,
    inLevel: resolution.entry.levels.includes(level),
    levels: resolution.entry.levels,
    translation: resolution.entry.translation,
  });
}

function searchMeaning(query: string, level: DictLevel, limit: number): string {
  const matches: Array<{ word: string; translation: string; levels: DictLevel[] }> = [];

  for (const word of wordsOf(level)) {
    const entry = lookupWord(word);
    if (entry && entry.translation.includes(query)) {
      matches.push({ word: entry.word, translation: entry.translation, levels: entry.levels });
      if (matches.length >= limit) break;
    }
  }

  return JSON.stringify({
    query,
    found: matches.length,
    matches,
    hint: matches.length === 0 ? "没有匹配的中文，换一个关键词试试" : undefined,
  });
}

/**
 * 执行一次工具调用，返回给模型的 tool 消息内容（JSON 字符串）。
 * 预算控制都在这里：总调用次数上限 + 单词失败次数上限。
 */
export function executeDictionaryTool(
  name: string,
  rawArguments: string,
  budget: ToolBudget,
): string {
  if (budget.calls >= budget.maxCalls) {
    return JSON.stringify({
      error: "工具调用已达上限，请立即基于已有信息输出最终 JSON，不要再调用工具。",
    });
  }
  budget.calls += 1;

  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(rawArguments || "{}") as Record<string, unknown>;
  } catch {
    return JSON.stringify({ error: "参数不是合法 JSON" });
  }

  if (name === "lookup_word") {
    const word = String(args.word ?? "").trim();
    if (!word) return JSON.stringify({ error: "word 不能为空" });

    const key = word.toLowerCase();
    const failed = budget.failures.get(key) ?? 0;

    // 同一个词连续查不到就别再试了，直接让模型放弃
    if (failed >= budget.maxFailures) {
      return JSON.stringify({
        found: false,
        stop: true,
        word,
        message: `「${word}」已查询 ${failed} 次仍未收录，请立刻放弃这个词，改用更简单的表达，不要再查它。`,
      });
    }

    const hit = lookupDetail(word, budget.level);
    if (hit) return hit;

    budget.failures.set(key, failed + 1);
    return JSON.stringify({
      found: false,
      word,
      suggestions: suggestionsFor(word, budget.level),
      message: "词库未收录。可以换一个词，或直接放弃这个词。",
    });
  }

  if (name === "search_meaning") {
    const query = String(args.query ?? "").trim();
    if (!query) return JSON.stringify({ error: "query 不能为空" });

    const limit = Math.min(8, Math.max(1, Number(args.limit) || 5));
    return searchMeaning(query, budget.level, limit);
  }

  if (name === "practice_words") {
    const limit = Math.min(5, Math.max(1, Number(args.limit) || 3));
    const pool = budget.report?.unused[budget.level] ?? [];

    if (pool.length === 0) {
      return JSON.stringify({
        words: [],
        message: "这个用户的词库覆盖已经很好，或还没有统计数据；直接按画像出题即可。",
      });
    }

    const picked: Array<{ word: string; translation: string }> = [];
    for (const word of [...pool].sort(() => Math.random() - 0.5).slice(0, limit)) {
      picked.push({ word, translation: lookupWord(word)?.translation ?? "" });
    }

    return JSON.stringify({
      words: picked,
      note: "这些是用户还没主动用过的词，最多挑 1~2 个自然用进句子，不要硬塞。",
    });
  }

  if (name === "structure_hint") {
    const maxLevel = Math.min(5, Math.max(1, Number(args.max_level) || 3));
    const limit = Math.min(3, Math.max(1, Number(args.limit) || 2));
    return JSON.stringify({
      structures: pickStructures(maxLevel, limit),
      note: "挑 1 个用进句子，并在 anchorAnalysis 里点明结构名称。",
    });
  }

  return JSON.stringify({ error: `未知工具：${name}` });
}
