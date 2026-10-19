// scripts/build-dict.mjs
// 生成 lib/dict_cet4.json 与 lib/dict_cet6.json。
//
// 输入来源（按优先级）：
//   1) cet/ 目录下的分卷 —— KyleBing/dict 的 book-json-simple 导出，CET4_1.json… 自动按前缀合并
//   2) --examples —— 从 book-json-sentence 拉取（含音标 + 例句），词卡更完整，但体积更大
//   3) --download  —— 从 needed/ 拉取（只有释义）
//   4) lib/raw_cet4.json / lib/raw_cet6.json —— 手工放进去的原始导出
//
// 用法：
//   node scripts/build-dict.mjs              # 本地 cet/ 分卷，只有释义
//   node scripts/build-dict.mjs --examples   # 联网，带音标 + 例句（npm run build:dict:full）
//
// 输出结构：[{ name, trans: string[], usphone, ex?: [{ en, zh }] }]
// 例句只保留每个词的前 2 条，其余（phrases、近义词等）全部丢弃。

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const LIB = join(ROOT, "lib");
const CET_DIR = join(ROOT, "cet");
const WANT_EXAMPLES = process.argv.includes("--examples");
const WANT_DOWNLOAD = process.argv.includes("--download");

const REPO = "https://raw.githubusercontent.com/KyleBing/dict/master";

/** 只有释义的考纲词表 */
const SOURCES = {
  cet4: [`${REPO}/needed/CET4.json`],
  cet6: [`${REPO}/needed/CET6.json`],
};

/** 含音标与例句的分卷 */
const SENTENCE_SOURCES = {
  cet4: [1, 2, 3].map((i) => `${REPO}/book-json-sentence/CET4_${i}.json`),
  cet6: [1, 2, 3].map((i) => `${REPO}/book-json-sentence/CET6_${i}.json`),
};

/** 每个词最多保留几条例句 */
const MAX_EXAMPLES = 2;
/** 每个词最多保留几条词组搭配 */
const MAX_PHRASES = 6;

function pickPhonetic(item) {
  const raw = item.usphone ?? item.us ?? item.ukphone ?? item.uk ?? item.phonetic ?? "";
  const value = String(raw).trim();
  if (!value) return "";
  const bare = value.replace(/^\/|\/$/g, "");
  return bare ? `/${bare}/` : "";
}

function pickExamples(item) {
  const list = Array.isArray(item.sentences) ? item.sentences : [];
  const out = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const en = String(entry.sentence ?? entry.en ?? "").trim();
    const zh = String(entry.translation ?? entry.zh ?? "").trim();
    if (!en) continue;
    out.push({ en, zh });
    if (out.length >= MAX_EXAMPLES) break;
  }
  return out;
}

/** 词组搭配：{ phrase, translation } */
function pickPhrases(item) {
  const list = Array.isArray(item.phrases) ? item.phrases : [];
  const out = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const en = String(entry.phrase ?? entry.en ?? "").trim();
    const zh = String(entry.translation ?? entry.zh ?? "").trim();
    if (!en) continue;
    out.push({ en, zh });
    if (out.length >= MAX_PHRASES) break;
  }
  return out;
}

/**
 * 归一化开源词库导出，兼容：
 *   { word, us, uk, translations: [{ translation, type }], sentences: [{ sentence, translation }] }
 *   { name, trans: string[] }        ← 旧版导出
 *   { word, translation: "..." }
 */
function normalize(raw) {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.data)
      ? raw.data
      : Array.isArray(raw?.words)
        ? raw.words
        : [];

  const out = [];
  const seen = new Set();

  for (const item of list) {
    if (!item || typeof item !== "object") continue;

    const name = String(item.name ?? item.word ?? "").trim().toLowerCase();
    if (!name || seen.has(name)) continue;

    const rawTrans = item.translations ?? item.trans ?? item.translation;
    const trans = [];

    if (Array.isArray(rawTrans)) {
      for (const entry of rawTrans) {
        if (entry && typeof entry === "object") {
          const cn = String(entry.translation ?? entry.tranCn ?? entry.trans ?? "").trim();
          const type = String(entry.type ?? entry.pos ?? "").trim();
          if (cn) trans.push(type ? `${type}. ${cn}` : cn);
        } else if (entry != null) {
          const cn = String(entry).trim();
          if (cn) trans.push(cn);
        }
      }
    } else if (rawTrans != null) {
      trans.push(
        ...String(rawTrans)
          .split(/[；;]/)
          .map((s) => s.trim())
          .filter(Boolean),
      );
    }

    if (trans.length === 0) continue;

    seen.add(name);
    const entry = { name, trans, usphone: pickPhonetic(item) };
    const examples = pickExamples(item);
    if (examples.length > 0) entry.ex = examples;
    const phrases = pickPhrases(item);
    if (phrases.length > 0) entry.ph = phrases;
    out.push(entry);
  }

  return out;
}

