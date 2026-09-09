import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: {
    default: "Floristld — An illustrated world",
    template: "%s · Floristld",
  },
  description: "A personal illustration gallery. 植物、故事与小小奇遇。",
  robots: { index: true, follow: true },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
