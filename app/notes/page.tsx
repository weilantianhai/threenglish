"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db, type NoteCard, type NoteTurn } from "../db";
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  BookMarked,
  Play,
  X,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Loader2,
  Check,
  Undo2,
} from "lucide-react";
import { useState, useRef, useEffect, useMemo } from "react";
import AppHeader from "../../components/AppHeader";
import Flashcard from "../../components/Flashcard";

const PAGE_SIZE = 10;

type MasteryFilter = "all" | "mastered" | "unmastered";

const FILTERS: Array<{ id: MasteryFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "unmastered", label: "未掌握" },
  { id: "mastered", label: "已掌握" },
];

export default function NotesPage() {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [filter, setFilter] = useState<MasteryFilter>("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // 数据量小，整表取回来再在内存里筛选，避免筛选和分页打架
  const cards = useLiveQuery(() => db.cards.reverse().toArray(), []);
  const [reviewCard, setReviewCard] = useState<NoteCard | null>(null);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const observerTarget = useRef<HTMLDivElement>(null);

  const filteredCards = useMemo(() => {
    if (!cards) return undefined;
    if (filter === "mastered") return cards.filter((card) => card.isMastered);
    if (filter === "unmastered") return cards.filter((card) => !card.isMastered);
    return cards;
  }, [cards, filter]);

  const visibleCards = filteredCards?.slice(0, limit);
  const hasMore = (filteredCards?.length ?? 0) > limit;

  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [filter]);

  useEffect(() => {
    const target = observerTarget.current;
    if (!target || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setLimit((prev) => prev + PAGE_SIZE);
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(target);
    return () => {
      observer.unobserve(target);
    };
  }, [hasMore, visibleCards?.length]);

  // 只复习有内容的句子：历史数据里可能出现「原句空、只剩翻译」的残缺项，
  // 直接跳过，否则会翻出一张写着「无原句」的空卡片。
  const reviewTurns: NoteTurn[] = reviewCard
    ? [reviewCard.turn1, reviewCard.turn2, reviewCard.turn3].filter(
        (turn): turn is NoteTurn =>
          Boolean(turn) &&
          (Boolean(turn.text && turn.text.trim()) || Boolean(turn.corrected && turn.corrected.trim())),
      )
    : [];

  const currentTurn: NoteTurn | null = reviewTurns[reviewIndex] ?? null;

  const closeReview = () => {
    setReviewCard(null);
    setReviewIndex(0);
    setIsFlipped(false);
  };

  const handleNext = () => {
    if (reviewIndex < reviewTurns.length - 1) {
      setIsFlipped(false);
      setTimeout(() => setReviewIndex((prev) => prev + 1), 150);
    } else {
      closeReview();
    }
  };

  const handlePrev = () => {
    if (reviewIndex > 0) {
      setIsFlipped(false);
      setTimeout(() => setReviewIndex((prev) => prev - 1), 150);
    }
  };

  // 掌握状态是双向的：再点一次就取消
  const toggleMastered = async (card: NoteCard) => {
    if (!card.id) return;
    await db.cards.update(card.id, { isMastered: !card.isMastered });
  };

  const handleDelete = async (id?: number, event?: React.MouseEvent) => {
    event?.stopPropagation();
    if (!id) return;
    if (window.confirm("确定要删除这组笔记吗？不可恢复哦。")) {
      await db.cards.delete(id);
    }
  };

  const startReview = (card: NoteCard) => {
    setReviewCard(card);
    setReviewIndex(0);
    setIsFlipped(false);
  };

  return (
    <main className="w-full max-w-md mx-auto md:max-w-2xl lg:max-w-4xl h-[100dvh] flex flex-col bg-slate-50 font-sans relative">
      <AppHeader title="我的笔记" showBack backHref="/">
        {/* 全部 / 未掌握 / 已掌握 */}
        <div className="flex gap-1.5">
          {FILTERS.map((item) => {
            const active = filter === item.id;
            const count =
              item.id === "all"
                ? cards?.length ?? 0
                : item.id === "mastered"
                  ? cards?.filter((card) => card.isMastered).length ?? 0
                  : cards?.filter((card) => !card.isMastered).length ?? 0;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                aria-pressed={active}
                className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors ${
                  active ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500"
                }`}
              >
                {item.label} {count}
              </button>
            );
          })}
        </div>
      </AppHeader>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 overscroll-contain pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {!cards ? null : visibleCards && visibleCards.length > 0 ? (
          <>
            {visibleCards.map((card) => (
              <div
                key={card.id}
                className={`bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden transition-all duration-300 ${
                  card.isMastered ? "opacity-60 grayscale-[50%]" : ""
                }`}
              >
                <div className="p-4">
                  <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center gap-1.5 text-xs text-slate-400">
                      <Calendar size={12} />
                      {new Date(card.createdAt).toLocaleDateString()}
                      {card.isMastered && (
                        <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded text-[10px] ml-2 flex items-center gap-1">
                          <Check size={10} /> 已掌握
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleMastered(card);
                        }}
                        aria-label={card.isMastered ? "取消已掌握" : "标记为已掌握"}
                        className={`p-1 active:scale-90 transition-colors ${
                          card.isMastered ? "text-green-600" : "text-slate-300 hover:text-green-600"
                        }`}
                      >
                        {card.isMastered ? <Undo2 size={16} /> : <Check size={16} />}
                      </button>
                      <button
                        onClick={() => startReview(card)}
                        className="flex items-center gap-1 text-xs bg-indigo-50 text-indigo-600 px-2.5 py-1 rounded-full font-medium active:scale-95 transition-transform"
                      >
                        <Play size={12} /> 复习
                      </button>
                      <button
                        onClick={(e) => handleDelete(card.id, e)}
                        className="p-1 text-slate-300 hover:text-red-500 active:scale-90 transition-colors"
                        aria-label="删除"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <h3 className="text-slate-800 font-medium text-[15px] mb-1 leading-snug line-clamp-1">
                    {/* 老数据里可能只有后两句有内容，取第一条非空的，别整行空白 */}
                    {card.turn1?.corrected || card.turn2?.corrected || card.turn3?.corrected || "（这组笔记没有内容）"}
                  </h3>
                  <div
                    className="mt-3 flex items-center justify-between text-xs text-slate-400 cursor-pointer"
                    onClick={() => setExpandedId(expandedId === card.id ? null : card.id!)}
                  >
                    <span>查看完整摘要</span>
                    {expandedId === card.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </div>
                </div>
                {expandedId === card.id && (
                  <div className="px-4 pb-4 border-t border-slate-100 bg-slate-50/50 pt-3">
                    <pre className="whitespace-pre-wrap font-mono text-xs text-slate-600 leading-relaxed bg-white p-3 rounded-xl border border-slate-100">
                      {typeof card.summary === "string" ? card.summary : JSON.stringify(card.summary, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ))}
            <div ref={observerTarget} className="h-10 flex items-center justify-center mt-2">
              {hasMore && <Loader2 size={20} className="animate-spin text-slate-300" />}
              {!hasMore && <span className="text-xs text-slate-400">没有更多了</span>}
            </div>
          </>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-2">
            <BookMarked size={40} className="text-slate-300" />
            <p className="text-sm">
              {filter === "mastered"
                ? "还没有标记为已掌握的笔记"
                : filter === "unmastered"
                  ? "没有未掌握的笔记，全都掌握了 🎉"
                  : "还没有笔记，去练一组吧！"}
            </p>
          </div>
        )}
      </div>

      {reviewCard && currentTurn && (
        <div className="fixed inset-0 z-50 bg-slate-900/95 backdrop-blur-sm flex flex-col items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="absolute top-[calc(1.5rem+env(safe-area-inset-top))] left-6 right-6 flex justify-between items-center text-white/80">
            <span className="text-sm font-mono">
              {reviewIndex + 1} / {reviewTurns.length}
            </span>
            <button
              onClick={closeReview}
              className="p-2 bg-white/10 rounded-full active:scale-90"
              aria-label="关闭复习"
            >
              <X size={20} />
            </button>
          </div>

          <Flashcard
            turn={currentTurn}
            isFlipped={isFlipped}
            onFlip={() => setIsFlipped((prev) => !prev)}
            isMastered={Boolean(reviewCard.isMastered)}
            onMastered={async () => {
              await toggleMastered(reviewCard);
              closeReview();
            }}
          />

          <div className="mt-12 flex items-center gap-8">
            <button
              onClick={handlePrev}
              disabled={reviewIndex === 0}
              className="p-4 bg-white/10 text-white rounded-full disabled:opacity-30 active:scale-90 transition-all"
              aria-label="上一句"
            >
              <ChevronLeft size={28} />
            </button>
            <button
              onClick={handleNext}
              className="px-8 py-4 bg-indigo-500 text-white rounded-full font-bold shadow-lg shadow-indigo-500/30 active:scale-95 transition-all flex items-center gap-2"
            >
              {reviewIndex === reviewTurns.length - 1 ? "完成复习" : "下一句"}
              {reviewIndex !== reviewTurns.length - 1 && <ChevronRight size={20} />}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
