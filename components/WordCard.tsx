"use client";

import { useEffect, useState } from "react";
import { BookX, Loader2, Sparkles, Volume2 } from "lucide-react";
import { resolveWord, type DictEntry, type DictLevel } from "../lib/dictionary";
import { getBookLabel } from "../lib/dictCatalog";
import {
  fetchAiWord,
  getApiKey,
  isAiLookupEnabled,
  type AiWordInfo,
} from "../lib/aiLookup";

const LEVEL_BADGE: Record<string, { label: string; className: string }> = {
  cet4: { label: "CET-4", className: "bg-emerald-50 text-emerald-700 border-emerald-100" },
  cet6: { label: "CET-6", className: "bg-indigo-50 text-indigo-700 border-indigo-100" },
};

/** 其他词库（考研/专四/专八/雅思…）用统一的中性徽章 */
function badgeOf(level: DictLevel) {
  return (
    LEVEL_BADGE[level] ?? {
      label: getBookLabel(level),
      className: "bg-slate-100 text-slate-600 border-slate-200",
    }
  );
}

function splitMeanings(translation: string): string[] {
  return translation
    .split(/[；;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** 单条释义，词库列表和卡片共用 */
export function firstMeaning(entry: DictEntry | null): string {
  if (!entry) return "";
  return splitMeanings(entry.translation)[0] ?? "";
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-semibold tracking-wide text-slate-400">{children}</p>;
}

function Examples({ items }: { items: { en: string; zh: string }[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <SectionLabel>例句</SectionLabel>
      {items.map((item, index) => (
        <div key={`${item.en}-${index}`} className="rounded-xl bg-slate-50 px-3 py-2">
          <p className="text-[13px] leading-snug text-slate-700">{item.en}</p>
          {item.zh && <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{item.zh}</p>}
        </div>
      ))}
    </div>
  );
}

function EntryCard({ entry, inflection }: { entry: DictEntry; inflection?: string }) {
  const meanings = splitMeanings(entry.translation);

  return (
    <>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {entry.levels.map((level) => {
            const badge = badgeOf(level);
            return (
              <span
                key={level}
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badge.className}`}
              >
                {badge.label}
              </span>
            );
          })}
        </div>

        <h1 className="text-3xl font-extrabold tracking-tight text-slate-800 break-words">
          {entry.word}
        </h1>

        {/* 由变形词还原出来的情况，标明来源，避免用户以为词库收的就是这个写法 */}
        {inflection && (
          <p className="text-[11px] text-slate-400">
            {inflection} · 原形 {entry.word}
          </p>
        )}

        {entry.phonetic && (
          <p className="flex items-center gap-1.5 text-sm text-slate-400 font-mono">
            <Volume2 size={14} />
            {entry.phonetic}
          </p>
        )}
      </div>

      <div className="h-px bg-slate-100 my-4" />

      {meanings.length > 0 ? (
        <ul className="space-y-2">
          {meanings.map((meaning, index) => (
            <li
              key={`${meaning}-${index}`}
              className="text-[15px] leading-relaxed text-slate-700 bg-slate-50 rounded-xl px-3 py-2"
            >
              {meaning}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-400">该词条暂无释义数据</p>
      )}

      {entry.forms && entry.forms.length > 0 && (
        <>
          <div className="h-px bg-slate-100 my-4" />
          <div className="space-y-2">
            <SectionLabel>词形变化</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {entry.forms.map((form, index) => (
                <span
                  key={`${form}-${index}`}
                  className="rounded-lg bg-slate-50 px-2 py-1 text-[11px] text-slate-600"
                >
                  {form}
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      {entry.phrases && entry.phrases.length > 0 && (
        <>
          <div className="h-px bg-slate-100 my-4" />
          <div className="space-y-2">
            <SectionLabel>常用搭配</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {entry.phrases.map((phrase, index) => (
                <span
                  key={`${phrase.en}-${index}`}
                  className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-1 text-[11px] text-slate-600"
                >
                  <span className="font-medium">{phrase.en}</span>
                  {phrase.zh && <span className="text-slate-400"> · {phrase.zh}</span>}
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      {entry.examples && entry.examples.length > 0 && (
        <>
          <div className="h-px bg-slate-100 my-4" />
          <Examples items={entry.examples} />
        </>
      )}

      {entry.examSentences && entry.examSentences.length > 0 && (
        <>
          <div className="h-px bg-slate-100 my-4" />
          <div className="space-y-2">
            <SectionLabel>真题例句</SectionLabel>
            {entry.examSentences.map((item, index) => (
              <div key={`${item.en}-${index}`} className="rounded-xl bg-emerald-50/60 px-3 py-2">
                <p className="text-[13px] leading-snug text-slate-700">{item.en}</p>
                {item.zh && (
                  <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{item.zh}</p>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function AiCard({ info }: { info: AiWordInfo }) {
  return (
    <>
      <div className="space-y-2">
        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-100">
          <Sparkles size={10} /> AI 生成
        </span>

        <h1 className="text-3xl font-extrabold tracking-tight text-slate-800 break-words">
          {info.word}
        </h1>

        {info.phonetic && (
          <p className="flex items-center gap-1.5 text-sm text-slate-400 font-mono">
            <Volume2 size={14} />
            {info.phonetic}
          </p>
        )}
      </div>

      <div className="h-px bg-slate-100 my-4" />

      <ul className="space-y-2">
        {info.meanings.map((meaning, index) => (
          <li
            key={`${meaning.cn}-${index}`}
            className="text-[15px] leading-relaxed text-slate-700 bg-slate-50 rounded-xl px-3 py-2"
          >
            {meaning.pos && <span className="text-slate-400 mr-1">{meaning.pos}</span>}
            {meaning.cn}
          </li>
        ))}
      </ul>

      {info.forms.length > 0 && (
        <div className="mt-4 space-y-2">
          <SectionLabel>词形变化</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {info.forms.map((form, index) => (
              <span
                key={`${form.label}-${index}`}
                className="text-[12px] bg-white border border-slate-200 rounded-lg px-2 py-1 text-slate-600"
              >
                <span className="text-slate-400">{form.label} </span>
                {form.value}
              </span>
            ))}
          </div>
        </div>
      )}

      {info.phrases && info.phrases.length > 0 && (
        <div className="mt-4 space-y-2">
          <SectionLabel>常用搭配</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {info.phrases.map((phrase, index) => (
              <span
                key={`${phrase.en}-${index}`}
                className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-1 text-[11px] text-slate-600"
              >
                <span className="font-medium">{phrase.en}</span>
                {phrase.zh && <span className="text-slate-400"> · {phrase.zh}</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {info.synonyms && info.synonyms.length > 0 && (
        <div className="mt-4 space-y-2">
          <SectionLabel>近义词</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {info.synonyms.map((synonym, index) => (
              <span
                key={`${synonym}-${index}`}
                className="rounded-lg bg-slate-50 px-2 py-1 text-[11px] text-slate-600"
              >
                {synonym}
              </span>
            ))}
          </div>
        </div>
      )}

      {info.examples.length > 0 && (
        <div className="mt-4">
          <Examples items={info.examples} />
        </div>
      )}

      <p className="mt-4 text-[11px] text-slate-400">由 AI 生成，仅供参照。</p>
    </>
  );
}

function NotFoundCard({
  word,
  state,
}: {
  word: string;
  state: "off" | "error" | "empty";
}) {
  return (
    <div className="text-center space-y-3 py-2">
      <BookX size={36} className="mx-auto text-slate-300" />
      <h1 className="text-xl font-bold text-slate-800 break-words">{word}</h1>
      <p className="text-sm text-slate-500 leading-relaxed">
        离线词库暂未收录该词。
        <br />
        目前覆盖 CET-4 与 CET-6 核心词汇。
      </p>
      {state === "off" && (
        <p className="text-[11px] text-slate-400">需要先在「设置」里填写 API Key，并开启 AI 补全。</p>
      )}
      {state === "error" && (
        <p className="text-[11px] text-red-500">AI 查询失败，检查网络或 API Key。</p>
      )}
      {state === "empty" && (
        <p className="text-[11px] text-slate-400">AI 也认为这不是一个英文单词。</p>
      )}
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="h-4 w-16 bg-slate-100 rounded" />
      <div className="h-8 w-40 bg-slate-100 rounded" />
      <div className="h-10 w-full bg-slate-100 rounded-xl" />
      <p className="flex items-center justify-center gap-1.5 pt-2 text-[11px] text-slate-400">
        <Loader2 size={12} className="animate-spin" /> AI 正在补全这个词…
      </p>
    </div>
  );
}

type AiState =
  | { state: "off" }
  | { state: "loading" }
  | { state: "done"; info: AiWordInfo }
  | { state: "error" };

/**
 * 单词卡片：词库页弹层、查词页共用。
 *
 * 1. 先走本地词库（resolveWord 会还原时态/单复数等变形）。
 * 2. 查不到且设置里开了「AI 补全」→ 请求 DeepSeek，把结果渲染成同一张卡。
 */
export default function WordCard({
  word,
  forceAi = false,
  className = "",
}: {
  word: string;
  /** 无视本地词库、直接问 AI（词库页的「AI」按钮用这个） */
  forceAi?: boolean;
  className?: string;
}) {
  const resolution = forceAi ? null : resolveWord(word);
  const hasLocal = resolution !== null;
  const [ai, setAi] = useState<AiState>({ state: "off" });

  useEffect(() => {
    if (hasLocal) return;

    // 用户主动点了 AI 按钮，就不再受「AI 补全」开关限制，但 API Key 仍然必须有
    if ((!isAiLookupEnabled() && !forceAi) || !getApiKey()) {
      setAi({ state: "off" });
      return;
    }

    let alive = true;
    setAi({ state: "loading" });

    fetchAiWord(word)
      .then((info) => {
        if (alive) setAi({ state: "done", info });
      })
      .catch(() => {
        if (alive) setAi({ state: "error" });
      });

    return () => {
      alive = false;
    };
  }, [word, hasLocal, forceAi]);

  let body: React.ReactNode;

  if (resolution) {
    body = (
      <EntryCard
        entry={resolution.entry}
        inflection={resolution.matchedWord !== resolution.query ? resolution.query : undefined}
      />
    );
  } else if (ai.state === "loading") {
    body = <CardSkeleton />;
  } else if (ai.state === "done") {
    body =
      ai.info.meanings.length > 0 ? (
        <AiCard info={ai.info} />
      ) : (
        <NotFoundCard word={word} state="empty" />
      );
  } else {
    body = <NotFoundCard word={word} state={ai.state === "error" ? "error" : "off"} />;
  }

  return (
    <div className={`bg-white rounded-3xl p-6 shadow-sm border border-slate-100 ${className}`}>
      {body}
    </div>
  );
}
