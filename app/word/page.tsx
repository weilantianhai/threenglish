"use client";

import { Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Layers, Shuffle } from "lucide-react";
import AppHeader from "../../components/AppHeader";
import WordCard from "../../components/WordCard";
import { getDictionaryStats } from "../../lib/dictionary";
import { getBookLabel } from "../../lib/dictCatalog";
import { getRandomWords } from "../../lib/words";

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">{children}</div>
  );
}

function EmptyCard() {
  return (
    <CardShell>
      <div className="text-center space-y-3">
        <Shuffle size={36} className="mx-auto text-slate-300" />
        <p className="text-sm text-slate-500 leading-relaxed">
          在句子或词库里点单词，就会直接弹出卡片。
        </p>
        <p className="text-xs text-slate-400">也可以直接换个词看看：</p>
        <ShuffleButton />
      </div>
    </CardShell>
  );
}

function ShuffleButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        const [word] = getRandomWords("cet4", 1);
        if (word) router.push(`/word?w=${encodeURIComponent(word)}`);
      }}
      className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-full text-sm font-medium border border-indigo-100 active:scale-95 transition-transform"
    >
      <Shuffle size={14} /> 随机一个 CET-4 单词
    </button>
  );
}

function CardSkeleton() {
  return (
    <CardShell>
      <div className="space-y-3 animate-pulse">
        <div className="h-4 w-16 bg-slate-100 rounded" />
        <div className="h-8 w-40 bg-slate-100 rounded" />
        <div className="h-10 w-full bg-slate-100 rounded-xl" />
      </div>
    </CardShell>
  );
}

/**
 * 查词页（深链入口 /word?w=xxx）。
 * 词库是打包进 bundle 的 Map，查词就是一次 dictionary.get()。
 * 日常使用走的是全站弹层（WordCardSheet），这一页主要给直接访问用。
 */
function WordLookup() {
  const searchParams = useSearchParams();
  const word = (searchParams.get("w") ?? "").trim();

  const stats = useMemo(() => getDictionaryStats(), []);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-5 space-y-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] overscroll-contain">
      {word ? <WordCard word={word} /> : <EmptyCard />}

      <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-[11px] text-slate-400 pt-1">
        <span>离线词库</span>
        {Object.entries(stats).map(([id, count]) => (
          <span key={id}>
            · {getBookLabel(id)} {count} 词
          </span>
        ))}
      </div>
    </div>
  );
}

export default function WordPage() {
  const router = useRouter();

  return (
    <main className="max-w-md mx-auto min-h-[100dvh] flex flex-col bg-slate-50 font-sans">
      <AppHeader
        title="查词"
        showBack
        onBack={() => router.back()}
        rightNode={
          <Link
            href="/words"
            className="p-1 active:scale-95 transition-transform"
            aria-label="词库"
          >
            <Layers size={20} />
          </Link>
        }
      />

      {/* useSearchParams 在静态导出下必须包一层 Suspense */}
      <Suspense fallback={<div className="px-4 py-5"><CardSkeleton /></div>}>
        <WordLookup />
      </Suspense>
    </main>
  );
}
