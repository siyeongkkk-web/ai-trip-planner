"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { TripPlan, AdjustAction, PREFERENCE_OPTIONS } from "@/lib/types";
import { getHistory, savePlan } from "@/lib/storage";
import Timeline from "@/components/Timeline";

function PlanContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const planId = searchParams.get("id");

  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [activeDay, setActiveDay] = useState(0);
  const [adjustingBlockId, setAdjustingBlockId] = useState<string | null>(null);
  const [selectingHotel, setSelectingHotel] = useState(false);
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

  const handleSelectHotel = useCallback(
    async (hotelName: string) => {
      if (!plan) return;
      setSelectingHotel(true);
      setError(null);

      try {
        const res = await fetch("/api/select-hotel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan, hotelName }),
        });

        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "更新行程失败，请重试。");
          return;
        }

        const updatedPlan: TripPlan = data;
        setPlan(updatedPlan);
        savePlan(updatedPlan);
      } catch {
        setError("网络错误，请重试。");
      } finally {
        setSelectingHotel(false);
      }
    },
    [plan]
  );

  const copyPlan = useCallback(() => {
    if (!plan) return;
    const lines: string[] = [];
    lines.push(`${plan.destination} ${plan.days}日游行程`);
    if (plan.departureCity) lines.push(`出发城市：${plan.departureCity}`);
    if (plan.preferences.length > 0) lines.push(`偏好：${plan.preferences.join("、")}`);
    lines.push("");

    if (plan.transportAdvice) {
      lines.push(`🚄 往返交通：${plan.transportAdvice}`);
      lines.push("");
    }

    if (plan.hotel) {
      lines.push(`🏨 住宿：${plan.hotel.area}（${plan.hotel.budgetRange}）`);
      lines.push(`   ${plan.hotel.reason}`);
      lines.push(`   推荐：${plan.hotel.examples.join("、")}`);
      lines.push("");
    }

    plan.dailyPlans.forEach((day) => {
      lines.push(`📅 ${day.dayLabel}${day.dailyBudget ? `（${day.dailyBudget}）` : ""}`);
      day.blocks.forEach((block) => {
        if (block.type === "activity") {
          lines.push(`${block.startTime}-${block.endTime} ${block.title}（${block.duration}，${block.cost}）`);
          if (block.highlights?.length) lines.push(`  ⭐ ${block.highlights.join(" | ")}`);
          if (block.tip) lines.push(`  💡 ${block.tip}`);
        } else {
          lines.push(`  → ${block.description}（${block.duration}，${block.cost}）`);
        }
      });
      lines.push("");
    });

    if (plan.totalBudget) lines.push(`💰 总预算：${plan.totalBudget}`);
    lines.push("⚠️ 行程由 AI 生成，交通时间和费用仅供参考");

    navigator.clipboard.writeText(lines.join("\n"));
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

  const prefEmojis = PREFERENCE_OPTIONS.reduce<Record<string, string>>(
    (acc, p) => ({ ...acc, [p.label]: p.emoji }),
    {}
  );

  return (
    <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
      <div className="flex items-center justify-between mb-4">
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
          {plan.departureCity && (
            <p className="text-sm text-gray-400 mt-0.5">
              {plan.departureCity}出发
            </p>
          )}
        </div>
        <button
          onClick={copyPlan}
          className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm text-gray-700 transition-colors flex-shrink-0"
        >
          {copied ? "已复制 ✓" : "复制行程"}
        </button>
      </div>

      {plan.preferences.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {plan.preferences.map((pref) => (
            <span
              key={pref}
              className="text-xs px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200"
            >
              {prefEmojis[pref] || "🏷"} {pref}
            </span>
          ))}
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}

      {plan.transportAdvice && (
        <div className="mb-4 p-4 rounded-xl bg-sky-50 border border-sky-200">
          <h3 className="text-sm font-semibold text-sky-900 mb-1">🚄 往返交通建议</h3>
          <p className="text-sm text-sky-800">{plan.transportAdvice}</p>
        </div>
      )}

      {plan.hotel && (
        <div className="mb-4 p-4 rounded-xl bg-violet-50 border border-violet-200">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold text-violet-900">🏨 住宿推荐</h3>
            {selectingHotel && (
              <span className="text-xs text-violet-500 flex items-center gap-1">
                <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                正在根据酒店位置重算行程...
              </span>
            )}
          </div>
          <p className="text-sm text-violet-800 mb-1">
            <span className="font-medium">{plan.hotel.area}</span>
            <span className="text-violet-600 ml-2">{plan.hotel.budgetRange}</span>
          </p>
          <p className="text-sm text-violet-700 mb-2">{plan.hotel.reason}</p>
          <p className="text-xs text-violet-500 mb-2">点击选择酒店，AI 将根据酒店位置重新规划交通路线：</p>
          <div className="flex flex-wrap gap-2">
            {plan.hotel.examples.map((name) => {
              const cleanName = name.replace(/\s*¥[\d,-]+\/晚/g, "").trim();
              const query = encodeURIComponent(`${plan.destination} ${cleanName} 怎么样 评价`);
              return (
                <div key={name} className="flex items-center gap-1">
                  <button
                    onClick={() => handleSelectHotel(cleanName)}
                    disabled={selectingHotel}
                    className="text-xs px-2.5 py-1.5 rounded-full bg-white border border-violet-300 text-violet-700 hover:bg-violet-100 hover:border-violet-400 transition-colors disabled:opacity-50 font-medium"
                  >
                    选择
                  </button>
                  <a
                    href={`https://www.xiaohongshu.com/search_result?keyword=${query}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs px-2.5 py-1.5 rounded-full bg-white border border-violet-200 text-violet-600 hover:bg-violet-50 transition-colors"
                  >
                    {name} 📕
                  </a>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {plan.totalBudget && (
        <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-center">
          <span className="text-sm font-semibold text-emerald-800">
            💰 预估总花费：{plan.totalBudget}
          </span>
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
        city={plan.destination}
        onAdjust={handleAdjust}
        adjustingBlockId={adjustingBlockId}
      />

      <p className="mt-8 text-center text-xs text-gray-400">
        ⚠️ 行程由 AI 生成，交通时间和费用仅供参考（单人）。建议出行前在地图 App 中确认路线。
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
