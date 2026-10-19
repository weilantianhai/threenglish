// lib/chatStore.ts
// 对话状态放在模块级：切页面（组件卸载）不丢，App 重启（JS 上下文重建）自动清空。

import type { UserLevel } from "./prompts";

export interface ChatResponse {
  corrected: string;
  translation: string;
  anchors: string[];
  anchorAnalysis: string;
  grammar: string;
  why: string;
  guide: string | null;
  isThird?: boolean;
  summary: string | null;
  /** 错误类型（受控词表），用于本地画像统计 */
  errorTypes?: string[];
  /** 模型对这句改写难度的自评（1~5），作为画像的辅助信号 */
  difficulty?: number;
}

export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "ai"; content: ChatResponse }
  /** 只用于界面提示（例如「本组对话已保存」），不会发给模型 */
  | { role: "system"; content: string };

export interface ChatState {
  history: ChatMessage[];
  turnCount: number;
  level: UserLevel;
}

const initialState: ChatState = {
  history: [],
  turnCount: 1,
  level: "daily",
};

let state: ChatState = { ...initialState };

export function readChatState(): ChatState {
  return state;
}

export function writeChatState(patch: Partial<ChatState>): void {
  state = { ...state, ...patch };
}

export function resetChatState(): void {
  state = { ...state, history: [], turnCount: 1 };
}
