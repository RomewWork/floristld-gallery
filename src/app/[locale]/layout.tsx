import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
export function generateStaticParams() {
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
