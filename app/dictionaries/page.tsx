"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Download, Loader2, Trash2 } from "lucide-react";
import AppHeader from "../../components/AppHeader";
import { getDictionaryMeta, type DictLevelMeta } from "../../lib/dictionary";
import { groupBooks, type DictBook } from "../../lib/dictCatalog";
import {
  downloadDictionary,
  getDefaultDictBase,
  getDictMirror,
  getDictVariant,
  removeDictionary,
  setDictMirror,
  setDictVariant,
  VARIANT_HINT,
  VARIANT_LABEL,
  type DictVariant,
} from "../../lib/dictRuntime";

const VARIANTS: DictVariant[] = ["simple", "sentence", "full"];

/** 实测可用的镜像示例 */
const EXAMPLE_MIRROR =
  "https://ghproxy.net/https://raw.githubusercontent.com/KyleBing/dict/master";

export default function DictionariesPage() {
  const groups = useMemo(() => groupBooks(), []);
  const [activeCategory, setActiveCategory] = useState(groups[0]?.category ?? "");
  const [meta, setMeta] = useState<Record<string, DictLevelMeta>>(() => getDictionaryMeta());
  const [downloading, setDownloading] = useState<string | null>(null);
  const [progressText, setProgressText] = useState("");
  const [mirror, setMirror] = useState(() => getDictMirror());
  const [mirrorSaved, setMirrorSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [variant, setVariantState] = useState<DictVariant>(() => getDictVariant());

  const books = groups.find((group) => group.category === activeCategory)?.books ?? [];

  const handleDownload = async (book: DictBook) => {
    setDownloading(book.id);
    setProgressText("");

    try {
      const count = await downloadDictionary(book.id, (progress) => {
        setProgressText(`${book.label}：${progress.message}`);
      });
      setMeta(getDictionaryMeta());
      setProgressText(`完成：${book.label} 已安装 ${count} 个词`);
    } catch (error) {
      setProgressText(
        `${book.label} 下载失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setDownloading(null);
    }
  };

  const handleRemove = async (book: DictBook) => {
    await removeDictionary(book.id);
    setMeta(getDictionaryMeta());
    setProgressText(book.builtin ? `${book.label} 已恢复内置版本` : `${book.label} 已删除`);
  };

  const copyExample = async () => {
    try {
      await navigator.clipboard.writeText(EXAMPLE_MIRROR);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setMirror(EXAMPLE_MIRROR);
    }
  };

  return (
    <main className="max-w-md mx-auto h-[100dvh] flex flex-col bg-slate-50 font-sans">
      <AppHeader title="词库管理" showBack backHref="/words" />

      {/* 分类横向分页 */}
      <div className="shrink-0 border-b border-slate-100 bg-white">
        <div className="flex gap-1 overflow-x-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {groups.map((group) => {
            const active = group.category === activeCategory;
            return (
              <button
                key={group.category}
                type="button"
                onClick={() => setActiveCategory(group.category)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 text-slate-500 active:bg-slate-200"
                }`}
              >
                {group.category}
              </button>
            );
          })}
        </div>
      </div>

      {/* 当前分类的词库列表 */}
      <div className="flex-1 overflow-y-auto px-4 py-3 overscroll-contain">
        <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
          {books.map((book, index) => {
            const info = meta[book.id];
            const installed = Boolean(info);
            const busy = downloading === book.id;
            const sourceText = !info
              ? "未安装"
              : info.source === "builtin"
                ? `内置 ${info.count} 词`
                : `已下载 ${info.count} 词`;

            return (
              <div key={book.id} className={`px-3.5 py-3 ${index > 0 ? "border-t border-slate-100" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                      {book.label}
                      {installed && book.builtin && (
                        <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-600">
                          内置
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-snug text-slate-400">
                      {book.description}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-400">{sourceText}</p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      disabled={busy || downloading !== null}
                      onClick={() => void handleDownload(book)}
                      className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[11px] font-medium text-white active:scale-95 disabled:opacity-40"
                    >
                      {busy ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Download size={12} />
                      )}
                      {installed ? "更新" : "下载"}
                    </button>

                    {installed && !book.builtin && (
                      <button
                        type="button"
                        disabled={busy || downloading !== null}
                        onClick={() => void handleRemove(book)}
                        aria-label={`删除 ${book.label}`}
                        className="rounded-lg border border-slate-200 p-1.5 text-slate-400 active:scale-95 disabled:opacity-40"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 底部固定：下载内容 + 镜像源 + 进度 */}
      <div className="shrink-0 border-t border-slate-100 bg-white px-4 py-3 space-y-2.5 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[11px] text-slate-400">下载内容</span>
          <div className="flex flex-1 gap-1 rounded-lg bg-slate-100 p-0.5">
            {VARIANTS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setVariantState(item);
                  setDictVariant(item);
                }}
                className={`flex-1 rounded-md py-1 text-[11px] font-medium transition-colors ${
                  variant === item ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500"
                }`}
              >
                {VARIANT_LABEL[item]}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <input
              value={mirror}
              onChange={(event) => setMirror(event.target.value)}
              placeholder="镜像前缀，留空用 GitHub 直连"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
            <button
              type="button"
              onClick={() => {
                setDictMirror(mirror);
                setMirrorSaved(true);
                setTimeout(() => setMirrorSaved(false), 1500);
              }}
              className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-600 active:scale-95"
            >
              {mirrorSaved ? "已保存" : "保存"}
            </button>
            <button
              type="button"
              onClick={() => void copyExample()}
              aria-label="复制示例镜像"
              className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-600 active:scale-95"
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              {copied ? "已复制" : "示例"}
            </button>
          </div>

          {/* 示例源多行显示，避免撑破卡片 */}
          <p className="break-all rounded-lg bg-slate-50 px-2 py-1.5 text-[10px] leading-relaxed text-slate-400">
            示例（可用）：{EXAMPLE_MIRROR}
          </p>

          <p className="text-[10px] leading-relaxed text-slate-400">
            {VARIANT_HINT[variant]}。默认源 {getDefaultDictBase()}，下载失败会显示状态码。
          </p>
        </div>

        {progressText && (
          <p className="break-all text-[11px] leading-relaxed text-indigo-600">{progressText}</p>
        )}
      </div>
    </main>
  );
}
