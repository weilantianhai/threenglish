"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export interface AppHeaderProps {
  /** 标题，可传纯文本或带徽标的自定义节点 */
  title: ReactNode;
  /** 是否显示返回键 */
  showBack?: boolean;
  /** 右侧插槽 */
  rightNode?: ReactNode;
  /** 返回键指向，默认回首页 */
  backHref?: string;
  /** 自定义返回行为（优先级高于 backHref），在 Capacitor 里配合 router.back() 更自然 */
  onBack?: () => void;
  /** 标题下方的第二行插槽，例如等级切换栏 */
  children?: ReactNode;
  className?: string;
}

/**
 * 移动端吸顶毛玻璃头部。
 * 已处理刘海安全区：pt-[calc(0.75rem+env(safe-area-inset-top))]
 */
export default function AppHeader({
  title,
  showBack = false,
  rightNode,
  backHref = "/",
  onBack,
  children,
  className = "",
}: AppHeaderProps) {
  const backClassName =
    "p-1 -ml-1 text-slate-600 active:scale-95 transition-transform shrink-0";

  return (
    <header
      className={`sticky top-0 z-20 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] bg-white/80 backdrop-blur-md border-b border-slate-200 ${
        children ? "flex flex-col gap-3" : ""
      } ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {showBack &&
            (onBack ? (
              <button
                type="button"
                onClick={onBack}
                aria-label="返回"
                className={backClassName}
              >
                <ChevronLeft size={24} />
              </button>
            ) : (
              <Link href={backHref} aria-label="返回" className={backClassName}>
                <ChevronLeft size={24} />
              </Link>
            ))}
          <div className="text-lg font-bold text-slate-800 truncate">{title}</div>
        </div>

        {rightNode ? (
          <div className="flex items-center gap-3 text-slate-500 shrink-0">{rightNode}</div>
        ) : null}
      </div>

      {children}
    </header>
  );
}
