"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { Activity, BookOpen, ChevronRight, Target, Turtle } from "lucide-react";
import { db } from "../db";
import { readChatState } from "../../lib/chatStore";
import { BAND_NAMES, collectPairs, computeProfile, ERROR_LABEL } from "../../lib/profile";
import { getBookLabel } from "../../lib/dictCatalog";
import { buildVocabularyReport } from "../../lib/wordStats";
import AppHeader from "../../components/AppHeader";

function Meter({
  label,
  value,
  max = 100,
  hint,
  tone = "indigo",
}: {
  label: string;
  value: number;
  max?: number;
  hint?: string;
  tone?: "indigo" | "emerald" | "amber" | "slate";
}) {
  const percent = Math.min(100, Math.max(0, (value / max) * 100));
  const color =
    tone === "emerald"
      ? "bg-emerald-500"
      : tone === "amber"
        ? "bg-amber-500"
        : tone === "slate"
          ? "bg-slate-400"
          : "bg-indigo-500";

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-slate-500">{label}</span>
        <span className="text-xs font-semibold text-slate-700 tabular-nums">
          {hint ?? `${Math.round(value)}%`}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 px-3 py-2.5 text-center">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-slate-800 tabular-nums">{value}</p>
    </div>
  );
}

function LevelTag({ levels }: { levels: string[] }) {
  const has4 = levels.includes("cet4");
  const has6 = levels.includes("cet6");
  const label = has4 && has6 ? "4·6" : has4 ? "4" : has6 ? "6" : "—";
  const tone =
    has4 && has6
      ? "bg-violet-50 text-violet-600"
      : has4
        ? "bg-indigo-50 text-indigo-600"
        : has6
          ? "bg-emerald-50 text-emerald-600"
          : "bg-slate-100 text-slate-400";

  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${tone}`}>{label}</span>;
}

export default function ProfilePage() {
  const cards = useLiveQuery(() => db.cards.toArray(), []);

  const { profile, report } = useMemo(() => {
    const history = readChatState().history;
    const allCards = cards ?? [];
    const pairs = collectPairs(allCards, history);
    // 统计基于用户原句，不是 AI 改写句
    const vocabReport = buildVocabularyReport(pairs.map((pair) => pair.text));
    return {
      profile: computeProfile(allCards, history, vocabReport),
      report: vocabReport,
    };
  }, [cards]);

  const isEmpty = profile.sentences === 0;
  const maxError = Math.max(1, ...profile.errors.map((item) => item.count));
  const maxUsage = Math.max(1, ...report.usage.slice(0, 10).map((item) => item.count));

  return (
    <main className="w-full max-w-md mx-auto md:max-w-2xl lg:max-w-4xl h-[100dvh] flex flex-col bg-slate-50 font-sans">
      <AppHeader title="我的画像" showBack backHref="/" />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 overscroll-contain pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        {/* 综合档位 */}
        <section className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-slate-400">综合档位</p>
              <p className="mt-1 flex items-baseline gap-2">
                <span className="text-4xl font-extrabold tracking-tight text-slate-800">
                  {profile.band}
                </span>
                <span className="text-xs text-slate-400 tabular-nums">{profile.ability}/100</span>
              </p>
            </div>
            <div className="text-right">
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-600">
                <Activity size={12} /> 置信度 {profile.confidence}
              </span>
              <p className="mt-1.5 flex items-center justify-end gap-1 text-[11px] text-slate-400">
                <Target size={11} /> 目标 {profile.targetBand}
              </p>
            </div>
          </div>

          <div className="mt-4">
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-indigo-600"
                style={{ width: `${Math.min(100, profile.ability)}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[9px] text-slate-300">
              {BAND_NAMES.map((band) => (
                <span key={band}>{band}</span>
              ))}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 lg:grid-cols-3">
            <Stat label="词汇" value={profile.subBands.vocab} />
            <Stat label="句法" value={profile.subBands.syntax} />
            <Stat label="准确度" value={profile.subBands.accuracy} />
          </div>

          {profile.capped && (
            <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-700">
              单项表现不错，但样本还不够，综合档位先封顶。多练几句就会放开。
            </p>
          )}

          <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
            {isEmpty
              ? "还没有练习数据。练几句之后这里会开始积累。"
              : `基于最近 ${profile.sentences} 句：词汇档看高阶词占比，句法档看复杂结构数，准确度看每百词错误数。`}
          </p>
        </section>

        {/* 用词分布 */}
        <section className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-bold text-slate-800">用词分布</h2>
            <span className="text-[11px] text-slate-400">
              去重 {profile.vocabSize.unique} 个词
            </span>
          </div>
          {profile.vocab.tiers.map((tier) => (
            <Meter
              key={tier.rank}
              label={tier.label}
              value={tier.percent}
              tone={tier.rank >= 4 ? "amber" : tier.rank >= 3 ? "emerald" : "indigo"}
            />
          ))}
          <Meter label="表外 / 超出所有词库" value={profile.vocab.outside} tone="slate" />
          <p className="text-[11px] leading-relaxed text-slate-400">
            按词库等级分档，一个词若被多本词库收录，按最低等级算（例如初中和四级都有，就算初中）。
            功能词（the / is / to）不参与统计。
          </p>
        </section>

        {/* 词库覆盖 */}
        <section className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm space-y-3">
          <h2 className="text-sm font-bold text-slate-800">词库覆盖率</h2>
          {Object.entries(profile.coverage).map(([id, percent]) => (
            <Meter key={id} label={getBookLabel(id)} value={percent} tone="emerald" />
          ))}
          <div className="space-y-1.5 text-[11px] leading-relaxed text-slate-400">
            <p>
              按推断的词汇量估算，不是只统计你实际用过几个词 —— 所以练几句也能看到大致覆盖。
            </p>
            <p>
              · 已主动使用 <b className="text-slate-600">{profile.vocabSize.unique}</b> 个不同的词
              （事实，不含功能词）
            </p>
            {profile.vocabSize.tierFloor !== null ? (
              <p>
                · 按用词等级推断，至少认识{" "}
                <b className="text-slate-600">{profile.vocabSize.tierFloor}</b>{" "}
                个词（会用这一档的词，说明底下那批基础词大概率也会）
              </p>
            ) : (
              <p>· 还看不出用词等级，多写几句再估</p>
            )}
            <p>
              · 样本覆盖率 {profile.vocabSize.coveragePercent}%
              {profile.vocabSize.coveragePercent < 30
                ? "，说明还有不少新词没出现，继续写会更准"
                : "，这几次练习的用词已经比较稳定"}
            </p>
          </div>
        </section>

        {/* 高频用词 */}
        <section className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-bold text-slate-800">最常用的词</h2>
            <span className="text-[11px] text-slate-400">共 {report.usage.length} 个</span>
          </div>

          {report.usage.length === 0 ? (
            <p className="text-[11px] leading-relaxed text-slate-400">
              还没有用词数据，练一组后这里会列出来。
            </p>
          ) : (
            <div className="space-y-2">
              {report.usage.slice(0, 10).map((item) => (
                <div key={item.word} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 truncate text-xs text-slate-700">{item.word}</span>
                  <LevelTag levels={item.levels} />
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-indigo-400"
                      style={{ width: `${(item.count / maxUsage) * 100}%` }}
                    />
                  </div>
                  <span className="w-6 shrink-0 text-right text-[11px] text-slate-400 tabular-nums">
                    {item.count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 句法 */}
        <section className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm space-y-3">
          <h2 className="text-sm font-bold text-slate-800">句法（每句）</h2>
          <div className="grid grid-cols-3 gap-2 lg:grid-cols-3">
            <Stat label="从句" value={profile.syntax.clause.toFixed(1)} />
            <Stat label="非谓语" value={profile.syntax.nonfinite.toFixed(1)} />
            <Stat label="被动" value={profile.syntax.passive.toFixed(1)} />
          </div>
          <Meter
            label="平均改写幅度"
            value={profile.rewriteDistance}
            max={1}
            hint={`${profile.rewriteDistance}`}
            tone="amber"
          />
        </section>

        {/* 错误画像 */}
        <section className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-800">高频错误</h2>
            {profile.errors.length === 0 && (
              <span className="text-[11px] text-slate-400">暂无数据</span>
            )}
          </div>

          {profile.errors.length === 0 ? (
            <p className="text-[11px] leading-relaxed text-slate-400">
              模型每次会标注错误类型，练满一轮后这里会出现分布。
            </p>
          ) : (
            <div className="space-y-2.5">
              {profile.errors.map((item) => (
                <div key={item.type} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-600">{ERROR_LABEL[item.type] ?? item.type}</span>
                    <span className="text-slate-400 tabular-nums">×{item.count}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-rose-400"
                      style={{ width: `${(item.count / maxError) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 练习量 */}
        <section className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold text-slate-800">练习记录</h2>
          <div className="mt-3 grid grid-cols-3 gap-2 lg:grid-cols-3">
            <Stat label="笔记组" value={String(profile.totalCards)} />
            <Stat label="已掌握" value={String(profile.mastered)} />
            <Stat label="分析句数" value={String(profile.sentences)} />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Stat label="最近 30 天" value={`${profile.activity.month} 组`} />
            <Stat label="最近一年" value={`${profile.activity.year} 组`} />
          </div>
          <Link
            href="/notes"
            className="mt-3 flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2.5 text-xs text-slate-500 active:scale-[0.99] transition-transform"
          >
            <span className="flex items-center gap-1.5">
              <BookOpen size={14} /> 去笔记页看看
            </span>
            <ChevronRight size={14} />
          </Link>
        </section>

        <p className="flex items-center justify-center gap-1.5 pt-1 text-[11px] text-slate-300">
          <Turtle size={12} /> 数据只在本机，用来让 AI 出更合适的句子
        </p>
      </div>
    </main>
  );
}
