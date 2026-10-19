"use client"; // 必须加上这个，因为我们要用 useEffect

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { App as CapApp } from "@capacitor/app"; // 引入 Capacitor App 插件
import { WordCardProvider } from "../components/WordCardSheet";
import { loadSavedDictionaries } from "../lib/dictRuntime";
import "./globals.css";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // 词库是运行时可替换的，先把上次下载的读回内存，再渲染页面
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    loadSavedDictionaries()
      .catch(() => undefined)
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    // 监听安卓物理返回键
    const backButtonHandler = CapApp.addListener("backButton", () => {
      if (pathname !== "/") {
        // 如果不在首页，就返回上一页
        router.back();
      } else {
        // 如果已经在首页，就退出应用（或者你可以改成弹窗提示）
        CapApp.exitApp();
      }
    });

    // 组件卸载时移除监听
    return () => {
      backButtonHandler.then((handler) => handler.remove());
    };
  }, [pathname, router]);

  return (
    <html lang="en">
      <head>
        {/* 这里可以保留之前加的 viewport */}
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
      </head>
      <body className="antialiased">
        {/* 单词卡片弹层挂在根节点，全站任何位置都能 popup 查词 */}
        <WordCardProvider>
          {ready ? (
            children
          ) : (
            <div className="flex h-[100dvh] items-center justify-center bg-slate-50 text-sm text-slate-400">
              正在加载本地词库…
            </div>
          )}
        </WordCardProvider>
      </body>
    </html>
  );
}
