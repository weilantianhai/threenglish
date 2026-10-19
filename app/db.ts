// app/db.ts
import Dexie, { type Table } from 'dexie';

export interface NoteTurn {
  text: string;
  translation: string;
  corrected: string;
  anchors: string[];
  anchorAnalysis: string;
  /** 模型判定的错误类型（受控词表，见 lib/profile.ts），用于本地画像 */
  errorTypes?: string[];
}

export interface NoteCard {
  id?: number;
  createdAt: number;
  turn1: NoteTurn;
  turn2: NoteTurn;
  turn3: NoteTurn;
  summary: string;
  isMastered?: boolean; // 新增：是否已掌握
}

/** 运行时下载的词库（整本存进来，重启后直接读，不用重新下载） */
export interface DictRow {
  /** 词库 id：cet4 / cet6 / kaoyan / level4 / level8 */
  level: string;
  /** 归一化后的词条数组，结构见 lib/dictionary.ts 的 DictEntry */
  entries: unknown[];
  updatedAt: number;
}

export class ThreenglishDB extends Dexie {
  cards!: Table<NoteCard>;
  dicts!: Table<DictRow>;

  constructor() {
    super('ThreenglishDB');
    this.version(1).stores({
      cards: '++id, createdAt' 
    });
    // v2：新增 dicts 表，用于存放用户下载的词库
    this.version(2).stores({
      cards: '++id, createdAt',
      dicts: 'level',
    });
  }
}

export const db = new ThreenglishDB();
