"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, MoreHorizontal, Search, Sparkles, X } from "lucide-react";
import AppHeader from "../../components/AppHeader";
import WordCard from "../../components/WordCard";
import { useWordCard } from "../../components/WordCardSheet";
import { getInstalledLevels, getWordsByLevel, lookupWord } from "../../lib/dictionary";
import { getBook, getBookLabel } from "../../lib/dictCatalog";

/** 每次滚到底再追加的单词数 */
const PAGE_SIZE = 60;

interface IndexEntry {
  word: string;
  /** 列表里显示的第一条释义 */
  meaning: string;
  /** 全部释义，用于中文检索 */
  all: string;
}

export default function WordsPage() {
  // 只显示已安装的「学习词库」：基础词（初中/高中）是兜底层，不单独占用 tab
  const levels = getInstalledLevels().filter((id) => getBook(id)?.category !== "基础");
  const [level, setLevel] = useState<string>(levels[0] ?? "cet4");
  const [query, setQuery] = useState("");
  const [count, setCount] = useState(PAGE_SIZE);
  const [aiQuery, setAiQuery] = useState<string | null>(null);
  const wordCard = useWordCard();
  const sentinelRef = useRef<HTMLDivElement>(null);

  // 词库是从 Map 里筛出来的，排序后展示更稳定
  const words = useMemo(
    () => getWordsByLevel(level).slice().sort((a, b) => a.localeCompare(b)),
    [level],
  );

  // 建一次索引：单词 + 释义，供中英互查用
  const index = useMemo<IndexEntry[]>(
    () =>
      words.map((word) => {
        const entry = lookupWord(word);
        const all = entry?.translation ?? "";
        return { word, meaning: all.split(/[；;]/)[0]?.trim() ?? "", all };
      }),
    [words],
  );

  // 中英互查：单词精确 > 前缀 > 包含 > 释义包含
  const results = useMemo<IndexEntry[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return index;

    const scored: Array<{ entry: IndexEntry; score: number }> = [];
    for (const item of index) {
      let score = 0;
      if (item.word === q) score = 4;
      else if (item.word.startsWith(q)) score = 3;
      else if (item.word.includes(q)) score = 2;
      else if (item.all.toLowerCase().includes(q)) score = 1;
      if (score > 0) scored.push({ entry: item, score });
    }

    scored.sort((a, b) => b.score - a.score || a.entry.word.localeCompare(b.entry.word));
    return scored.map((item) => item.entry);
  }, [index, query]);

  // 换词库 / 改搜索词都要回到第一页
  useEffect(() => {
    setCount(PAGE_SIZE);
  }, [level, query]);

  const visible = results.slice(0, count);
  const hasMore = count < results.length;

  useEffect(() => {
    const target = sentinelRef.current;
    if (!target || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) setCount((prev) => prev + PAGE_SIZE);
      },
      { rootMargin: "400px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, count]);

  return (
    <main className="w-full max-w-md mx-auto md:max-w-2xl lg:max-w-4xl h-[100dvh] flex flex-col bg-slate-50 font-sans">
      <AppHeader
        title="词库"
        showBack
        backHref="/"
        rightNode={
          <Link
            href="/dictionaries"
            aria-label="词库管理"
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 active:bg-slate-100"
          >
            <MoreHorizontal size={18} />
          </Link>
        }
      >
        {/* 已安装词库的横向滑动条 */}
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {levels.map((id) => {
            const active = id === level;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setLevel(id)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "bg-white text-indigo-600 shadow-sm"
                    : "text-slate-500 active:bg-slate-100"
                }`}
              >
                {getBookLabel(id)}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-xl bg-slate-100 px-3 py-2">
            <Search size={14} className="shrink-0 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="输入单词或中文释义"
              className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="清空搜索"
                className="shrink-0 text-slate-400 active:scale-90"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <button
            type="button"
            disabled={!query.trim()}
            onClick={() => setAiQuery(query.trim())}
            className="flex shrink-0 items-center gap-1 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-medium text-white active:scale-95 disabled:opacity-40"
          >
            <Sparkles size={14} /> AI
          </button>
        </div>
      </AppHeader>

      <div className="flex-1 overflow-y-auto px-3 py-3 overscroll-contain pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {/* AI 查词结果 */}
        {aiQuery && (
          <div className="mb-3">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-[11px] text-slate-400">AI 查询：{aiQuery}</span>
              <button
                type="button"
                onClick={() => setAiQuery(null)}
                aria-label="关闭 AI 结果"
                className="text-slate-400 active:scale-90"
              >
                <X size={14} />
              </button>
            </div>
            <WordCard word={aiQuery} forceAi />
          </div>
        )}

        {visible.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-400">
            没有匹配「{query}」的词
            <br />
            <span className="text-xs">可以点右上角 AI 现查</span>
          </div>
        ) : (
          <div className="columns-2 gap-2 md:columns-3 lg:columns-4">
            {visible.map(({ word, meaning }) => (
              <button
                key={word}
                type="button"
                onClick={() => wordCard?.openWord(word)}
                className="mb-2 block w-full break-inside-avoid rounded-2xl border border-slate-100 bg-white p-3 text-left shadow-sm active:scale-[0.98] transition-transform"
              >
                <p className="text-[15px] font-bold text-slate-800 break-words">{word}</p>
                {meaning && (
                  <p className="mt-1 text-[11px] leading-snug text-slate-400 line-clamp-3">
                    {meaning}
                  </p>
                )}
              </button>
            ))}
          </div>
        )}

        {hasMore ? (
          <div ref={sentinelRef} className="flex items-center justify-center py-5">
            <Loader2 size={18} className="animate-spin text-slate-300" />
          </div>
        ) : (
          visible.length > 0 && (
            <p className="py-5 text-center text-xs text-slate-400">全部 {results.length} 个单词</p>
          )
        )}
      </div>
    </main>
  );
}
