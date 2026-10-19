"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import OpenAI from "openai";
import { db, type NoteTurn } from "./db";
import {
  Send,
  Settings,
  BookOpen,
  Loader2,
  Sparkles,
  CheckCircle2,
  Key,
  RotateCcw,
  XCircle,
  Lightbulb,
  Undo2,
  Library,
  Trash2,
  UserRound,
} from "lucide-react";
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import {
  dictLabel,
  getSystemPrompt,
  TURNS_PER_ROUND,
  type UserLevel,
} from "../lib/prompts";
import { buildPracticeFocus, collectPairs, computeProfile, formatProfile, ERROR_TYPES } from "../lib/profile";
import { buildVocabularyReport } from "../lib/wordStats";
import type { DictLevel } from "../lib/dictionary";
import {
  createToolBudget,
  DICTIONARY_TOOLS,
  executeDictionaryTool,
} from "../lib/dictionaryTools";
import {
  generateScenario,
  isAiScenarioEnabled,
  pickScenario,
} from "../lib/scenarios";
import {
  readChatState,
  writeChatState,
  type ChatMessage,
  type ChatResponse,
} from "../lib/chatStore";
import AppHeader from "../components/AppHeader";
import LevelPill from "../components/LevelPill";

/** 工具调用最多来回几轮（每轮可以包含多次工具调用） */
const MAX_TOOL_ROUNDS = 3;

/** 输入框最多撑到 4 行：4 × 24px 行高 + 上下内边距 */
const TEXTAREA_LINE_HEIGHT = 24;
const TEXTAREA_MAX_HEIGHT = TEXTAREA_LINE_HEIGHT * 4 + 20;

/** 对话超过这么多条就冒出「清空对话」的悬浮按钮 */
const CLEAR_THRESHOLD = 12;

/** 模型偶尔会裹代码块或带前言，这里做一次容错解析 */
function parseModelJson(content: string): Record<string, unknown> {
  const trimmed = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  const body = start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
  return JSON.parse(body || "{}") as Record<string, unknown>;
}

