"use client";

import type { WordLevel } from "../lib/words";

export interface LevelOption {
  id: WordLevel;
  label: string;
}

const LEVELS: LevelOption[] = [
  { id: "daily", label: "日常" },
  { id: "cet4", label: "四级" },
  { id: "cet6", label: "六级" },
];

export interface LevelSwitcherProps {
  currentLevel: WordLevel;
  onChange: (level: WordLevel) => void;
  /** 可选项，默认「日常 / 四级 / 六级」；词库页只传四级和六级 */
  options?: LevelOption[];
  /** 请求进行中时禁用切换，避免中途换库 */
  disabled?: boolean;
  className?: string;
}

/** 分段式 Tab 切换 */
export default function LevelSwitcher({
  currentLevel,
  onChange,
  options = LEVELS,
  disabled = false,
  className = "",
}: LevelSwitcherProps) {
  return (
    <div
      role="tablist"
      aria-label="词库等级"
      className={`flex bg-slate-100 p-1 rounded-lg ${className}`}
    >
      {options.map((level) => {
        const active = currentLevel === level.id;
        return (
          <button
            key={level.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onChange(level.id)}
            className={`flex-1 py-1 text-xs font-medium rounded-md transition-all disabled:opacity-50 ${
              active
                ? "bg-white shadow-sm text-indigo-600"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {level.label}
          </button>
        );
      })}
    </div>
  );
}

export { LEVELS };