/** 合并 cet/ 下 CET4_*.json / CET6_*.json 分卷 */
function fromCetDir(level) {
  if (!existsSync(CET_DIR)) return null;

  const prefix = `${level.toUpperCase()}_`;
  const files = readdirSync(CET_DIR)
    .filter((file) => file.toUpperCase().startsWith(prefix) && file.toLowerCase().endsWith(".json"))
    .sort();

  if (files.length === 0) return null;

  const seen = new Set();
  const merged = [];

  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(CET_DIR, file), "utf8"));
    for (const entry of normalize(raw)) {
      if (seen.has(entry.name)) continue;
      seen.add(entry.name);
      merged.push(entry);
    }
  }

  console.log(`[${level}] 合并 cet/ 下 ${files.length} 个分卷 → ${merged.length} 词`);
  return merged;
}

function fromRawFile(level) {
  const rawPath = join(LIB, `raw_${level}.json`);
  if (!existsSync(rawPath)) return null;

  const normalized = normalize(JSON.parse(readFileSync(rawPath, "utf8")));
  if (normalized.length === 0) return null;

  console.log(`[${level}] 使用 ${rawPath} → ${normalized.length} 词`);
  return normalized;
}

async function fetchJson(url, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "threenglish-dict-builder" } });
      if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
      return JSON.parse(await res.text());
    } catch (err) {
      lastError = err;
      const wait = attempt * 800;
      console.warn(`[retry ${attempt}/${attempts}] ${url} → ${err.message}，${wait}ms 后重试`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  throw lastError;
}

/** 拉取多个分卷并合并去重 */
async function fromNetwork(level, urls, label) {
  const seen = new Set();
  const merged = [];

  for (const url of urls) {
    const normalized = normalize(await fetchJson(url));
    for (const entry of normalized) {
      if (seen.has(entry.name)) continue;
      seen.add(entry.name);
      merged.push(entry);
    }
  }

  if (merged.length === 0) throw new Error(`${label} 归一化后为空`);
  console.log(`[${level}] ${label} → ${merged.length} 词`);
  return merged;
}

/**
 * 生成内置词库（CET-4 全量，开箱即用）。
 * CET-6 不内置，由 App 在运行时下载安装。
 */
function writeBuiltin(entries) {
  const target = join(LIB, "dict_builtin.json");
  const sample = entries.map((entry) => {
    const row = { name: entry.name, trans: entry.trans, usphone: entry.usphone };
    if (entry.ex?.length) row.ex = entry.ex;
    if (entry.ph?.length) row.ph = entry.ph;
    return row;
  });
  writeFileSync(target, `${JSON.stringify(sample, null, 0)}\n`, "utf8");

  const withExamples = sample.filter((item) => item.ex?.length).length;
  const withPhrases = sample.filter((item) => item.ph?.length).length;
  const withPhonetic = sample.filter((item) => item.usphone).length;
  console.log(
    `[builtin] 已写入 ${target}：${sample.length} 词（音标 ${withPhonetic}，例句 ${withExamples}，词组 ${withPhrases}）`,
  );
}

/** --full 时才写出完整词库，方便本地调试 */
function writeFull(level, entries) {
  const target = join(LIB, `dict_${level}.json`);
  writeFileSync(target, `${JSON.stringify(entries, null, 0)}\n`, "utf8");
  console.log(`[${level}] 已写入 ${target}：${entries.length} 词`);
}

const WANT_FULL = process.argv.includes("--full");

for (const level of ["cet4", "cet6"]) {
  let entries = null;

  if (WANT_EXAMPLES) {
    entries = await fromNetwork(level, SENTENCE_SOURCES[level], "例句分卷").catch((err) => {
      console.warn(`[${level}] 例句分卷不可用：${err.message}`);
      return null;
    });
  } else if (WANT_DOWNLOAD) {
    entries = await fromNetwork(level, SOURCES[level], "考纲词表").catch((err) => {
      console.warn(`[${level}] 下载失败：${err.message}`);
      return null;
    });
  } else {
    entries = fromCetDir(level) ?? fromRawFile(level);
  }

  // 兜底：本地分卷
  if (!entries) entries = fromCetDir(level) ?? fromRawFile(level);

  if (!entries) {
    console.error(`[${level}] 取词失败：cet/ 里没有分卷、也没有 lib/raw_${level}.json，且网络不可用。`);
    process.exitCode = 1;
    continue;
  }

  if (level === "cet4") writeBuiltin(entries);
  if (WANT_FULL) writeFull(level, entries);
}
