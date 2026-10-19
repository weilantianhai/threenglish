"use client";

import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { useWordCard } from "./WordCardSheet";

export interface ClickableTextProps {
  /** 待渲染的英文文本，单词会被拆成可点元素 */
  text: string;
  /** 外层容器样式 */
  className?: string;
  /** 单个可点单词的样式 */
  linkClassName?: string;
}

const WORD_PATTERN = /([a-zA-Z]+)/g;

/**
 * 文本划词组件：句子里每个英文单词都能点，点了直接弹单词卡片（不跳页）。
 *
 * 用 <span role="button"> 而不是 <button>：button 是 inline-block，会让「public.」这种
 * 词+标点被拆到两行（标点单独掉到下一行）。span 保持行内布局，断行跟普通文本一致。
 *
 * 点击必须 stopPropagation，否则在闪卡里会连带触发卡片翻转。
 */
export default function ClickableText({
  text,
  className = "",
  linkClassName = "text-indigo-600 underline decoration-dashed decoration-indigo-300 underline-offset-2",
}: ClickableTextProps) {
  const wordCard = useWordCard();
  const segments = (text ?? "").split(WORD_PATTERN);

  return (
    <p className={className}>
      {segments.map((segment, index) => {
        if (!segment) return null;

        // 正则带捕获组，split 后奇数位一定是匹配到的英文单词。
        // 这里用字符判断而不是 WORD_PATTERN.test()：
        // 带 g 标志的正则 .test() 会残留 lastIndex，导致同一句话里部分单词不可点。
        if (/^[a-zA-Z]+$/.test(segment)) {
          const open = () => wordCard?.openWord(segment);

          return (
            <span
              key={`${segment}-${index}`}
              role="button"
              tabIndex={0}
              onClick={(event: MouseEvent<HTMLSpanElement>) => {
                event.stopPropagation();
                open();
              }}
              onPointerDown={(event: PointerEvent<HTMLSpanElement>) => {
                event.stopPropagation();
              }}
              onKeyDown={(event: KeyboardEvent<HTMLSpanElement>) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  open();
                }
              }}
              className={`cursor-pointer ${linkClassName}`}
            >
              {segment}
            </span>
          );
        }

        return <span key={`text-${index}`}>{segment}</span>;
      })}
    </p>
  );
}
