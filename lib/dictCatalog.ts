// lib/dictCatalog.ts
// 可下载的词库清单，对应 KyleBing/dict 的 book-json-full 分卷。
// 想加新词库只改这里：id + 分卷名 + 分类 + 等级（rank 越小越基础）。

export type DictCategory =
  | "基础"
  | "小学"
  | "初中"
  | "高中"
  | "大学考试"
  | "英语专业"
  | "留学考试"
  | "商务英语";

export interface DictBook {
  id: string;
  label: string;
  category: DictCategory;
  description: string;
  /** 分卷文件名（不含 .json） */
  parts: string[];
  /** 等级：0 小学 / 1 初中 / 2 高中 / 3 四级 / 4 六级 / 5 考研·专四·留学 / 6 专八 */
  rank: number;
  /** 是否内置（随包提供，不可删除） */
  builtin?: boolean;
}

/** 等级标签：画像里按这个给单词分类，多词库共有的词算最低级 */
export const TIERS: Array<{ rank: number; label: string }> = [
  { rank: 0, label: "小学" },
  { rank: 1, label: "初中" },
  { rank: 2, label: "高中" },
  { rank: 3, label: "四级" },
  { rank: 4, label: "六级" },
  { rank: 5, label: "考研/专四/留学" },
  { rank: 6, label: "专八" },
];

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);

export const DICT_BOOKS: DictBook[] = [
  {
    id: "base-junior",
    label: "初中基础",
    category: "基础",
    description: "初中大纲核心词，随包内置",
    parts: ["ChuZhong_2", "ChuZhong_3"],
    rank: 1,
    builtin: true,
  },
  {
    id: "base-senior",
    label: "高中基础",
    category: "基础",
    description: "高中大纲核心词，随包内置",
    parts: ["GaoZhong_2", "GaoZhong_3"],
    rank: 2,
    builtin: true,
  },
  {
    id: "cet4",
    label: "CET-4",
    category: "大学考试",
    description: "四级核心词汇，随包内置",
    parts: ["CET4_1", "CET4_2", "CET4_3"],
    rank: 3,
    builtin: true,
  },
  {
    id: "cet6",
    label: "CET-6",
    category: "大学考试",
    description: "六级核心词汇",
    parts: ["CET6_1", "CET6_2", "CET6_3"],
    rank: 4,
  },
  {
    id: "kaoyan",
    label: "考研",
    category: "大学考试",
    description: "考研英语核心词汇",
    parts: ["KaoYan_1", "KaoYan_2", "KaoYan_3"],
    rank: 5,
  },
  {
    id: "level4",
    label: "专四",
    category: "英语专业",
    description: "英语专业四级高频词",
    parts: ["Level4_1", "Level4_2"],
    rank: 5,
  },
  {
    id: "level8",
    label: "专八",
    category: "英语专业",
    description: "英语专业八级高频词",
    parts: ["Level8_1", "Level8_2"],
    rank: 6,
  },

  // ---- 小学 / 初中 / 高中（教材版，下载后作为独立词库存在，不替换基础词） ----
  {
    id: "pep-primary",
    label: "人教小学",
    category: "小学",
    description: "人教版小学英语 3~6 年级",
    parts: [
      "PEPXiaoXue3_1", "PEPXiaoXue3_2",
      "PEPXiaoXue4_1", "PEPXiaoXue4_2",
      "PEPXiaoXue5_1", "PEPXiaoXue5_2",
      "PEPXiaoXue6_1", "PEPXiaoXue6_2",
    ],
    rank: 0,
  },
  {
    id: "junior",
    label: "初中大纲",
    category: "初中",
    description: "初中英语大纲词汇",
    parts: ["ChuZhong_2", "ChuZhong_3"],
    rank: 1,
  },
  {
    id: "pep-junior",
    label: "人教初中",
    category: "初中",
    description: "人教版初中英语 7~9 年级",
    parts: [
      "PEPChuZhong7_1", "PEPChuZhong7_2",
      "PEPChuZhong8_1", "PEPChuZhong8_2",
      "PEPChuZhong9_1",
    ],
    rank: 1,
  },
  {
    id: "waiyanshe-junior",
    label: "外研社初中",
    category: "初中",
    description: "外研社版初中英语",
    parts: range(1, 6).map((n) => `WaiYanSheChuZhong_${n}`),
    rank: 1,
  },
  {
    id: "senior",
    label: "高中大纲",
    category: "高中",
    description: "高中英语大纲词汇",
    parts: ["GaoZhong_2", "GaoZhong_3"],
    rank: 2,
  },
  {
    id: "pep-senior",
    label: "人教高中",
    category: "高中",
    description: "人教版高中英语必修 + 选修",
    parts: range(1, 11).map((n) => `PEPGaoZhong_${n}`),
    rank: 2,
  },
  {
    id: "beishi-senior",
    label: "北师高中",
    category: "高中",
    description: "北师大版高中英语",
    parts: range(1, 11).map((n) => `BeiShiGaoZhong_${n}`),
    rank: 2,
  },

  // ---- 留学 / 商务 ----
  {
    id: "ielts",
    label: "雅思",
    category: "留学考试",
    description: "IELTS 核心词汇",
    parts: ["IELTS_2", "IELTS_3"],
    rank: 5,
  },
  {
    id: "toefl",
    label: "托福",
    category: "留学考试",
    description: "TOEFL 核心词汇",
    parts: ["TOEFL_2", "TOEFL_3"],
    rank: 5,
  },
  {
    id: "gre",
    label: "GRE",
    category: "留学考试",
    description: "GRE 核心词汇",
    parts: ["GRE_2", "GRE_3"],
    rank: 6,
  },
  {
    id: "gmat",
    label: "GMAT",
    category: "留学考试",
    description: "GMAT 核心词汇",
    parts: ["GMAT_2", "GMAT_3"],
    rank: 6,
  },
  {
    id: "sat",
    label: "SAT",
    category: "留学考试",
    description: "SAT 核心词汇",
    parts: ["SAT_2", "SAT_3"],
    rank: 5,
  },
  {
    id: "bec",
    label: "BEC 商务",
    category: "商务英语",
    description: "剑桥商务英语词汇",
    parts: ["BEC_2", "BEC_3"],
    rank: 4,
  },
];

export function getBook(id: string): DictBook | undefined {
  return DICT_BOOKS.find((book) => book.id === id);
}

export function getBookLabel(id: string): string {
  return getBook(id)?.label ?? id.toUpperCase();
}

/** 词库等级：未知词库返回 -1（不参与分级） */
export function getBookRank(id: string): number {
  return getBook(id)?.rank ?? -1;
}

export function tierLabel(rank: number): string {
  return TIERS.find((tier) => tier.rank === rank)?.label ?? "其他";
}

/** 按分类分组，保持 DICT_BOOKS 的顺序 */
export function groupBooks(): Array<{ category: string; books: DictBook[] }> {
  const groups: Array<{ category: string; books: DictBook[] }> = [];
  for (const book of DICT_BOOKS) {
    const group = groups.find((item) => item.category === book.category);
    if (group) group.books.push(book);
    else groups.push({ category: book.category, books: [book] });
  }
  return groups;
}
