"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import TripForm from "@/components/TripForm";
import LoadingOverlay from "@/components/LoadingOverlay";
import { TripPlan, TripInput } from "@/lib/types";
import { savePlan, getHistory } from "@/lib/storage";

export default function Home() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<TripPlan[]>([]);

  useEffect(() => {
    setHistory(getHistory());
  }, []);

  const handleSubmit = async (input: TripInput) => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/generate-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "生成行程失败，请重试。");
        return;
      }

      const plan: TripPlan = data;
      savePlan(plan);
      router.push(`/plan?id=${plan.id}`);
    } catch {
      setError("网络错误，请检查网络连接后重试。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex-1 flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        {loading ? (
          <LoadingOverlay />
        ) : (
          <>
            <div className="text-center mb-10">
              <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">
                AI Trip Planner
              </h1>
              <p className="text-gray-500 text-lg max-w-md mx-auto">
                告诉我你要去哪、玩几天，AI 帮你规划拎包就走的行程
              </p>
            </div>

            <button
              onClick={() => router.push("/extract")}
              className="w-full max-w-lg mx-auto mb-6 p-4 rounded-2xl bg-gradient-to-r from-rose-50 to-pink-50 border border-pink-200 text-left hover:shadow-md transition-all group"
            >
              <span className="flex items-center justify-between">
                <span>
                  <span className="block font-semibold text-pink-700">
                    📕 从小红书帖子提取景点 <span className="text-xs font-normal align-middle ml-1 px-1.5 py-0.5 rounded bg-pink-100 text-pink-600">新</span>
                  </span>
                  <span className="block text-sm text-pink-600/80 mt-0.5">
                    粘贴帖子正文 → AI 识别地点 → 你勾选想去的
                  </span>
                </span>
                <span className="text-pink-400 group-hover:translate-x-0.5 transition-transform">→</span>
              </span>
            </button>

            <div className="w-full max-w-lg mx-auto flex items-center gap-3 mb-6">
              <div className="flex-1 h-px bg-gray-100" />
              <span className="text-xs text-gray-400">或直接告诉我目的地</span>
              <div className="flex-1 h-px bg-gray-100" />
            </div>

            <TripForm onSubmit={handleSubmit} loading={loading} />

            {error && (
              <div className="mt-6 w-full max-w-lg mx-auto p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
                {error}
              </div>
            )}

            {history.length > 0 && (
              <div className="mt-12 w-full max-w-lg mx-auto">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-medium text-gray-500">最近的行程</h2>
                  <button
                    onClick={() => router.push("/history")}
                    className="text-sm text-blue-600 hover:text-blue-800"
                  >
                    查看全部
                  </button>
                </div>
                <div className="space-y-2">
                  {history.slice(0, 3).map((plan) => (
                    <button
                      key={plan.id}
                      onClick={() => router.push(`/plan?id=${plan.id}`)}
                      className="w-full text-left p-3 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors border border-gray-100"
                    >
                      <span className="font-medium text-gray-900">
                        {plan.destination} {plan.days}日游
                      </span>
                      <span className="text-sm text-gray-400 ml-2">
                        {new Date(plan.createdAt).toLocaleDateString("zh-CN")}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
