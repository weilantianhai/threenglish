"use client";

import type { NoteTurn } from "../app/db";
import ClickableText from "./ClickableText";
import { useWordCard } from "./WordCardSheet";
import { Check, RotateCw, Undo2 } from "lucide-react";

export interface FlashcardProps {
  /** 单句数据 */
  turn: NoteTurn;
  /** 是否已翻到背面 */
  isFlipped: boolean;
  /** 点击卡片翻转 */
  onFlip: () => void;
  /** 点击「标记为已掌握」，不传则不渲染该按钮 */
  onMastered?: () => void;
  /** 当前卡片是否已掌握，决定按钮文案（再点一次取消） */
  isMastered?: boolean;
  className?: string;
}

/**
 * 3D 翻转闪卡。
 * 正面：原句 + 译文；背面：优化后的句子 + 锚点词解析。
 *
 * 卡片尺寸固定（aspect-[4/5]），文字区独立滚动：
 * 句子太长时在卡片内部滚动，而不是溢出卡片或把按钮挤走。
 * 正面原句、背面句子、锚点词都可点，点了弹单词卡片（已 stopPropagation，不会翻卡）。
 */
export default function Flashcard({
  turn,
  isFlipped,
  onFlip,
  onMastered,
  isMastered = false,
  className = "",
}: FlashcardProps) {
  const wordCard = useWordCard();

  const originalText = typeof turn?.text === "string" ? turn.text : "";
  const translation = typeof turn?.translation === "string" ? turn.translation : "";
  const corrected = typeof turn?.corrected === "string" ? turn.corrected : "";
  const anchorAnalysis =
    typeof turn?.anchorAnalysis === "string" ? turn.anchorAnalysis : "";
  const anchors = Array.isArray(turn?.anchors)
    ? turn.anchors.filter((anchor): anchor is string => typeof anchor === "string")
    : [];

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={isFlipped ? "查看原句" : "查看优化后的句子"}
      className={`w-full max-w-sm aspect-[4/5] relative perspective-1000 cursor-pointer outline-none ${className}`}
      onClick={onFlip}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onFlip();
        }
      }}
    >
      <div
        className="w-full h-full relative preserve-3d transition-transform duration-500"
        style={{ transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)" }}
      >
        {/* 正面：原句 + 译文 */}
        <div
          className="absolute inset-0 backface-hidden bg-white rounded-3xl px-6 pt-6 pb-4 flex flex-col items-center text-center shadow-2xl"
          style={{ transform: "rotateY(0deg)" }}
        >
          <span className="shrink-0 text-xs text-slate-400 font-medium mb-3 tracking-widest uppercase">
            Original
          </span>

          {/* 固定高度 + 内部滚动 */}
          <div className="flex-1 min-h-0 w-full overflow-y-auto overscroll-contain px-1 flex items-center justify-center [scrollbar-width:thin]">
            <ClickableText
              text={originalText || "无原句"}
              className="w-full text-xl text-slate-800 font-medium leading-relaxed"
              linkClassName="text-slate-800 underline decoration-dashed decoration-slate-300 underline-offset-4"
            />
          </div>

          {translation && (
            <p className="shrink-0 mt-2 max-w-full line-clamp-2 text-sm text-slate-500 bg-slate-100 px-3 py-1 rounded-2xl">
              {translation}
            </p>
          )}

          <div className="shrink-0 mt-2 flex items-center gap-1.5 text-slate-400 text-[11px]">
            <RotateCw size={12} /> 点击翻转
          </div>
        </div>

        {/* 背面：优化后的句子 + 锚点词解析 */}
        <div
          className="absolute inset-0 backface-hidden bg-indigo-600 rounded-3xl px-6 pt-6 pb-4 flex flex-col items-center text-center shadow-2xl text-white"
          style={{ transform: "rotateY(180deg)" }}
        >
          <span className="shrink-0 text-xs text-indigo-200 font-medium mb-3 tracking-widest uppercase">
            Corrected
          </span>

          <div className="flex-1 min-h-0 w-full overflow-y-auto overscroll-contain px-1 flex flex-col items-center justify-start gap-3 [scrollbar-width:thin]">
            <ClickableText
              text={corrected || "无内容"}
              className="w-full text-xl font-medium leading-relaxed"
              linkClassName="text-white underline decoration-dashed decoration-white/60 underline-offset-4"
            />

            {anchorAnalysis && (
              <p className="text-xs text-indigo-200 bg-indigo-700/50 px-3 py-1.5 rounded-lg w-full">
                💡 {anchorAnalysis}
              </p>
            )}

            {anchors.length > 0 && (
              <div className="flex flex-wrap gap-2 justify-center pb-1">
                {anchors.map((anchor, index) => (
                  <button
                    key={`${anchor}-${index}`}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      wordCard?.openWord(anchor);
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    className="bg-indigo-500/50 border border-indigo-400 px-3 py-1 rounded-full text-sm active:scale-95 transition-transform"
                  >
                    {anchor}
                  </button>
                ))}
              </div>
            )}
          </div>

          {onMastered && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onMastered();
              }}
              className="mt-2 shrink-0 bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-full text-xs font-medium flex items-center gap-1 active:scale-95 transition-all"
            >
              {isMastered ? <Undo2 size={14} /> : <Check size={14} />}
              {isMastered ? "取消已掌握" : "太简单了，标记为已掌握"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
