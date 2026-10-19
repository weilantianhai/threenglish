// lib/aiLookup.ts
// 词库未收录时的 AI 兜底查词：请求 DeepSeek 返回结构化 JSON，塞进同一张词卡。
// 纯前端调用（dangerouslyAllowBrowser），结果按单词缓存在 localStorage，避免重复花 token。

import OpenAI from "openai";

export interface AiWordInfo {
  word: string;
  phonetic?: string;
  meanings: { pos: string; cn: string }[];
  forms: { label: string; value: string }[];
  examples: { en: string; zh: string }[];
  /** 常用搭配（新增） */
  phrases?: { en: string; zh: string }[];
  /** 近义词（新增） */
  synonyms?: string[];
}

const ENABLED_KEY = "ai_lookup_enabled";
const CACHE_KEY = "ai_word_cache_v2";
const CACHE_LIMIT = 200;

const SYSTEM_PROMPT = `你是词典编辑。用户给你一个英文单词（可能是生僻词、专有名词或拼写变体），
输出严格 JSON，不要 markdown 代码块，不要多余文字：
{
  "word": "该词最标准的写法（小写）",
  "phonetic": "/音标/",
  "meanings": [{ "pos": "n.", "cn": "中文释义" }],
  "forms": [{ "label": "过去式", "value": "词形" }],
  "phrases": [{ "en": "常见搭配", "zh": "中文" }],
  "synonyms": ["近义词"],
  "examples": [{ "en": "英文例句", "zh": "中文翻译" }]
}
要求：
1. meanings 1~4 条，按常用度排序，pos 用 v./n./adj./adv./prep. 这类缩写。
2. forms 列时态、单复数、比较级等屈折变化，0~6 条，没有就给空数组。
3. phrases 给 2~5 条真实高频搭配（如 drug abuse / 药物滥用），不要编造短语。
4. synonyms 给 1~4 个近义词，没有就给空数组。
5. examples 1~2 条，句子要短、自然、能体现该词典型用法。
6. 如果这根本不是英文单词，meanings 返回空数组，其他字段给空。`;

export function isAiLookupEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(ENABLED_KEY) !== "0";
}

export function setAiLookupEnabled(enabled: boolean): void {
  window.localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
}

export function getApiKey(): string | null {
  if (typeof window === "undefined") return null;
  const key = window.localStorage.getItem("deepseek_api_key");
  return key && key.trim() ? key.trim() : null;
}

function readCache(): Record<string, AiWordInfo> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, AiWordInfo>) : {};
  } catch {
    return {};
  }
}

function writeCache(word: string, info: AiWordInfo): void {
  try {
    const cache = readCache();
    cache[word] = info;
    const keys = Object.keys(cache);
    // 超出上限就丢掉最早写入的一批
    if (keys.length > CACHE_LIMIT) {
      for (const key of keys.slice(0, keys.length - CACHE_LIMIT)) delete cache[key];
    }
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // 缓存失败不影响主流程（比如 localStorage 满了）
  }
}

function asString(value: unknown, maxLength = 300): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function sanitize(raw: Record<string, unknown>, fallbackWord: string): AiWordInfo {
  const meanings = Array.isArray(raw.meanings)
    ? raw.meanings
        .map((item) => {
          const entry = item as Record<string, unknown>;
          return { pos: asString(entry?.pos, 12), cn: asString(entry?.cn, 120) };
        })
        .filter((item) => item.cn)
        .slice(0, 3)
    : [];

  const forms = Array.isArray(raw.forms)
    ? raw.forms
        .map((item) => {
          const entry = item as Record<string, unknown>;
          return { label: asString(entry?.label, 20), value: asString(entry?.value, 40) };
        })
        .filter((item) => item.label && item.value)
        .slice(0, 6)
    : [];

  const examples = Array.isArray(raw.examples)
    ? raw.examples
        .map((item) => {
          const entry = item as Record<string, unknown>;
          return { en: asString(entry?.en, 240), zh: asString(entry?.zh, 240) };
        })
        .filter((item) => item.en)
        .slice(0, 2)
    : [];

  const phrases = Array.isArray(raw.phrases)
    ? raw.phrases
        .map((item) => {
          const entry = item as Record<string, unknown>;
          return { en: asString(entry?.en, 60), zh: asString(entry?.zh, 120) };
        })
        .filter((item) => item.en)
        .slice(0, 5)
    : [];

  const synonyms = Array.isArray(raw.synonyms)
    ? raw.synonyms
        .map((item) => asString(item, 40))
        .filter(Boolean)
        .slice(0, 4)
    : [];

  return {
    word: asString(raw.word, 40).toLowerCase() || fallbackWord,
    phonetic: asString(raw.phonetic, 40) || undefined,
    meanings,
    forms,
    examples,
    phrases: phrases.length > 0 ? phrases : undefined,
    synonyms: synonyms.length > 0 ? synonyms : undefined,
  };
}

/** 查 AI 词典；优先读缓存 */
export async function fetchAiWord(word: string): Promise<AiWordInfo> {
  const key = word.trim().toLowerCase();
  const cached = readCache()[key];
  if (cached) return cached;

  const apiKey = getApiKey();
  if (!apiKey) throw new Error("缺少 API Key");

  const openai = new OpenAI({
    apiKey,
    baseURL: "https://api.deepseek.com",
    dangerouslyAllowBrowser: true,
  });

  const response = await openai.chat.completions.create({
    model: "deepseek-chat",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: key },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

  const content = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content) as Record<string, unknown>;
  const info = sanitize(parsed, key);

  if (info.meanings.length > 0) writeCache(key, info);
  return info;
}
