"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import TripForm from "@/components/TripForm";
import LoadingOverlay from "@/components/LoadingOverlay";
import PlanningSteps from "@/components/PlanningSteps";
import { TripPlan, TripInput } from "@/lib/types";
import { savePlan, getHistory, getPlanPath } from "@/lib/storage";

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const planId = searchParams.get("id");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<TripPlan[]>([]);
  const [editingPlan, setEditingPlan] = useState<TripPlan | null>(null);

  useEffect(() => {
    // localStorage 只存在于浏览器；挂载后读取可避免服务端与客户端首屏不一致。
    const plans = getHistory();
    const timer = window.setTimeout(() => {
      setHistory(plans);
      setEditingPlan(planId ? plans.find((plan) => plan.id === planId) || null : null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [planId]);

  const handleSubmit = async (input: TripInput) => {
    setLoading(true);
    setError(null);

    try {
      const itineraryInputsUnchanged = Boolean(
        editingPlan &&
          editingPlan.destination === input.destination &&
          editingPlan.departureCity === input.departureCity &&
          editingPlan.days === input.days &&
          editingPlan.startDate === input.startDate &&
          editingPlan.endDate === input.endDate &&
          editingPlan.travelers === input.travelers &&
          editingPlan.publicTransportTaxiThreshold === input.publicTransportTaxiThreshold &&
          JSON.stringify(editingPlan.preferences) === JSON.stringify(input.preferences) &&
          JSON.stringify(editingPlan.hotelPreferences || []) === JSON.stringify(input.hotelPreferences || []) &&
          JSON.stringify(editingPlan.foodPreferences || []) === JSON.stringify(input.foodPreferences || []) &&
          editingPlan.breakfastHabit === input.breakfastHabit
      );
      const plan: TripPlan = {
        ...(editingPlan || {}),
        id: editingPlan?.id || crypto.randomUUID(),
        destination: input.destination,
        departureCity: input.departureCity,
        days: input.days,
        preferences: input.preferences,
        hotelPreferences: input.hotelPreferences,
        foodPreferences: input.foodPreferences,
        breakfastHabit: input.breakfastHabit,
        createdAt: editingPlan?.createdAt || new Date().toISOString(),
        startDate: input.startDate,
        endDate: input.endDate,
        publicTransportTaxiThreshold: input.publicTransportTaxiThreshold,
        travelers: input.travelers,
        status: itineraryInputsUnchanged ? editingPlan?.status : "draft",
        dailyPlans: itineraryInputsUnchanged ? editingPlan?.dailyPlans || [] : [],
      };
      savePlan(plan);
      router.push(`/plan/transport?id=${plan.id}`);
    } catch {
      setError("创建规划失败，请重试。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="home-page flex-1 flex flex-col">
      <div className="home-shell flex-1 px-4 py-5 sm:px-6 sm:py-8">
        {loading ? (
          <LoadingOverlay />
        ) : (
          <div className="mx-auto w-full max-w-6xl">
            <header className="home-brand mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="brand-stamp" aria-hidden="true">去</span>
                <span>
                  <span className="block text-sm font-black tracking-[0.12em] text-[color:var(--ink)]">AI TRIP PLANNER</span>
                  <span className="block text-xs text-[color:var(--ink-soft)]">把想去的地方，慢慢排成路</span>
                </span>
              </div>
              {history.length > 0 && (
                <button onClick={() => router.push("/history")} className="home-history-link">我的行程</button>
              )}
            </header>

            <PlanningSteps current="trip" planId={editingPlan?.id} hasGeneratedItinerary={Boolean(editingPlan?.dailyPlans.length)} />

            <section className="planning-intro" aria-labelledby="home-title">
              <div>
                <span className="travel-kicker">下一站 · 由你决定</span>
                <h1 id="home-title">先把旅行信息告诉我</h1>
                <p>先确定出发地、目的地和日期。下一步再选交通、酒店和每天的路线。</p>
              </div>
              <div className="travel-notes" aria-label="规划特点">
                <span>地图实体可核对</span><span>每一步可返回</span><span>草稿自动保留</span>
              </div>
              <span className="intro-route" aria-hidden="true" />
              <span className="intro-plane" aria-hidden="true">✦</span>
            </section>

            <section className="planner-workspace" aria-label="开始规划">
              <section className="scratch-card" aria-labelledby="start-from-scratch">
                <div className="scratch-card__heading">
                  <span className="entry-number" aria-hidden="true">01</span>
                  <span>
                    <span className="entry-eyebrow">核心信息</span>
                    <h2 id="start-from-scratch">{editingPlan ? "继续填写旅行信息" : "填写旅行信息"}</h2>
                  </span>
                </div>
                <p className="scratch-intro">{editingPlan ? "这份草稿已经帮你找回。修改后会回到交通确认。" : "先确定时间、人数和预算边界，偏好可以稍后补充。"}</p>
                <TripForm key={editingPlan?.id || "new-plan"} onSubmit={handleSubmit} loading={loading} compact initialPlan={editingPlan || undefined} />
              </section>

              <aside className="planner-side" aria-label="其他开始方式">
                <button
                  onClick={() => router.push("/extract")}
                  className="collection-entry group"
                >
                  <span className="entry-number" aria-hidden="true">02</span>
                  <span className="entry-copy">
                    <span className="entry-eyebrow">已有旅行灵感？</span>
                    <strong>导入收藏、帖子或截图</strong>
                    <small>提取地点 → 核对地图实体 → 带着清单开始规划</small>
                  </span>
                  <span className="entry-arrow" aria-hidden="true">→</span>
                </button>
                <div className="side-illustration" aria-hidden="true">
                  <span className="side-sun" />
                  <span className="side-cloud side-cloud--one" />
                  <span className="side-cloud side-cloud--two" />
                  <span className="side-hill side-hill--back" />
                  <span className="side-hill side-hill--front" />
                  <span className="side-sign"><i /><b /></span>
                  <span className="side-route" />
                </div>
                <p className="side-note">边收拾边计划，路线会慢慢清楚。</p>
              </aside>
            </section>

            {error && (
              <div className="mt-6 w-full max-w-lg mx-auto p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
                {error}
              </div>
            )}

            {history.length > 0 && (
              <section className="recent-trips">
                <div className="flex items-center justify-between mb-3">
                  <h2>最近的行程</h2>
                  <button
                    onClick={() => router.push("/history")}
                    className="home-history-link"
                  >
                    查看全部
                  </button>
                </div>
                <div className="space-y-2">
                  {history.slice(0, 3).map((plan) => (
                    <button
                      key={plan.id}
                      onClick={() => router.push(getPlanPath(plan))}
                      className="recent-trip"
                    >
                      <span className="font-medium text-gray-900">
                        {plan.destination} {plan.days}日游
                      </span>
                      <span className="text-sm text-[color:var(--ink-soft)] ml-2">
                        {new Date(plan.createdAt).toLocaleDateString("zh-CN")}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<main className="flex flex-1 items-center justify-center text-sm text-gray-500">正在读取旅行信息…</main>}>
      <HomeContent />
    </Suspense>
  );
}
