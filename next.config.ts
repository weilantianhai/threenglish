import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export", // 开启静态导出，打包 App 必备
  images: { unoptimized: true }, // 静态导出时图片不需要 Next.js 服务端优化
};

export default nextConfig;
