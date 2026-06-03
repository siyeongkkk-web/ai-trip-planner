"use client";

import { useEffect, useState } from "react";

const TIPS = [
  "正在搜索热门景点...",
  "正在规划最佳路线...",
  "正在安排交通衔接...",
  "正在挑选特色美食...",
  "正在计算最优时间分配...",
  "正在添加实用小贴士...",
  "马上就好，行程即将生成...",
];

export default function LoadingOverlay() {
  const [tipIndex, setTipIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setTipIndex((prev) => (prev + 1) % TIPS.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center py-20 gap-6">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-full border-4 border-blue-100" />
        <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-blue-600 animate-spin" />
        <div className="absolute inset-0 flex items-center justify-center text-2xl">
          ✈️
        </div>
      </div>
      <p className="text-gray-500 text-sm animate-pulse">{TIPS[tipIndex]}</p>
    </div>
  );
}
