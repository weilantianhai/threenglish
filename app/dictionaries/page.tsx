"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Check, Copy, Download, Loader2, Trash2, X } from "lucide-react";
import AppHeader from "../../components/AppHeader";
import { getDictionaryMeta, type DictLevelMeta } from "../../lib/dictionary";
import { groupBooks, type DictBook } from "../../lib/dictCatalog";
import {
  cancelDownload,
  dismissDownload,
  getDefaultDictBase,
  getDictMirror,
  getDictVariant,
  getDownloadTasks,
  removeDictionary,
  setDictMirror,
  setDictVariant,
  startDownload,
  subscribeDownloadTasks,
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
  const [mirror, setMirror] = useState(() => getDictMirror());
  const [mirrorSaved, setMirrorSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [variant, setVariantState] = useState<DictVariant>(() => getDictVariant());

  // 下载任务在模块级 store 里，离开页面不会丢；回来时直接显示当前进度
  const downloads = useSyncExternalStore(
    subscribeDownloadTasks,
    getDownloadTasks,
    getDownloadTasks,
  );
  const anyDownloading = downloads.some((task) => task.status === "downloading");

  // 任务状态变化后重读词库元信息（尤其 downloading → done）
  const downloadKey = downloads
    .map((task) => `${task.level}:${task.status}:${task.count ?? 0}`)
    .join("|");
  useEffect(() => {
    setMeta(getDictionaryMeta());
  }, [downloadKey]);

  const books = groups.find((group) => group.category === activeCategory)?.books ?? [];

  const handleDownload = (book: DictBook) => {
    // 先清掉上一次的完成/失败记录，再开新任务
    dismissDownload(book.id);
    // 失败和取消都写进任务状态里，这里只需吞掉 rejection
    void startDownload(book.id).catch(() => undefined);
  };

  const handleRemove = async (book: DictBook) => {
    await removeDictionary(book.id);
    setMeta(getDictionaryMeta());
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
            const task = downloads.find((item) => item.level === book.id);
            const busy = task?.status === "downloading";
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
                      disabled={busy || anyDownloading}
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
                        disabled={busy || anyDownloading}
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
                disabled={anyDownloading}
                onClick={() => {
                  setVariantState(item);
                  setDictVariant(item);
                }}
                className={`flex-1 rounded-md py-1 text-[11px] font-medium transition-colors disabled:opacity-40 ${
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

        {/* 下载任务：状态在模块级 store 里，离开页面回来还能接上 */}
        {downloads.length > 0 && (
          <div className="space-y-1.5">
            {downloads.map((task) => (
              <div key={task.level} className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`min-w-0 flex-1 break-all text-[11px] leading-relaxed ${
                      task.status === "error"
                        ? "text-red-500"
                        : task.status === "canceled"
                          ? "text-slate-400"
                          : "text-indigo-600"
                    }`}
                  >
                    <span className="font-medium">{task.label}</span>：{task.message}
                  </span>

                  {task.status === "downloading" ? (
                    <button
                      type="button"
                      onClick={() => cancelDownload(task.level)}
                      className="shrink-0 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-500 active:scale-95"
                    >
                      取消
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => dismissDownload(task.level)}
                      aria-label="收起状态"
                      className="shrink-0 rounded p-0.5 text-slate-300 active:scale-95"
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>

                {task.status === "downloading" && (
                  <div className="mt-1 h-0.5 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-indigo-500 transition-all"
                      style={{ width: `${Math.round(task.ratio * 100)}%` }}
                    />
                  </div>
                )}
              </div>
            ))}
            {anyDownloading && (
              <p className="text-[10px] leading-relaxed text-slate-400">
                下载在后台继续，离开本页不会中断。
              </p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
