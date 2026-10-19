// lib/dictRuntime.ts
// 运行时词库：从 GitHub（或用户配置的镜像）下载 KyleBing/dict 的分卷，
// 归一化后存进 IndexedDB，并替换内存里的词库槽位。
//
// 用 book-json-sentence 而不是 simple：只有它同时带音标、词组和例句。
//
// 下载任务放在模块级 store 里，而不是页面 state：
//   - 切页面 / 按返回键离开时任务继续跑，回到词库管理页能接上进度
//   - 同一本词库同时只有一个任务，重复点击复用同一个 Promise
//   - 镜像源和词库版本在任务开始时快照一次，中途改设置不会让分卷混版本

import { db } from "../app/db";
import { getBook, type DictBook } from "./dictCatalog";
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

/** 单个分卷的超时：大文件慢，但也不能无限等 */
const PART_TIMEOUT_MS = 180_000;

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

// ---------- 下载任务 store ----------

export type DownloadStatus = "downloading" | "done" | "error" | "canceled";

export interface DownloadTask {
  level: DictLevel;
  label: string;
  status: DownloadStatus;
  /** 0~1 */
  ratio: number;
  /** 当前阶段的说明文案 */
  message: string;
  /** 成功安装的词数 */
  count?: number;
  /** 失败原因 */
  error?: string;
  startedAt: number;
}

/** 取消下载：与超时抛出的错误区分开 */
export class DownloadCanceledError extends Error {
  constructor() {
    super("已取消下载");
    this.name = "DownloadCanceledError";
  }
}

const downloads = new Map<DictLevel, DownloadTask>();
const controllers = new Map<DictLevel, AbortController>();
const inflight = new Map<DictLevel, Promise<number>>();
const listeners = new Set<() => void>();

// useSyncExternalStore 要求两次变更之间快照保持同一引用
let snapshot: DownloadTask[] = [];

function emit(): void {
  snapshot = [...downloads.values()].sort((a, b) => a.startedAt - b.startedAt);
  for (const listener of listeners) listener();
}

/** 页面订阅用；返回取消订阅函数 */
export function subscribeDownloadTasks(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getDownloadTasks(): DownloadTask[] {
  return snapshot;
}

export function getDownloadTask(level: DictLevel): DownloadTask | undefined {
  return downloads.get(level);
}

export function isDownloading(level: DictLevel): boolean {
  return downloads.get(level)?.status === "downloading";
}

function patchTask(level: DictLevel, patch: Partial<DownloadTask>): void {
  const prev = downloads.get(level);
  if (!prev) return;
  downloads.set(level, { ...prev, ...patch });
  emit();
}

/** 取消进行中的任务。已经进入「写入本地」阶段时无法再中断，会正常完成 */
export function cancelDownload(level: DictLevel): void {
  controllers.get(level)?.abort();
}

/** 清掉一条已结束的任务记录（下载中的不允许清） */
export function dismissDownload(level: DictLevel): void {
  if (downloads.get(level)?.status === "downloading") return;
  downloads.delete(level);
  emit();
}

/**
 * 开始下载某本词库。
 * 已经有任务在跑时直接复用，不会产生第二个请求。
 */
export function startDownload(level: DictLevel): Promise<number> {
  const running = inflight.get(level);
  if (running) return running;

  const book = getBook(level);
  if (!book) return Promise.reject(new Error(`未知词库：${level}`));

  const controller = new AbortController();
  controllers.set(level, controller);

  downloads.set(level, {
    level,
    label: book.label,
    status: "downloading",
    ratio: 0,
    message: "准备下载…",
    startedAt: Date.now(),
  });
  emit();

  const promise = runDownload(book, level, controller)
    .then((count) => {
      patchTask(level, {
        status: "done",
        ratio: 1,
        count,
        message: `已安装 ${count} 个词`,
      });
      return count;
    })
    .catch((error: unknown) => {
      const canceled = error instanceof DownloadCanceledError;
      const message = error instanceof Error ? error.message : String(error);
      patchTask(level, {
        status: canceled ? "canceled" : "error",
        message: canceled ? "已取消下载" : `下载失败：${message}`,
        error: canceled ? undefined : message,
      });
      throw error;
    })
    .finally(() => {
      controllers.delete(level);
      inflight.delete(level);
    });

  inflight.set(level, promise);
  return promise;
}

async function runDownload(
  book: DictBook,
  level: DictLevel,
  controller: AbortController,
): Promise<number> {
  // 开始时快照：中途改镜像或切版本，不会让不同分卷来自不同来源
  const base = (getDictMirror() || GITHUB_BASE).replace(/\/+$/, "");
  const folder = VARIANT_FOLDER[getDictVariant()];
  const { parts } = book;
  const merged: DictEntry[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < parts.length; i += 1) {
    if (controller.signal.aborted) throw new DownloadCanceledError();

    patchTask(level, {
      ratio: i / parts.length,
      message: `下载 ${book.label} 第 ${i + 1}/${parts.length} 个分卷…`,
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, PART_TIMEOUT_MS);

    try {
      const response = await fetch(`${base}/${folder}/${parts[i]}.json`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`${parts[i]} 下载失败（HTTP ${response.status}）`);
      const text = await response.text();

      // normalizeDictEntries 内部会按行 JSON.parse
      for (const entry of normalizeDictEntries(text, level)) {
        if (seen.has(entry.word)) continue;
        seen.add(entry.word);
        merged.push(entry);
      }
    } catch (error) {
      if (controller.signal.aborted) {
        // 同一个 AbortController 既管取消也管超时，用 timedOut 区分
        throw timedOut
          ? new Error(`${parts[i]} 下载超时（3 分钟），试试换镜像`)
          : new DownloadCanceledError();
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  if (merged.length === 0) throw new Error("下载到的词库是空的");
  if (controller.signal.aborted) throw new DownloadCanceledError();

  patchTask(level, { ratio: 1, message: `写入本地（${merged.length} 词）…` });

  // 先落盘再换内存：写失败就当作没下载，避免「提示失败但本次会话已生效」。
  // 从这一行往后不再响应取消 —— IndexedDB 写入没法中断，硬报取消只会让状态和数据对不上。
  await db.dicts.put({ level, entries: merged, updatedAt: Date.now() });
  replaceLevel(level, merged, "downloaded");

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

/**
 * 删除已下载的词库（CET-4 会回到内置版本）。
 * 如果这本词库正在后台下载，先取消并等它落定，避免「删完又被写回来」。
 */
export async function removeDictionary(level: DictLevel): Promise<void> {
  const running = inflight.get(level);
  if (running) {
    cancelDownload(level);
    await running.catch(() => undefined);
  }

  resetLevel(level);
  await db.dicts.delete(level);
}
