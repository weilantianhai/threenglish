// lib/scenarios.ts
// 场景提示：默认从本地题库抽，开了 AI 开关后由模型现出题。

import OpenAI from "openai";

export const SCENARIOS: string[] = [
  "描述一下你现在的桌面...",
  "你今天早饭吃了什么？",
  "你手机屏幕上有什么？",
  "描述一下你窗外的天气...",
  "你今天是怎么来上班 / 上学的？",
  "你最近一次笑出声是因为什么？",
  "你今天穿的衣服是什么样子？",
  "你房间里最乱的地方在哪？",
  "你最近在看什么剧或者视频？",
  "形容一下你昨天的晚饭。",
  "你现在最想去哪个城市，为什么？",
  "你手机电量还剩多少？怎么用的？",
  "描述一下你昨天做过的一件小事。",
  "你上一次和朋友聊天聊了什么？",
  "说说你今天的心情，用一个比喻。",
  "你家附近有什么店？哪家你常去？",
  "你最近买到的最满意的东西是什么？",
  "如果你明天放假一天，你会做什么？",
  "描述一下你 Ideal 的周末。",
  "你今天遇到的最烦的一件事？",
  "你最近学会的一个小技能是什么？",
  "形容一下你现在的坐姿和姿势。",
  "你最近睡眠怎么样？为什么？",
  "说说你小时候最怕的东西。",
];

const SCENARIO_AI_KEY = "ai_scenario_enabled";

export function isAiScenarioEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(SCENARIO_AI_KEY) === "1";
}

export function setAiScenarioEnabled(enabled: boolean): void {
  window.localStorage.setItem(SCENARIO_AI_KEY, enabled ? "1" : "0");
}

/** 从本地题库里抽一条，尽量不重复上一条 */
export function pickScenario(exclude?: string): string {
  const pool = SCENARIOS.filter((item) => item !== exclude);
  const source = pool.length > 0 ? pool : SCENARIOS;
  return source[Math.floor(Math.random() * source.length)];
}

const SYSTEM_PROMPT = `你是英语口语练习的出题人。只输出一句中文提示，不超过 20 个字，
描述一个用户此刻能亲眼看到、或者刚刚经历过的具体场景，让他用英文描述出来。
不要编号，不要引号，不要解释，不要写成问答题库。`;

/** 让模型现出一条场景提示 */
export async function generateScenario(apiKey: string, exclude?: string): Promise<string> {
  const openai = new OpenAI({
    apiKey,
    baseURL: "https://api.deepseek.com",
    dangerouslyAllowBrowser: true,
  });

  const response = await openai.chat.completions.create({
    model: "deepseek-chat",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: exclude ? `换一个新的，不要和这句重复：${exclude}` : "给我一个练习场景。",
      },
    ],
    temperature: 1.1,
    max_tokens: 60,
  });

  const text = (response.choices[0]?.message?.content ?? "")
    .trim()
    .replace(/^["'「『]+|["'」』]+$/g, "")
    .replace(/\s+/g, " ");

  if (!text) throw new Error("模型返回为空");
  return text.slice(0, 40);
}
