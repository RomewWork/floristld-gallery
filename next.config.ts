import type { NextConfig } from "next";
const config: NextConfig = {
  // 页面导出到 out/；运行时管理 API 由 Worker 提供，不依赖 Next.js 服务端。
  output: "export",
  trailingSlash: true,
  // 静态托管没有默认图片优化服务，展示图尺寸由 ImageKit URL 参数控制。
  images: { unoptimized: true },
};
export default config;
