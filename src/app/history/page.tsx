"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TripPlan } from "@/lib/types";
import { getHistory, deletePlan, clearHistory } from "@/lib/storage";

export default function HistoryPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<TripPlan[]>([]);

  useEffect(() => {
    setPlans(getHistory());
  }, []);

  const handleDelete = (id: string) => {
    deletePlan(id);
    setPlans(getHistory());
  };

  const handleClearAll = () => {
    clearHistory();
    setPlans([]);
  };

  return (
    <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <button
            onClick={() => router.push("/")}
            className="text-sm text-gray-400 hover:text-gray-600 mb-1 flex items-center gap-1"
          >
            ← 返回
          </button>
          <h1 className="text-2xl font-bold text-gray-900">历史行程</h1>
        </div>
        {plans.length > 0 && (
          <button
            onClick={handleClearAll}
            className="text-sm text-red-500 hover:text-red-700"
          >
            清空全部
          </button>
        )}
      </div>

      {plans.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-gray-400 mb-4">还没有历史行程</p>
          <button
            onClick={() => router.push("/")}
            className="text-blue-600 hover:text-blue-800 text-sm"
          >
            去规划一个 →
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className="flex items-center justify-between p-4 rounded-xl bg-gray-50 hover:bg-gray-100 border border-gray-100 transition-colors"
            >
              <button
                onClick={() => router.push(`/plan?id=${plan.id}`)}
                className="flex-1 text-left"
              >
                <span className="font-medium text-gray-900">
                  {plan.destination} {plan.days}日游
                </span>
                <span className="text-sm text-gray-400 ml-3">
                  {new Date(plan.createdAt).toLocaleDateString("zh-CN")}
                </span>
                <p className="text-xs text-gray-400 mt-1">
                  {plan.departureCity && `${plan.departureCity}出发`}
                  {plan.preferences.length > 0 && ` · ${plan.preferences.join(" · ")}`}
                </p>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(plan.id);
                }}
                className="ml-4 text-gray-300 hover:text-red-500 transition-colors text-sm"
              >
                删除
              </button>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
