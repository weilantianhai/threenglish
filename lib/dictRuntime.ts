// lib/dictRuntime.ts
// 运行时词库：从 GitHub（或用户配置的镜像）下载 KyleBing/dict 的分卷，
// 归一化后存进 IndexedDB，并替换内存里的词库槽位。
//
// 用 book-json-sentence 而不是 simple：只有它同时带音标、词组和例句。

import { db } from "../app/db";
import { getBook } from "./dictCatalog";
import {
  normalizeDictEntries,
  replaceLevel,
  resetLevel,
  type DictEntry,
  type DictLevel,
} from "./dictionary";

const GITHUB_BASE = "https://raw.githubusercontent.com/KyleBing/dict/master";
const MIRROR_KEY = "dict_mirror";
const VARIANT_KEY = "dict_variant";

/** 词库版本：轻量（词+释义+短语）/ 标准（+例句+音标）/ 完整（+真题、同义词、词形变化） */
export type DictVariant = "simple" | "sentence" | "full";

const VARIANT_FOLDER: Record<DictVariant, string> = {
  simple: "book-json-simple",
  sentence: "book-json-sentence",
  full: "book-json-full",
};

export const VARIANT_LABEL: Record<DictVariant, string> = {
  simple: "轻量",
  sentence: "标准",
  full: "完整",
};

export const VARIANT_HINT: Record<DictVariant, string> = {
  simple: "只有词 + 释义 + 短语，体积最小",
  sentence: "多了例句和英美音标，推荐",
  full: "再加真题例句、同义词、词形变化，体积最大",
};

export function getDictVariant(): DictVariant {
  if (typeof window === "undefined") return "sentence";
  const saved = window.localStorage.getItem(VARIANT_KEY);
  return saved === "simple" || saved === "full" ? saved : "sentence";
}

export function setDictVariant(variant: DictVariant): void {
  window.localStorage.setItem(VARIANT_KEY, variant);
}

export function getDictMirror(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(MIRROR_KEY) ?? "";
}

export function setDictMirror(value: string): void {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (trimmed) window.localStorage.setItem(MIRROR_KEY, trimmed);
  else window.localStorage.removeItem(MIRROR_KEY);
}

export function getDefaultDictBase(): string {
  return GITHUB_BASE;
}

export interface DownloadProgress {
  /** 0~1 */
  ratio: number;
  message: string;
}

/**
 * 下载并安装某个词库。
 * mirror 为空时用 GitHub；填了就用镜像前缀。
 */
export async function downloadDictionary(
  level: DictLevel,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<number> {
  const book = getBook(level);
  if (!book) throw new Error(`未知词库：${level}`);

  const base = (getDictMirror() || GITHUB_BASE).replace(/\/+$/, "");
  const parts = book.parts;
  const merged: DictEntry[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < parts.length; i += 1) {
    onProgress?.({
      ratio: i / parts.length,
      message: `下载 ${book.label} 第 ${i + 1}/${parts.length} 个分卷…`,
    });

    // 按用户选的版本拼目录：simple / sentence / full
    const folder = VARIANT_FOLDER[getDictVariant()];
    const url = `${base}/${folder}/${parts[i]}.json`;

    // 大文件下载慢，但也不能无限等：每个分卷单独计时 3 分钟，下完一卷就重新计时
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);

    let text: string;
    try {
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(`${parts[i]} 下载失败（HTTP ${response.status}）`);
      text = await response.text();
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`${parts[i]} 下载超时（3 分钟），试试换镜像`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }

    // normalizeDictEntries 内部会按行 JSON.parse
    const raw = text;
    for (const entry of normalizeDictEntries(raw, level)) {
      if (seen.has(entry.word)) continue;
      seen.add(entry.word);
      merged.push(entry);
    }
  }

  if (merged.length === 0) throw new Error("下载到的词库是空的");

  onProgress?.({ ratio: 1, message: `写入本地（${merged.length} 词）…` });

  replaceLevel(level, merged, "downloaded");
  await db.dicts.put({ level, entries: merged, updatedAt: Date.now() });

  return merged.length;
}

/** 启动时把之前下载过的词库读回内存 */
export async function loadSavedDictionaries(): Promise<void> {
  try {
    const rows = await db.dicts.toArray();
    for (const row of rows) {
      if (!Array.isArray(row.entries) || row.entries.length === 0) continue;
      replaceLevel(row.level, row.entries as DictEntry[], "downloaded");
    }
  } catch (error) {
    console.warn("[dictRuntime] 读取本地词库失败", error);
  }
}

/** 删除已下载的词库（CET-4 会回到内置版本） */
export async function removeDictionary(level: DictLevel): Promise<void> {
  resetLevel(level);
  await db.dicts.delete(level);
}
