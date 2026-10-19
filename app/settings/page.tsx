"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ChevronRight, Download, KeyRound, Loader2, Save, Trash2 } from "lucide-react";
import AppHeader from "../../components/AppHeader";
import { db } from "../db";
import { isAiLookupEnabled, setAiLookupEnabled } from "../../lib/aiLookup";
import { isAiScenarioEnabled, setAiScenarioEnabled } from "../../lib/scenarios";

function SwitchRow({
  title,
  desc,
  checked,
  onChange,
}: {
  title: string;
  desc: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-sm font-bold text-slate-800">{title}</h2>
        <p className="text-xs text-slate-400 leading-relaxed mt-1">{desc}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        onClick={onChange}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? "bg-indigo-600" : "bg-slate-200"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
            checked ? "left-[22px]" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState("");
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiScenario, setAiScenario] = useState(false);
  const [noteCount, setNoteCount] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    const savedKey = localStorage.getItem("deepseek_api_key");
    if (savedKey) setApiKey(savedKey);
    setAiEnabled(isAiLookupEnabled());
    setAiScenario(isAiScenarioEnabled());

    let alive = true;
    db.cards
      .count()
      .then((count) => {
        if (alive) setNoteCount(count);
      })
      .catch(() => {
        if (alive) setNoteCount(null);
      });

    return () => {
      alive = false;
    };
  }, []);

  const handleClearNotes = async () => {
    const label = noteCount === null ? "" : `全部 ${noteCount} 组`;
    if (!window.confirm(`确定清空${label}笔记吗？此操作不可恢复。`)) return;

    setClearing(true);
    try {
      await db.cards.clear();
      setNoteCount(0);
      alert("已清空所有笔记。");
    } catch {
      alert("清空失败，请重试。");
    } finally {
      setClearing(false);
    }
  };

  const handleSave = () => {
    localStorage.setItem("deepseek_api_key", apiKey.trim());
    alert("保存成功！");
  };

  return (
    <main className="w-full max-w-md mx-auto md:max-w-2xl lg:max-w-4xl h-[100dvh] flex flex-col bg-slate-50 font-sans">
      <AppHeader title="设置" showBack backHref="/" />

      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 space-y-4">
          <div className="flex items-center gap-2 text-slate-800 font-bold mb-2">
            <KeyRound size={18} className="text-indigo-500" />
            <h2>DeepSeek API Key</h2>
          </div>

          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-base appearance-none"
          />

          <button
            onClick={handleSave}
            className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white py-3 rounded-xl active:scale-[0.98] transition-transform font-medium shadow-sm"
          >
            <Save size={18} /> 保存到本地
          </button>

          <p className="text-xs text-slate-400 leading-relaxed pt-2">
            注意：API Key 仅保存在你的手机本地（localStorage），绝对不会上传到任何服务器。你可以去
            platform.deepseek.com 申请。
          </p>
        </div>

        <Link
          href="/dictionaries"
          className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm active:scale-[0.99] transition-transform"
        >
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-800">词库管理</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              下载 CET-6、考研、专四、专八、雅思托福等词库，支持国内镜像。
            </p>
          </div>
          <ChevronRight size={18} className="shrink-0 text-slate-300" />
        </Link>

<div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 space-y-4">
          <SwitchRow
            title="AI 补全生词"
            desc="词库里查不到的词，让 DeepSeek 现查释义、词形变化和例句，结果缓存在本地。每次新词会消耗 token。"
            checked={aiEnabled}
            onChange={() => {
              const next = !aiEnabled;
              setAiEnabled(next);
              setAiLookupEnabled(next);
            }}
          />

          <div className="h-px bg-slate-100" />

          <SwitchRow
            title="AI 生成场景提示"
            desc="首页提示区默认从内置题库里抽；开启后，点一次提示就由 DeepSeek 现写一条。"
            checked={aiScenario}
            onChange={() => {
              const next = !aiScenario;
              setAiScenario(next);
              setAiScenarioEnabled(next);
            }}
          />
        </div>

        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
          <h2 className="text-sm font-bold text-slate-800">数据</h2>
          <p className="text-xs text-slate-400 leading-relaxed mt-1">
            笔记存在本机 IndexedDB 里，共 {noteCount === null ? "…" : noteCount} 组。
          </p>
          <button
            type="button"
            disabled={clearing || noteCount === 0}
            onClick={handleClearNotes}
            className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 py-2.5 text-sm font-medium text-red-600 active:scale-[0.98] transition-transform disabled:opacity-40"
          >
            {clearing ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
            清空所有笔记
          </button>
        </div>
      </div>
    </main>
  );
}
