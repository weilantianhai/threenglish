// lib/dictionary.ts
// 离线词库：内存索引 + 可替换的词库槽位。
//
// 内置三套：初中基础、高中基础（book-json-simple 轻量版）、CET-4（含例句/搭配）。
// 其余词库由 lib/dictRuntime.ts 在「词库管理」页按需下载，下载不会覆盖内置的基础词。
// 所有查询接口保持同步，页面不用等 Promise。

import builtinJson from "./dict_builtin.json";
import juniorJson from "./dict_junior.json";
import seniorJson from "./dict_senior.json";
import { getBookRank } from "./dictCatalog";
import { lemmaCandidates } from "./lemma";
import { nlpLemmas } from "./nlp";

/** 词库 id：cet4 / cet6 / kaoyan / level4 / level8 …（见 lib/dictCatalog.ts） */
export type DictLevel = string;

/** 词库来源：内置兜底 / 用户下载 / 未安装 */
export type DictSource = "builtin" | "downloaded" | "none";

export interface DictExample {
  en: string;
  zh: string;
}

export interface DictPhrase {
  en: string;
  zh: string;
}

export interface DictEntry {
  word: string;
  translation: string;
  phonetic?: string;
  examples?: DictExample[];
  /** 常用搭配，例如 drug abuse / 药物滥用 */
  phrases?: DictPhrase[];
  /** 词形变化：过去式 / 复数 / 比较级等（full 词库才有） */
  forms?: string[];
  /** 真题例句（full 词库才有） */
  examSentences?: DictExample[];
  levels: DictLevel[];
}

/** 兼容 KyleBing/dict 等开源词库的原始字段命名 */
interface RawDictEntry {
  name?: string;
  word?: string;
  trans?: string | string[];
  translation?: string;
  /** book-json-simple 的格式：[{ translation, type }] */
  translations?: Array<{ translation?: string; type?: string }>;
  usphone?: string;
  us?: string;
  ukphone?: string;
  uk?: string;
  phonetic?: string;
  ex?: Array<{ en?: string; sentence?: string; zh?: string; translation?: string }>;
  sentences?: Array<{ en?: string; sentence?: string; zh?: string; translation?: string }>;
  /** 词组搭配，内置词库里存成短键 ph */
  phrases?: Array<{ phrase?: string; en?: string; translation?: string; zh?: string }>;
  ph?: Array<{ phrase?: string; en?: string; translation?: string; zh?: string }>;
}

function normalizeWord(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().toLowerCase();
}

/** 数据源可能是数组、JSONL（book-json-full 按行存放）或单个对象 */
function parseItems(rawModule: unknown): Array<Record<string, unknown>> {
  let list: unknown[] = [];

  if (Array.isArray(rawModule)) {
    list = rawModule;
  } else if (typeof rawModule === "string") {
    const text = rawModule.trim();

    // book-json-simple / book-json-sentence 是整段 JSON 数组
    if (text.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(text);
        if (Array.isArray(parsed)) list = parsed;
      } catch {
        // 解析失败就退回按行解析
      }
    }

    // book-json-full 是 JSONL，每行一个词条
    if (list.length === 0) {
      for (const line of text.split("\n")) {
        const row = line.trim();
        if (!row) continue;
        try {
          list.push(JSON.parse(row));
        } catch {
          // 坏行直接跳过，不影响其他词条
        }
      }
    }
  } else if (rawModule && typeof rawModule === "object") {
    list = [rawModule];
  }

  return list.filter(
    (item): item is Record<string, unknown> => typeof item === "object" && item !== null,
  );
}

/** 取出真正的词条内容：book-json-full 是 content.word.content 的嵌套结构 */
function unwrapWord(item: Record<string, unknown>): Record<string, unknown> {
  const content = item.content;
  if (content && typeof content === "object") {
    const wordNode = (content as Record<string, unknown>).word;
    if (wordNode && typeof wordNode === "object") {
      const inner = (wordNode as Record<string, unknown>).content;
      if (inner && typeof inner === "object") return inner as Record<string, unknown>;
    }
    return content as Record<string, unknown>;
  }
  return item;
}

function pickWord(item: Record<string, unknown>) {
  return normalizeWord(item.headWord ?? item.wordHead ?? item.name ?? item.word);
}

function pickTranslation(item: Record<string, unknown>, inner: Record<string, unknown>): string {
  // 1) book-json-full：trans: [{ tranCn, pos }]
  const fullTrans = inner.trans;
  if (Array.isArray(fullTrans)) {
    const text = fullTrans
      .map((entry) => {
        const row = entry as Record<string, unknown>;
        const cn = String(row.tranCn ?? row.translation ?? "").trim();
        const pos = String(row.pos ?? row.type ?? "").trim();
        if (!cn) return "";
        return pos ? `${pos}. ${cn}` : cn;
      })
      .filter(Boolean)
      .join("；");
    if (text) return text;
  }

  // 2) book-json-simple：translations: [{ translation, type }]
  const translations = item.translations ?? inner.translations;
  if (Array.isArray(translations)) {
    const text = translations
      .map((entry) => {
        const row = entry as Record<string, unknown>;
        const cn = String(row.translation ?? "").trim();
        const type = String(row.type ?? "").trim();
        if (!cn) return "";
        return type ? `${type}. ${cn}` : cn;
      })
      .filter(Boolean)
      .join("；");
    if (text) return text;
  }

  // 3) 内置词库：trans: string[]
  const value = item.trans ?? item.translation ?? inner.translation;
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean).join("；");
  }
  if (typeof value === "string") return value.trim();
  return "";
}

