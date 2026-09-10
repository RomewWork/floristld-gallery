import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
export function generateStaticParams() {
  // 静态导出必须提前列出语言路径；合集内容通过查询参数和客户端接口加载。
  return [{ locale: "zh" }, { locale: "en" }];
}
export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (locale !== "zh" && locale !== "en") notFound();
  return <Shell locale={locale}>{children}</Shell>;
}
