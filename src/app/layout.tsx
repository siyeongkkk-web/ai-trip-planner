import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Trip Planner - 智能旅行规划",
  description: "输入目的地和天数，AI 帮你生成精确到小时的旅行行程",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="min-h-full flex flex-col font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
