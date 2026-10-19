"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { getInstalledLevels } from "../lib/dictionary";
import { getBook, getBookLabel } from "../lib/dictCatalog";
import type { WordLevel } from "../lib/words";

interface LevelOption {
  id: WordLevel;
  label: string;
  desc: string;
}

/** 日常 + 已安装的学习词库：下载了新词库，胶囊里就会多一项 */
function buildOptions(): LevelOption[] {
  const books = getInstalledLevels()
    .filter((id) => getBook(id)?.category !== "基础")
    .map((id) => ({
      id,
      label: getBookLabel(id),
      desc: `从 ${getBookLabel(id)} 词库取词`,
    }));

  return [{ id: "daily", label: "日常", desc: "不查词库，只求自然" }, ...books];
}

export interface LevelPillProps {
  level: WordLevel;
  onChange: (level: WordLevel) => void;
  disabled?: boolean;
}

/**
 * 输入框上方的难度胶囊：默认只显示当前难度，点开在浮层里切换。
 * 替换掉原来占一整行的 Tab 栏，把空间还给对话区。
 */
export default function LevelPill({ level, onChange, disabled = false }: LevelPillProps) {
  const [open, setOpen] = useState(false);
  const options = buildOptions();
  const current = options.find((option) => option.id === level) ?? options[0];

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 pl-2.5 pr-2 py-1 rounded-full bg-slate-100 text-slate-600 text-xs font-medium active:scale-95 transition-all disabled:opacity-40"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
        {current.label}
        <ChevronDown
          size={12}
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />

          <div
            role="listbox"
            aria-label="选择难度"
            className="absolute bottom-[calc(100%+10px)] left-0 z-40 w-60 origin-bottom-left animate-pop-in rounded-2xl border border-slate-100 bg-white p-1.5 shadow-xl"
          >
            {options.map((option) => {
              const active = option.id === level;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(option.id);
                    setOpen(false);
                  }}
                  className="w-full flex items-start gap-2 rounded-xl p-2.5 text-left active:bg-slate-50"
                >
                  <span className="flex-1">
                    <span className="block text-sm font-semibold text-slate-800">
                      {option.label}
                    </span>
                    <span className="block text-[11px] text-slate-400 mt-0.5">
                      {option.desc}
                    </span>
                  </span>
                  {active && <Check size={16} className="mt-1 shrink-0 text-slate-800" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
