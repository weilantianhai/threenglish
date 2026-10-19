"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import WordCard from "./WordCard";
import { registerBackHandler } from "../lib/backHandler";

interface WordCardContextValue {
  /** 打开某个单词的卡片弹层 */
  openWord: (word: string) => void;
  closeWord: () => void;
}

const WordCardContext = createContext<WordCardContextValue | null>(null);

export function useWordCard(): WordCardContextValue | null {
  return useContext(WordCardContext);
}

/**
 * 全局单词卡片弹层。
 *
 * 挂在根布局上，任何地方（闪卡句子、锚点词、词库列表）调用 useWordCard().openWord()
 * 都能在当前位置弹出卡片，不需要跳页 —— 静态导出下也就没有「未预渲染的路由 404」问题。
 */
export function WordCardProvider({ children }: { children: ReactNode }) {
  const [word, setWord] = useState<string | null>(null);

  const openWord = useCallback((next: string) => {
    const normalized = next.trim().toLowerCase();
    if (normalized) setWord(normalized);
  }, []);

  const closeWord = useCallback(() => setWord(null), []);

  // 卡片打开时接管安卓返回键：先关卡片，而不是把后面的页面退掉
  useEffect(() => {
    if (!word) return;
    return registerBackHandler(() => {
      setWord(null);
      return true;
    });
  }, [word]);

  // Esc 也能关（桌面端顺手）
  useEffect(() => {
    if (!word) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setWord(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [word]);

  const value = useMemo(() => ({ openWord, closeWord }), [openWord, closeWord]);

  return (
    <WordCardContext.Provider value={value}>
      {children}

      {word && (
        <>
          {/*
            层级要压过应用内的所有浮层：笔记复习界面是 z-50，
            这里如果也用 z-40，遮罩会被压在它下面 —— 点「卡片外面」实际点到了复习卡片，
            于是单词卡关掉的同时闪卡也翻了。所以遮罩 60 / 面板 70。
          */}
          <div
            className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm animate-fade-in"
            onClick={(event) => {
              // 只处理落在遮罩本身上的点击，避免子元素事件冒泡上来误关
              if (event.target !== event.currentTarget) return;
              closeWord();
            }}
            aria-hidden
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${word} 的释义`}
            className="fixed inset-x-0 bottom-0 z-[70] mx-auto w-full max-w-md px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] animate-sheet-up"
          >
            <div className="relative rounded-t-3xl rounded-b-2xl bg-slate-100/90 backdrop-blur p-2 shadow-2xl">
              <div className="flex items-center justify-between px-2 pt-1 pb-2">
                <span className="h-1 w-8 rounded-full bg-slate-300" />
                <button
                  type="button"
                  onClick={closeWord}
                  aria-label="关闭"
                  className="p-1.5 -mr-1 text-slate-400 active:scale-90 transition-transform"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="max-h-[70dvh] overflow-y-auto overscroll-contain">
                <WordCard word={word} />
              </div>
            </div>
          </div>
        </>
      )}
    </WordCardContext.Provider>
  );
}