export default function Page() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  // 首屏从模块级 store 取，切页面回来不丢；App 重启时 store 是空的
  const [history, setHistory] = useState<ChatMessage[]>(() => readChatState().history);
  const [turnCount, setTurnCount] = useState(() => readChatState().turnCount);
  const [scenario, setScenario] = useState("");
  const [scenarioLoading, setScenarioLoading] = useState(false);
  // 触屏设备没有 Shift 键，Enter 必须留给换行；桌面端才用 Enter 发送
  const [enterToSend, setEnterToSend] = useState(true);

  // 当前等级状态
  const [level, setLevel] = useState<UserLevel>(() => readChatState().level);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  // 同步的「请求进行中」标记：loading 是异步 state，连点两次发送会各发一份请求，
  // 回来后历史里就会出现两条 ai 消息，把「user + ai」的配对彻底打乱。
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history, loading]);

  useEffect(() => {
    setScenario(pickScenario());
  }, []);

  // 判断主输入方式：触屏（pointer: coarse）就把 Enter 让给换行。
  // 部分 WebView 对 pointer 媒体查询支持不全，所以再加一条「有触点且没有精确指针」的兜底。
  useEffect(() => {
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const touchOnly =
      navigator.maxTouchPoints > 0 && !window.matchMedia("(pointer: fine)").matches;
    setEnterToSend(!(coarse || touchOnly));
  }, []);

  // 对话状态写回模块级 store：切到词库/笔记再回来不丢，App 重启才清空
  useEffect(() => {
    writeChatState({ history, turnCount, level });
  }, [history, turnCount, level]);

  // 输入框自适应高度：1 行起，最高 4 行，超过就内部滚动
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;

    el.style.height = "0px";
    const next = Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > TEXTAREA_MAX_HEIGHT ? "auto" : "hidden";
  }, [input]);

  // 刷新提示：默认本地题库，开了 AI 开关就让模型现出
  const handleRefreshScenario = async () => {
    if (scenarioLoading) return;

    const apiKey = localStorage.getItem("deepseek_api_key");
    if (isAiScenarioEnabled() && apiKey) {
      setScenarioLoading(true);
      try {
        setScenario(await generateScenario(apiKey, scenario));
      } catch {
        setScenario(pickScenario(scenario));
      } finally {
        setScenarioLoading(false);
      }
      return;
    }

    setScenario(pickScenario(scenario));
  };

  // 切换等级时，清空当前对话，重新开始
  const handleLevelChange = (newLevel: UserLevel) => {
    if (loading) return;
    setLevel(newLevel);
    setHistory([]);
    setTurnCount(1);
  };

  // 手动清空对话（只清聊天，已存笔记不受影响）
  const handleClearHistory = () => {
    if (loading) return;
    if (!window.confirm("清空当前对话记录？已存入的笔记不受影响。")) return;
    setHistory([]);
    setTurnCount(1);
    setInput("");
  };

  const performRequest = async (
    userText: string,
    currentHistory: ChatMessage[],
    currentTurn: number,
  ) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    setLoading(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const apiKey = localStorage.getItem("deepseek_api_key");
      if (!apiKey) throw new Error("No API Key");

      const openai = new OpenAI({
        apiKey: apiKey,
        baseURL: "https://api.deepseek.com",
        dangerouslyAllowBrowser: true,
      });

      // 本地画像 + 词汇统计：从已存笔记 + 当前会话算，全部在内存里完成
      const cards = await db.cards.toArray();
      const pairs = collectPairs(cards, currentHistory);
      // 统计基于用户原句（不是 AI 改写句），否则「AI 改得越多 → 分越低」
      const vocabReport = buildVocabularyReport(pairs.map((pair) => pair.text));
      const profile = computeProfile(cards, currentHistory, vocabReport);
      const profileText = formatProfile(profile, dictLabel(level));
      const practiceFocus = buildPracticeFocus(profile);

      const systemPrompt = getSystemPrompt(currentTurn, level, profileText, practiceFocus);

      const messages: ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
      ];

      currentHistory.forEach((msg) => {
        if (msg.role === "user") {
          messages.push({ role: "user", content: msg.content });
        } else if (msg.role === "ai") {
          messages.push({
            role: "assistant",
            content: `优化后：${msg.content.corrected}。锚点词：${msg.content.anchors.join(", ")}`,
          });
        }
        // role === "system" 只是界面上的提示，不进上下文
      });
      messages.push({ role: "user", content: userText });

      // 四六级模式挂上词库工具：模型自己造句 → 查关键词 → 定稿
      const useTools = level !== "daily";
      const toolBudget = useTools ? createToolBudget(level as DictLevel, vocabReport) : null;

      const baseParams: ChatCompletionCreateParamsNonStreaming = {
        model: "deepseek-chat",
        messages,
        temperature: 0.7,
      };

      const create = (params: ChatCompletionCreateParamsNonStreaming) =>
        openai.chat.completions.create(params, { signal: controller.signal });

      let completion = await create(
        useTools
          ? { ...baseParams, tools: DICTIONARY_TOOLS, tool_choice: "auto" }
          : { ...baseParams, response_format: { type: "json_object" } },
      );

      // 工具往返：模型要查词 → 本地执行 → 结果塞回对话 → 再问一次
      let toolRounds = 0;
      while (
        useTools &&
        completion.choices[0]?.finish_reason === "tool_calls" &&
        toolRounds < MAX_TOOL_ROUNDS
      ) {
        const assistant = completion.choices[0].message;

        // 只认 function 类型的工具调用（我们只注册了 function 工具）
        const functionCalls = (assistant.tool_calls ?? []).filter(
          (call): call is ChatCompletionMessageFunctionToolCall => call.type === "function",
        );

        messages.push({
          role: "assistant",
          content: assistant.content ?? "",
          tool_calls: functionCalls.map((call) => ({
            id: call.id,
            type: "function" as const,
            function: { name: call.function.name, arguments: call.function.arguments },
          })),
        });

        for (const call of functionCalls) {
          const result = toolBudget
            ? executeDictionaryTool(call.function.name, call.function.arguments, toolBudget)
            : JSON.stringify({ error: "当前等级不提供词库工具" });
          messages.push({ role: "tool", tool_call_id: call.id, content: result });
        }

        toolRounds += 1;
        const forceFinal = toolRounds >= MAX_TOOL_ROUNDS;

        completion = await create(
          forceFinal
            ? { ...baseParams, response_format: { type: "json_object" } }
            : { ...baseParams, tools: DICTIONARY_TOOLS, tool_choice: "auto" },
        );
      }

      let finalContent = completion.choices[0]?.message?.content ?? "";

      // 轮次用尽但模型还在要工具：强制它给最终 JSON
      if (useTools && !finalContent.trim()) {
        completion = await create({
          ...baseParams,
          tools: DICTIONARY_TOOLS,
          tool_choice: "none",
          response_format: { type: "json_object" },
        });
        finalContent = completion.choices[0]?.message?.content ?? "";
      }

      if (!finalContent.trim()) throw new Error("模型没有返回内容");

      const rawData = parseModelJson(finalContent);

      // 数据清洗，防止大模型套娃
      const data: ChatResponse = {
        corrected:
          typeof rawData.corrected === "string"
            ? rawData.corrected
            : JSON.stringify(rawData.corrected ?? ""),
        translation: typeof rawData.translation === "string" ? rawData.translation : "",
        anchorAnalysis:
          typeof rawData.anchorAnalysis === "string" ? rawData.anchorAnalysis : "",
        grammar: typeof rawData.grammar === "string" ? rawData.grammar : "",
        why: typeof rawData.why === "string" ? rawData.why : "",
        guide: typeof rawData.guide === "string" ? rawData.guide : null,
        summary: rawData.summary
          ? typeof rawData.summary === "string"
            ? rawData.summary
            : JSON.stringify(rawData.summary, null, 2)
          : null,
        anchors: Array.isArray(rawData.anchors) ? rawData.anchors.map((a) => String(a)) : [],
        isThird: rawData.isThird === true,
        // 错误类型只收受控词表里的，防模型自由发挥把画像统计搞脏
        errorTypes: Array.isArray(rawData.errorTypes)
          ? rawData.errorTypes
              .map((item) => String(item))
              .filter((item) => (ERROR_TYPES as readonly string[]).includes(item))
              .slice(0, 4)
          : [],
        difficulty:
          typeof rawData.difficulty === "number"
            ? Math.min(5, Math.max(1, Math.round(rawData.difficulty)))
            : undefined,
      };

      // ===== 客户端兜底：这三件事不能全信模型 =====
      // 1) 轮次由前端决定。模型早一轮返回 isThird=true，就会存出只有 1~2 句的残卡。
      const isLastTurn = currentTurn >= TURNS_PER_ROUND;
      // 2) 锚点必须真的逐字出现在 corrected 里，否则点开是一张对不上的卡片。
      const verifiedAnchors = data.anchors
        .map((anchor) => anchor.trim())
        .filter((anchor) => anchor && data.corrected.toLowerCase().includes(anchor.toLowerCase()))
        .slice(0, 4);
      // 3) summary 只在最后一句才有意义。
      const finalData: ChatResponse = {
        ...data,
        anchors: verifiedAnchors,
        isThird: isLastTurn,
        summary: isLastTurn ? data.summary : null,
      };

      // 必须把本轮的用户消息一起写回：
      // currentHistory 是「发送前」的历史，不包含 userText。
      // 之前只 push 了 ai，导致 handleSend 刚加进去的用户消息被整个覆盖，
      // state 里只剩 AI 消息 —— 卡片随之拼出「空原句」。
      const baseHistory: ChatMessage[] = [
        ...currentHistory,
        { role: "user", content: userText },
        { role: "ai", content: finalData },
      ];

      let savedOk = false;

      if (isLastTurn) {
        try {
          // 按「user + 紧随其后的 ai」配对，取最近 3 组。
          // 不能用固定下标：重复提交 / 重试 / 撤回都会让消息数组错位，
          // 之前就是靠 textAt(0)/aiAt(1) 硬取，错位后会出现「有翻译但原句为空」的坏卡片。
          const turns = buildTurns(currentHistory, userText, finalData);
          await db.cards.add({
            createdAt: Date.now(),
            turn1: turns[0],
            turn2: turns[1],
            turn3: turns[2],
            // 模型没给总结也要存，否则这一轮就白练了
            summary: finalData.summary ?? "（本轮模型没有返回总结）",
            isMastered: false,
          });
          savedOk = true;
        } catch (err) {
          console.error("存入数据库失败", err);
        }
      }

      // 存成功才在聊天区留一条提示（存失败就别谎报）
      setHistory(
        savedOk
          ? [...baseHistory, { role: "system", content: "本组对话已保存" }]
          : baseHistory,
      );
      setTurnCount(isLastTurn ? 1 : currentTurn + 1);
    } catch (error: unknown) {
      const err = error as { name?: string; message?: string };
      if (err?.name === "AbortError" || err?.message?.includes("abort")) {
        // currentHistory 里没有本轮的用户消息，直接回滚到它即可，
        // 不能再 slice(0, -1)（那会把上一轮的 AI 回复也切掉）。
        setHistory(currentHistory);
        return;
      }
      console.error(error);
      alert("请求失败，请检查 Key 或网络。可点击重试。");
    } finally {
      inFlightRef.current = false;
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const apiKey = localStorage.getItem("deepseek_api_key");
    if (!apiKey) {
      alert("请先去设置页填写 API Key！");
      router.push("/settings");
      return;
    }
    const currentInput = input;
    setInput("");
    const newHistory: ChatMessage[] = [
      ...history,
      { role: "user", content: currentInput },
    ];
    setHistory(newHistory);
    await performRequest(currentInput, history, turnCount);
  };

  const handleCancel = () => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
  };

  const handleRetry = () => {
    const lastUserMsg = [...history].reverse().find((msg) => msg.role === "user");
    if (lastUserMsg) performRequest(lastUserMsg.content, history.slice(0, -1), turnCount);
  };

  const handleUndo = () => {
    if (history.length === 0 || loading) return;
    const lastUserMsgIndex = history.map((m) => m.role).lastIndexOf("user");
    if (lastUserMsgIndex === -1) return;
    const target = history[lastUserMsgIndex];
    if (target.role === "user") setInput(target.content);
    setHistory(history.slice(0, lastUserMsgIndex));
    setTurnCount(Math.ceil((lastUserMsgIndex + 1) / 2));
  };

  return (
    <main className="relative w-full max-w-md mx-auto md:max-w-2xl lg:max-w-4xl h-[100dvh] flex flex-col bg-slate-50 font-sans">
      <AppHeader
        title={
          <span className="flex items-center gap-2">
            <span className="text-xl font-extrabold tracking-tight text-slate-800">
              Threenglish
            </span>
            <span className="bg-indigo-100 text-indigo-700 text-xs font-bold px-2 py-0.5 rounded-full">
              {turnCount}/3
            </span>
          </span>
        }
        rightNode={
          <>
            <Link href="/words" className="p-1 active:scale-95 transition-transform" aria-label="词库">
              <Library size={22} />
            </Link>
            <Link href="/notes" className="p-1 active:scale-95 transition-transform" aria-label="我的笔记">
              <BookOpen size={22} />
            </Link>
            <Link href="/profile" className="p-1 active:scale-95 transition-transform" aria-label="学习者画像">
              <UserRound size={22} />
            </Link>
            <Link href="/settings" className="p-1 active:scale-95 transition-transform" aria-label="设置">
              <Settings size={22} />
            </Link>
          </>
        }
      />

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 space-y-6 overscroll-contain">
        {history.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-4">
            <Sparkles size={40} className="text-indigo-300" />
            <p className="text-sm font-medium">把脑海里的画面，直接用英文扔过来</p>

            {/* 提示区：点一下换一条；开了 AI 开关就由模型现出 */}
            <button
              type="button"
              onClick={handleRefreshScenario}
              disabled={scenarioLoading}
              className="mt-4 max-w-full px-4 py-2 bg-indigo-50 text-indigo-600 rounded-2xl text-sm font-medium border border-indigo-100 active:scale-95 transition-transform flex items-center gap-2 disabled:opacity-60"
            >
              {scenarioLoading ? (
                <Loader2 size={16} className="animate-spin shrink-0" />
              ) : (
                <Lightbulb size={16} className="shrink-0" />
              )}
              <span className="truncate">{scenario || "换一条提示"}</span>
              <RotateCcw size={12} className="shrink-0 opacity-60" />
            </button>
            <p className="text-[11px] text-slate-300">点一下换一条</p>
          </div>
        ) : (
          history.map((msg, i) => {
            if (msg.role === "user") {
              return (
                <div key={i} className="flex justify-end animate-in fade-in slide-in-from-bottom-2">
                  <div className="bg-indigo-600 text-white px-4 py-2.5 rounded-2xl rounded-tr-sm max-w-[85%] text-[15px] shadow-sm leading-relaxed">
                    {msg.content}
                  </div>
                </div>
              );
            }

            // 系统提示（如「本组对话已保存」）居中显示成一条小胶囊
            if (msg.role === "system") {
              return (
                <div key={i} className="flex justify-center">
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] text-slate-400">
                    {msg.content}
                  </span>
                </div>
              );
            }

            const aiData = msg.content;
            return (
              <div key={i} className="flex justify-start animate-in fade-in slide-in-from-bottom-2">
                <div className="bg-white px-4 py-3.5 rounded-2xl rounded-tl-sm shadow-sm border border-slate-100 max-w-[90%] w-full space-y-3">
                  <div>
                    <div className="flex items-center gap-1.5 text-emerald-600 text-xs font-bold mb-1">
                      <CheckCircle2 size={14} /> 优化表达
                    </div>
                    <p className="text-slate-800 text-[16px] font-medium leading-snug">
                      {aiData.corrected || "..."}
                    </p>
                    {aiData.translation && (
                      <p className="text-slate-400 text-xs mt-1">{aiData.translation}</p>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center gap-1.5 text-purple-600 text-xs font-bold mb-1.5">
                      <Key size={14} /> 锚点词
                    </div>
                    <div className="flex flex-wrap gap-1.5 mb-1">
                      {aiData.anchors.map((anchor, idx) => (
                        <span
                          key={idx}
                          className="bg-purple-50 text-purple-700 border border-purple-100 px-2 py-0.5 rounded-md text-xs font-medium"
                        >
                          {anchor}
                        </span>
                      ))}
                    </div>
                    {aiData.anchorAnalysis && (
                      <p className="text-xs text-purple-600/80 mt-1 leading-relaxed">
                        💡 {aiData.anchorAnalysis}
                      </p>
                    )}
                  </div>

                  <div className="bg-slate-50 rounded-xl p-3 text-sm text-slate-600 space-y-1.5">
                    <p>
                      <span className="font-semibold text-slate-700">语法：</span>
                      {aiData.grammar || "..."}
                    </p>
                    <p>
                      <span className="font-semibold text-slate-700">为啥换：</span>
                      {aiData.why || "..."}
                    </p>
                  </div>

                  {aiData.guide && (
                    <div className="mt-2 text-sm text-indigo-600 font-medium bg-indigo-50/50 p-2 rounded-lg border border-indigo-100/50">
                      💬 {aiData.guide}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-white px-4 py-3 rounded-2xl rounded-tl-sm shadow-sm border border-slate-100 flex items-center gap-3 text-slate-400 text-sm">
              <Loader2 size={16} className="animate-spin" /> AI 正在思考...
              <button
                onClick={handleCancel}
                className="text-xs bg-slate-100 text-slate-500 px-2 py-1 rounded-md active:scale-95 flex items-center gap-1"
              >
                <XCircle size={12} /> 取消
              </button>
            </div>
          </div>
        )}

        {!loading && history.length > 0 && history[history.length - 1].role === "user" && (
          <div className="flex justify-start">
            <button
              onClick={handleRetry}
              className="bg-red-50 text-red-600 px-4 py-2 rounded-xl text-sm font-medium border border-red-100 active:scale-95 flex items-center gap-2"
            >
              <RotateCcw size={16} /> 请求中断，点击重试
            </button>
          </div>
        )}
      </div>

      {/* 对话长了就冒出来，浮在头部下方，不挡最新消息 */}
      {history.length > CLEAR_THRESHOLD && (
        <button
          type="button"
          onClick={handleClearHistory}
          className="absolute right-3 top-[calc(env(safe-area-inset-top)+4.25rem)] z-10 flex items-center gap-1 rounded-full border border-slate-200 bg-white/95 px-3 py-1.5 text-[11px] font-medium text-slate-500 shadow-sm backdrop-blur active:scale-95 transition-transform"
        >
          <Trash2 size={12} /> 清空对话
        </button>
      )}

      <div className="p-3 bg-white border-t border-slate-200 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        {/* 难度胶囊：默认只占一行小胶囊，点开切换 */}
        <div className="flex items-center justify-between px-1 pb-2">
          <LevelPill level={level} onChange={handleLevelChange} disabled={loading} />
          <span className="text-[11px] text-slate-400">第 {turnCount} / 3 句</span>
        </div>

        <div className="flex items-end gap-2 bg-slate-100 p-1 rounded-2xl border border-slate-200 focus-within:border-indigo-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-indigo-100 transition-all">
          <button
            onClick={handleUndo}
            disabled={loading || history.length === 0}
            className="p-2.5 text-slate-400 hover:text-slate-600 disabled:opacity-30 shrink-0 transition-colors"
            title="撤回上一条"
          >
            <Undo2 size={18} />
          </button>
          {/* textarea 自撑高：1 行起，最高 4 行，再多就内部滚动 */}
          <textarea
            ref={inputRef}
            rows={1}
            className="flex-1 bg-transparent px-1 py-2.5 text-[15px] leading-6 focus:outline-none resize-none overflow-hidden max-h-[116px]"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // 桌面端：Enter 发送、Shift+Enter 换行
              // 触屏端：没有 Shift，Enter 一律当换行，发送只走按钮
              if (enterToSend && e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            enterKeyHint={enterToSend ? "send" : "enter"}
            placeholder={enterToSend ? "输入英文...（Enter 发送，Shift+Enter 换行）" : "输入英文..."}
            disabled={loading}
          />
          <button
            className="bg-indigo-600 text-white p-2.5 rounded-xl active:scale-90 transition-transform disabled:opacity-50 shrink-0"
            onClick={handleSend}
            disabled={loading || !input.trim()}
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </main>
  );
}

/* ---------- 纯函数 helper：把历史消息拼成笔记快照 ---------- */

const EMPTY_TURN: NoteTurn = {
  text: "",
  translation: "",
  corrected: "",
  anchors: [],
  anchorAnalysis: "",
};

function toTurn(text: string, ai: ChatResponse | null): NoteTurn {
  return {
    text,
    translation: ai?.translation ?? "",
    corrected: ai?.corrected ?? "",
    anchors: ai?.anchors ?? [],
    anchorAnalysis: ai?.anchorAnalysis ?? "",
    // 顺手把错误类型存进笔记，画像是靠它聚合的
    errorTypes: ai?.errorTypes ?? [],
  };
}

/**
 * 从历史里还原「每轮训练的三句」。
 *
 * 关键是按相邻关系配对：一条 user 后面紧跟的 ai 才算它自己的回复。
 * 之前用固定下标（0/1、2/3）硬取，一旦因为重复提交、重试、撤回导致数组错位，
 * 就会拼出「原句为空但翻译有值」的坏卡片。
 *
 * 只取最近 3 组；不足 3 组用空 turn 补在后面，保证卡片结构完整。
 */
function buildTurns(
  history: ChatMessage[],
  finalText: string,
  finalAi: ChatResponse,
): [NoteTurn, NoteTurn, NoteTurn] {
  const pairs: NoteTurn[] = [];

  for (let i = 0; i < history.length; i++) {
    const current = history[i];
    if (current.role !== "user") continue;

    const next = history[i + 1];
    pairs.push(toTurn(current.content, next && next.role === "ai" ? next.content : null));
  }

  // 本轮最后一句还没写进 history，单独补上
  pairs.push(toTurn(finalText, finalAi));

  const recent = pairs.slice(-3);
  while (recent.length < 3) recent.unshift(EMPTY_TURN);

  return [recent[0], recent[1], recent[2]];
}
