// lib/structures.ts
// 句式库：给模型一个「本轮可以教的新结构」候选池，避免它每次都用同一批从句。
// 难度 1~5 对应 A2~B2 左右，模型按画像的目标档位取。

export interface SentenceStructure {
  id: string;
  /** 中文名，方便写进讲解 */
  label: string;
  /** 难度 1~5 */
  level: number;
  /** 结构骨架 */
  pattern: string;
  /** 例句 */
  example: string;
}

export const STRUCTURES: SentenceStructure[] = [
  { id: "comparative", label: "比较级", level: 1, pattern: "A is more … than B", example: "This route is shorter than the one we took yesterday." },
  { id: "because", label: "原因状语从句", level: 1, pattern: "… because …", example: "I stayed home because it was raining." },
  { id: "gerund-subject", label: "动名词作主语", level: 3, pattern: "Doing … is …", example: "Getting up early makes the whole day easier." },
  { id: "relative", label: "定语从句", level: 3, pattern: "…, which/that …", example: "The book that you lent me was surprisingly good." },
  { id: "participle-phrase", label: "分词短语作状语", level: 4, pattern: "Having done …, …", example: "Having finished the report, she went out for a walk." },
  { id: "inversion", label: "否定词倒装", level: 4, pattern: "Never have I …", example: "Never have I seen such a crowded station." },
  { id: "cleft", label: "强调句", level: 4, pattern: "It was … that …", example: "It was the silence, not the noise, that woke me up." },
  { id: "nominalization", label: "名词化", level: 4, pattern: "The + n. + of …", example: "The sudden cancellation of the flight ruined our plan." },
  { id: "subjunctive", label: "虚拟语气", level: 5, pattern: "If I had …, I would have …", example: "If I had known earlier, I would have booked a different flight." },
  { id: "concession", label: "让步状语从句", level: 3, pattern: "Although / Even though …, …", example: "Although the plan sounded appealing, I found it impractical." },
  { id: "purpose", label: "目的状语", level: 3, pattern: "… so as to / in order to …", example: "She left early in order to avoid the traffic." },
  { id: "appositive", label: "同位语", level: 4, pattern: "…, a/an + n., …", example: "My roommate, a software engineer, rarely cooks." },
  { id: "with-phrase", label: "with 复合结构", level: 4, pattern: "with + n. + doing/done", example: "He sat by the window with the rain beating against it." },
  { id: "not-only", label: "not only … but also", level: 3, pattern: "Not only … but also …", example: "The trip was not only cheap but also surprisingly comfortable." },
  { id: "as-if", label: "as if 从句", level: 4, pattern: "… as if …", example: "He kept talking as if nothing had happened." },
  { id: "fronting", label: "状语前置", level: 3, pattern: "On/In + n., …", example: "On the way home, I ran into an old classmate." },
];

/** 取不超过给定难度的结构（模型调用时传目标难度） */
export function pickStructures(maxLevel: number, limit = 3): SentenceStructure[] {
  const pool = STRUCTURES.filter((item) => item.level <= maxLevel);
  const source = pool.length > 0 ? pool : STRUCTURES.slice(0, 3);
  const shuffled = [...source].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.max(1, limit));
}
