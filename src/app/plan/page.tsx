"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { TripPlan, AdjustAction } from "@/lib/types";
import { getHistory, savePlan } from "@/lib/storage";
import Timeline from "@/components/Timeline";

function PlanContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const planId = searchParams.get("id");

  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [activeDay, setActiveDay] = useState(0);
  const [adjustingBlockId, setAdjustingBlockId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!planId) return;
    const history = getHistory();
    const found = history.find((p) => p.id === planId);
    if (found) {
      setPlan(found);
    }
  }, [planId]);

  const handleAdjust = useCallback(
    async (dayIndex: number, blockId: string, action: AdjustAction) => {
      if (!plan) return;
      setAdjustingBlockId(blockId);
      setError(null);

      try {
        const res = await fetch("/api/adjust-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plan,
            dayIndex,
            blockId,
            action,
            extraMinutes: action === "extend" ? 60 : undefined,
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          setError(data.error || "调整失败，请重试。");
          return;
        }

        const updatedPlan: TripPlan = data;
        setPlan(updatedPlan);
        savePlan(updatedPlan);
      } catch {
        setError("网络错误，请重试。");
      } finally {
        setAdjustingBlockId(null);
      }
    },
    [plan]
  );

  const copyPlan = useCallback(() => {
    if (!plan) return;
    const text = plan.dailyPlans
      .map((day) => {
        const dayText = day.blocks
          .map((block) => {
            if (block.type === "activity") {
              return `${block.startTime}-${block.endTime} ${block.title}（${block.duration}，${block.cost}）\n  💡 ${block.tip}`;
            }
            return `  → ${block.description}（${block.duration}，${block.cost}）`;
          })
          .join("\n");
        return `📅 ${day.dayLabel}\n${dayText}`;
      })
      .join("\n\n");

    const fullText = `${plan.destination} ${plan.days}日游行程\n\n${text}\n\n⚠️ 行程由 AI 生成，交通时间和费用仅供参考`;
    navigator.clipboard.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [plan]);

  if (!plan) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-gray-400">行程不存在或已被清除</p>
      </div>
    );
  }

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
          <h1 className="text-2xl font-bold text-gray-900">
            {plan.destination} {plan.days}日游
          </h1>
          {plan.preferences.length > 0 && (
            <p className="text-sm text-gray-400 mt-1">
              {plan.preferences.join(" · ")}
            </p>
          )}
        </div>
        <button
          onClick={copyPlan}
          className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm text-gray-700 transition-colors"
        >
          {copied ? "已复制 ✓" : "复制行程"}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {plan.dailyPlans.map((day, i) => (
          <button
            key={day.dayLabel}
            onClick={() => setActiveDay(i)}
            className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
              activeDay === i
                ? "bg-blue-600 text-white shadow-md"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {day.dayLabel}
          </button>
        ))}
      </div>

      <Timeline
        dayPlan={plan.dailyPlans[activeDay]}
        dayIndex={activeDay}
        onAdjust={handleAdjust}
        adjustingBlockId={adjustingBlockId}
      />

      <p className="mt-8 text-center text-xs text-gray-400">
        ⚠️ 行程由 AI 生成，交通时间和费用仅供参考。建议出行前在地图 App 中确认路线。
      </p>
    </main>
  );
}

export default function PlanPage() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center">
          <p className="text-gray-400">加载中...</p>
        </div>
      }
    >
      <PlanContent />
    </Suspense>
  );
}