function pickPhonetic(item: Record<string, unknown>, inner: Record<string, unknown>) {
  const value = inner.usphone ?? inner.ukphone ?? item.usphone ?? item.us ?? item.phonetic;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? `/${trimmed.replace(/^\/|\/$/g, "")}/` : undefined;
}

function pickExamples(item: Record<string, unknown>, inner: Record<string, unknown>) {
  const full = inner.sentence as { sentences?: unknown[] } | undefined;
  const list = Array.isArray(full?.sentences)
    ? full?.sentences
    : (inner.ex ?? item.ex ?? item.sentences);

  if (!Array.isArray(list)) return undefined;

  const examples: DictExample[] = [];
  for (const entry of list) {
    const row = entry as Record<string, unknown>;
    const en = String(row.sContent ?? row.en ?? row.sentence ?? "").trim();
    if (!en) continue;
    examples.push({ en, zh: String(row.sCn ?? row.zh ?? row.translation ?? "").trim() });
    if (examples.length >= 2) break;
  }
  return examples.length > 0 ? examples : undefined;
}

function pickPhrases(item: Record<string, unknown>, inner: Record<string, unknown>) {
  const full = inner.phrase as { phrases?: unknown[] } | undefined;
  const list = Array.isArray(full?.phrases)
    ? full?.phrases
    : (inner.ph ?? item.ph ?? item.phrases);

  if (!Array.isArray(list)) return undefined;

  const phrases: DictPhrase[] = [];
  for (const entry of list) {
    const row = entry as Record<string, unknown>;
    const en = String(row.pContent ?? row.en ?? row.phrase ?? "").trim();
    if (!en) continue;
    phrases.push({ en, zh: String(row.pCn ?? row.zh ?? row.translation ?? "").trim() });
    if (phrases.length >= 6) break;
  }
  return phrases.length > 0 ? phrases : undefined;
}

/** 真题例句：full 词库里的 realExamSentence */
function pickExamSentences(inner: Record<string, unknown>) {
  const full = inner.realExamSentence as { sentences?: unknown[] } | undefined;
  const list = full?.sentences;
  if (!Array.isArray(list)) return undefined;

  const out: DictExample[] = [];
  for (const entry of list) {
    const row = entry as Record<string, unknown>;
    const en = String(row.sContent ?? "").trim();
    if (!en) continue;
    const zh = String(row.sCn ?? "").trim();
    out.push({ en, zh });
    if (out.length >= 2) break;
  }
  return out.length > 0 ? out : undefined;
}

/** 词形变化：full 词库里的 relWord（过去式、复数、比较级等） */
function pickForms(inner: Record<string, unknown>) {
  const rel = inner.relWord as { relWords?: unknown[] } | undefined;
  const list = rel?.relWords;
  if (!Array.isArray(list)) return undefined;

  const forms: string[] = [];
  for (const entry of list) {
    const row = entry as Record<string, unknown>;
    const words = row.words;
    if (!Array.isArray(words)) continue;
    for (const w of words) {
      const value = String((w as Record<string, unknown>)?.w ?? "").trim();
      if (value && !forms.includes(value)) forms.push(value);
    }
    if (forms.length >= 8) break;
  }
  return forms.length > 0 ? forms : undefined;
}

/**
 * 归一化任意开源词库导出，兼容三种形态：
 *   book-json-full      每行一个 { headWord, content.word.content:{ trans, sentence, phrase } }
 *   book-json-sentence  [{ word, us, translations, phrases, sentences }]
 *   内置词库            { name, trans: string[], usphone }
 */
export function normalizeDictEntries(rawModule: unknown, level: DictLevel): DictEntry[] {
  const out: DictEntry[] = [];
  const seen = new Set<string>();

  for (const item of parseItems(rawModule)) {
    const word = pickWord(item);
    if (!word || seen.has(word)) continue;

    const inner = unwrapWord(item);
    const translation = pickTranslation(item, inner);
    if (!translation) continue;

    seen.add(word);
    out.push({
      word,
      translation,
      phonetic: pickPhonetic(item, inner),
      examples: pickExamples(item, inner),
      phrases: pickPhrases(item, inner),
      forms: pickForms(inner),
      examSentences: pickExamSentences(inner),
      levels: [level],
    });
  }

  return out;
}

// ---------- 运行时状态 ----------
// 每个词库 id 一个槽位（cet4 / cet6 / kaoyan / level4 / level8 …），
// CET-4 内置，其余由用户在「词库管理」里下载后填充。

const slots = new Map<string, DictEntry[]>();
const sources = new Map<string, DictSource>();
const updatedAt = new Map<string, number | null>();

/** 内置词库：随包提供，删除时回滚到这份 */
const BUILTINS: Array<{ id: string; data: unknown }> = [
  { id: "cet4", data: builtinJson },
  { id: "base-junior", data: juniorJson },
  { id: "base-senior", data: seniorJson },
];

for (const builtin of BUILTINS) {
  slots.set(builtin.id, normalizeDictEntries(builtin.data, builtin.id));
  sources.set(builtin.id, "builtin");
  updatedAt.set(builtin.id, null);
}

let index = new Map<string, DictEntry>();

function rebuild(): void {
  const next = new Map<string, DictEntry>();

  for (const [level, entries] of slots) {
    for (const entry of entries) {
      const existing = next.get(entry.word);
      if (existing) {
        if (!existing.levels.includes(level)) existing.levels.push(level);
        if (!existing.translation) existing.translation = entry.translation;
        if (!existing.phonetic) existing.phonetic = entry.phonetic;
        if (!existing.examples) existing.examples = entry.examples;
        if (!existing.phrases) existing.phrases = entry.phrases;
        if (!existing.forms) existing.forms = entry.forms;
        if (!existing.examSentences) existing.examSentences = entry.examSentences;
      } else {
        next.set(entry.word, { ...entry, levels: [...entry.levels] });
      }
    }
  }

  index = next;
}

rebuild();

/** 当前生效的词库索引（只读） */
export function getDictionary(): Map<string, DictEntry> {
  return index;
}

/** 替换某个词库（下载完成后调用） */
export function replaceLevel(level: DictLevel, entries: DictEntry[], source: DictSource): void {
  slots.set(level, entries);
  sources.set(level, source);
  updatedAt.set(level, source === "downloaded" ? Date.now() : null);
  rebuild();
}

/** 恢复内置状态：内置词库回到打包版本，下载的删除 */
export function resetLevel(level: DictLevel): void {
  const builtin = BUILTINS.find((item) => item.id === level);

  if (builtin) {
    slots.set(level, normalizeDictEntries(builtin.data, level));
    sources.set(level, "builtin");
    updatedAt.set(level, null);
  } else {
    slots.delete(level);
    sources.delete(level);
    updatedAt.delete(level);
  }
  rebuild();
}

export interface DictLevelMeta {
  count: number;
  source: DictSource;
  updatedAt: number | null;
}

/** 每个已安装词库的元信息（未下载的词库不在里面） */
export function getDictionaryMeta(): Record<string, DictLevelMeta> {
  const meta: Record<string, DictLevelMeta> = {};
  for (const [level, entries] of slots) {
    meta[level] = {
      count: entries.length,
      source: sources.get(level) ?? "none",
      updatedAt: updatedAt.get(level) ?? null,
    };
  }
  return meta;
}

/** 已安装的词库 id（按等级排序，基础词在前，CET-4 随后） */
export function getInstalledLevels(): string[] {
  const installed = [...slots.keys()];
  return installed.sort((a, b) => {
    const pa = getBookRank(a);
    const pb = getBookRank(b);
    return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb);
  });
}

// ---------- 查询接口 ----------

/** 查词：大小写不敏感，只做精确匹配 */
export function lookupWord(word: string): DictEntry | null {
  const key = normalizeWord(word);
  if (!key) return null;
  return index.get(key) ?? null;
}

export interface WordResolution {
  entry: DictEntry;
  query: string;
  matchedWord: string;
}

/** 带词形还原的查词：abandoned → abandon、went → go */
export function resolveWord(word: string): WordResolution | null {
  const query = normalizeWord(word);
  if (!query) return null;

  const exact = index.get(query);
  if (exact) return { entry: exact, query, matchedWord: query };

  for (const candidate of lemmaCandidates(query)) {
    const entry = index.get(candidate);
    if (entry) return { entry, query, matchedWord: candidate };
  }

  // 规则表没覆盖的屈折形式，交给 compromise 还原（children → child、better → good 等）
  for (const candidate of nlpLemmas(query)) {
    const entry = index.get(candidate);
    if (entry) return { entry, query, matchedWord: candidate };
  }

  return null;
}

/** 按词库取全部单词，用于统计和随机抽词 */
export function getWordsByLevel(level: DictLevel): string[] {
  const words: string[] = [];
  index.forEach((entry) => {
    if (entry.levels.includes(level)) words.push(entry.word);
  });
  return words;
}

/** 词库规模统计：每个已安装词库的词数 */
export function getDictionaryStats(): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const [level, entries] of slots) stats[level] = entries.length;
  return stats;
}

// 词库为空只可能是内置数据坏了
if (index.size === 0) {
  console.error("[dictionary] 词库为空：检查 lib/dict_builtin.json。");
}
