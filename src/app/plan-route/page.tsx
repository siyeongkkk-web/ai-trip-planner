"use client";

import { Fragment, Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  POICollection,
  EnrichedPlan,
  RouteLeg,
  HotelTier,
  HotelPref,
  Pace,
  DAY_OPTIONS,
} from "@/lib/types";
import { getPOICollection } from "@/lib/storage";

const MODE_ICON: Record<string, string> = {
  walking: "🚶",
  transit: "🚇",
  taxi: "🚕",
};
const MODE_COLOR: Record<string, string> = {
  walking: "var(--mode-walk)",
  transit: "var(--mode-subway)",
  taxi: "var(--mode-taxi)",
};

const TIERS: HotelTier[] = ["经济", "舒适", "豪华"];
const HOTEL_PREFS: HotelPref[] = ["景点近", "地铁近", "公交近", "闹中取静"];
const PACES: { v: Pace; label: string }[] = [
  { v: "赶", label: "赶 · 多看几个" },
  { v: "适中", label: "适中" },
  { v: "悠闲", label: "悠闲 · 慢慢逛" },
];

/** 换乘段：交通线上的一截彩色连线 + 模式标签 */
function Leg({ leg }: { leg: RouteLeg }) {
  return (
    <div className="tl-leg" style={{ ["--leg-color" as string]: MODE_COLOR[leg.mode] }}>
      <span className="text-sm">{MODE_ICON[leg.mode] || "→"}</span>
      <span className="tl-legtext">{leg.description}</span>
    </div>
  );
}

function PlanRouteContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = searchParams.get("id");

  const [collection, setCollection] = useState<POICollection | null>(null);
  const [city, setCity] = useState("");
  const [days, setDays] = useState(3);
  const [hotelName, setHotelName] = useState("");
  const [hotelTier, setHotelTier] = useState<HotelTier>("舒适");
  const [hotelPrefs, setHotelPrefs] = useState<HotelPref[]>(["景点近"]);
  const [pace, setPace] = useState<Pace>("适中");
  const [lunchTime, setLunchTime] = useState("12:00");
  const [dinnerTime, setDinnerTime] = useState("18:30");
  const [mustInclude, setMustInclude] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<string[]>([]); // 被对话调整剔除的景点名
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<EnrichedPlan | null>(null);
  const [activeDay, setActiveDay] = useState(0);

  // 对话调整
  const [chatInput, setChatInput] = useState("");
  const [chatMsgs, setChatMsgs] = useState<{ role: "user" | "ai"; text: string }[]>([]);
  const [adjusting, setAdjusting] = useState(false);

  const togglePref = (p: HotelPref) =>
    setHotelPrefs((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  const toggleMust = (id: string) =>
    setMustInclude((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  useEffect(() => {
    if (!id) return;
    const c = getPOICollection(id);
    if (c) {
      setCollection(c);
      setCity(c.city || "");
    }
  }, [id]);

  // 统一的规划入口：用当前状态 + 可选覆盖项跑一次规划（覆盖项用于对话调整，避免 state 异步问题）
  const doPlan = async (o?: {
    days?: number;
    hotelTier?: HotelTier;
    hotelPrefs?: HotelPref[];
    mustInclude?: string[];
    excluded?: string[];
  }) => {
    if (!collection || !city.trim()) return;
    const p = {
      days: o?.days ?? days,
      hotelTier: o?.hotelTier ?? hotelTier,
      hotelPrefs: o?.hotelPrefs ?? hotelPrefs,
      mustInclude: o?.mustInclude ?? mustInclude,
      excluded: o?.excluded ?? excluded,
    };
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/plan-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          city: city.trim(),
          days: p.days,
          hotelName: hotelName.trim() || undefined,
          hotelTier: p.hotelTier,
          hotelPrefs: p.hotelPrefs,
          mustInclude: p.mustInclude,
          pace,
          lunchTime,
          dinnerTime,
          pois: collection.candidates
            .filter((c) => !p.excluded.includes(c.name))
            .map((c) => ({ id: c.id, name: c.name, category: c.category, note: c.note })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "规划失败，请重试。");
        return;
      }
      setPlan(data);
      setActiveDay(0);
    } catch {
      setError("网络错误，请重试。");
    } finally {
      setLoading(false);
    }
  };

  const handlePlan = () => doPlan();

  // 对话调整：自然语言 → LLM 转结构化参数 → 重新规划
  const handleChat = async () => {
    if (!plan || !chatInput.trim() || adjusting) return;
    const msg = chatInput.trim();
    setChatInput("");
    setChatMsgs((m) => [...m, { role: "user", text: msg }]);
    setAdjusting(true);
    try {
      const inPlan = plan.scheduledDays
        .flatMap((d) => d.items)
        .filter((it) => it.kind === "poi")
        .map((it) => it.name);
      const res = await fetch("/api/adjust-plan-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          city: city.trim(),
          days,
          hotelTier,
          hotelPrefs,
          inPlan,
          dropped: plan.droppedPOIs.map((p) => p.name),
          message: msg,
        }),
      });
      const r = await res.json();
      if (!res.ok) {
        setChatMsgs((m) => [...m, { role: "ai", text: r.error || "调整失败，请重试。" }]);
        return;
      }
      // 应用调整
      const nameToId = new Map(collection!.candidates.map((c) => [c.name, c.id]));
      const newMust = Array.from(
        new Set([
          ...mustInclude,
          ...(r.include as string[]).map((n) => nameToId.get(n)).filter(Boolean),
        ])
      ) as string[];
      const newExcluded = Array.from(new Set([...excluded, ...(r.exclude as string[])]));
      setDays(r.days);
      setHotelTier(r.hotelTier);
      setHotelPrefs(r.hotelPrefs);
      setMustInclude(newMust);
      setExcluded(newExcluded);
      setChatMsgs((m) => [...m, { role: "ai", text: r.reply }]);
      await doPlan({
        days: r.days,
        hotelTier: r.hotelTier,
        hotelPrefs: r.hotelPrefs,
        mustInclude: newMust,
        excluded: newExcluded,
      });
    } catch {
      setChatMsgs((m) => [...m, { role: "ai", text: "网络错误，请重试。" }]);
    } finally {
      setAdjusting(false);
    }
  };

  if (!collection) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-gray-400">没找到要规划的景点集合，请先去提取景点。</p>
      </div>
    );
  }

  return (
    <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
      <button
        onClick={() => router.push("/extract")}
        className="text-sm text-gray-400 hover:text-gray-600 mb-3 flex items-center gap-1"
      >
        ← 返回选择景点
      </button>

      <h1 className="text-2xl font-bold text-gray-900 mb-1">规划路线</h1>
      <p className="text-sm text-gray-500 mb-5">
        共 {collection.candidates.length} 个景点。AI 已交棒——下面由地图 API 定位、按天聚类、算真实交通，并排出时间轴、配正餐、推荐住宿、估预算。
      </p>

      {/* 规划参数 */}
      <div className="space-y-3 mb-5 p-4 rounded-xl bg-gray-50 border border-gray-100">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">城市</label>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="如：成都"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">酒店（可选，留空则只给推荐）</label>
            <input
              value={hotelName}
              onChange={(e) => setHotelName(e.target.value)}
              placeholder="如：成都太古里亚朵S酒店"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">玩几天</label>
            <div className="flex flex-wrap gap-2">
              {DAY_OPTIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  style={days === d ? { background: "var(--route)", color: "#fff" } : undefined}
                  className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-all ${
                    days === d ? "shadow-md" : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-100"
                  }`}
                >
                  {d}天
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">住宿档次（用于预算）</label>
            <div className="flex gap-2">
              {TIERS.map((t) => (
                <button
                  key={t}
                  onClick={() => setHotelTier(t)}
                  className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-all ${
                    hotelTier === t
                      ? "bg-violet-600 text-white shadow-md"
                      : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-100"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">住宿偏好（多选，用于推荐酒店）</label>
          <div className="flex flex-wrap gap-2">
            {HOTEL_PREFS.map((p) => (
              <button
                key={p}
                onClick={() => togglePref(p)}
                className={`px-3 py-1.5 rounded-full text-sm transition-all ${
                  hotelPrefs.includes(p)
                    ? "bg-violet-100 text-violet-700 border border-violet-300"
                    : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-100"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">游玩节奏（调每个景点停留多久）</label>
            <div className="flex flex-wrap gap-2">
              {PACES.map((pc) => (
                <button
                  key={pc.v}
                  onClick={() => setPace(pc.v)}
                  style={pace === pc.v ? { background: "var(--route)", color: "#fff" } : undefined}
                  className={`px-3 py-1.5 rounded-full text-sm transition-all ${
                    pace === pc.v ? "shadow-sm" : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-100"
                  }`}
                >
                  {pc.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">用餐时间</label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">午</span>
              <input
                type="time"
                value={lunchTime}
                onChange={(e) => setLunchTime(e.target.value)}
                className="tnum px-2 py-1.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
              <span className="text-xs text-gray-500">晚</span>
              <input
                type="time"
                value={dinnerTime}
                onChange={(e) => setDinnerTime(e.target.value)}
                className="tnum px-2 py-1.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
          </div>
        </div>
        <button
          onClick={handlePlan}
          disabled={loading || !city.trim()}
          className="w-full py-3 rounded-xl btn-route font-semibold shadow-lg"
        >
          {loading ? "地图定位 + 算路线中（约 10 秒）..." : plan ? "重新规划" : "开始规划 🗺"}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}

      {plan && (
        <div>
          {plan.failedPOIs.length > 0 && (
            <div className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-sm">
              ⚠️ 这些点没在地图上定位到，已跳过：{plan.failedPOIs.join("、")}
            </div>
          )}

          {/* 预算 */}
          <div className="mb-4 p-4 ticket">
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
                单人预估总花费
              </h3>
              <span className="tnum text-xl font-bold" style={{ color: "var(--route)" }}>
                ¥{plan.budget.perPerson}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {plan.budget.breakdown.map((b) => (
                <span key={b.label} className="text-xs" style={{ color: "var(--ink-soft)" }}>
                  {b.label}{" "}
                  <span className="tnum font-medium" style={{ color: "var(--ink)" }}>
                    ¥{b.amount}
                  </span>
                </span>
              ))}
            </div>
          </div>

          {/* 没排进行程的：景点可置换，多余餐厅仅展示 */}
          {plan.droppedPOIs.length > 0 &&
            (() => {
              const swap = plan.droppedPOIs.filter((p) => p.swappable);
              const fixed = plan.droppedPOIs.filter((p) => !p.swappable);
              return (
                <div className="mb-4 p-4 rounded-xl bg-amber-50 border border-amber-200">
                  <h3 className="text-sm font-semibold text-amber-900 mb-2">
                    没排进行程的（共 {plan.droppedPOIs.length} 个）
                  </h3>

                  {swap.length > 0 && (
                    <>
                      <p className="text-xs text-amber-700 mb-2">
                        ⏱ 这些景点时间装不下。勾"非去不可"会顶掉次要的点，重新规划：
                      </p>
                      <div className="flex flex-wrap gap-2 mb-3">
                        {swap.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => toggleMust(p.id)}
                            className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                              mustInclude.includes(p.id)
                                ? "bg-amber-500 text-white border-amber-500"
                                : "bg-white text-amber-700 border-amber-300"
                            }`}
                          >
                            {mustInclude.includes(p.id) ? "✓ " : "+ "}
                            {p.name}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={handlePlan}
                        disabled={loading || mustInclude.length === 0}
                        className="text-sm px-4 py-2 rounded-lg bg-amber-600 text-white font-medium hover:bg-amber-700 transition-colors disabled:opacity-50"
                      >
                        应用置换，重新规划
                      </button>
                    </>
                  )}

                  {fixed.length > 0 && (
                    <>
                      <p className="text-xs text-amber-700 mt-3 mb-1">
                        🍽 这些餐厅超出了用餐次数，没排上（想吃可在对话框里说，或减少其他餐厅）：
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {fixed.map((p) => (
                          <span
                            key={p.id}
                            className="text-xs px-2.5 py-1 rounded-full bg-white border border-amber-200 text-amber-600"
                          >
                            {p.name}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })()}

          {/* 酒店推荐 */}
          {plan.hotelRec && plan.hotelRec.examples.length > 0 && (
            <div className="mb-4 p-4 rounded-xl bg-violet-50 border border-violet-200">
              <h3 className="text-sm font-semibold text-violet-900 mb-1">🏨 住宿推荐</h3>
              <p className="text-sm text-violet-700 mb-2">{plan.hotelRec.reason}</p>
              <div className="space-y-1.5">
                {plan.hotelRec.examples.map((h) => (
                  <div
                    key={h.name}
                    className="flex items-center gap-2 flex-wrap p-2 rounded-lg bg-white border border-violet-200"
                  >
                    <span className="text-sm font-medium text-violet-800">{h.name}</span>
                    {h.tags.map((t) => (
                      <span
                        key={t}
                        className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-600"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 天数 tab */}
          <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
            {plan.scheduledDays.map((day, i) => (
              <button
                key={day.dayLabel}
                onClick={() => setActiveDay(i)}
                style={activeDay === i ? { background: "var(--route)", color: "#fff" } : undefined}
                className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all shadow-sm ${
                  activeDay === i ? "" : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"
                }`}
              >
                {day.dayLabel} <span className="tnum">¥{day.dayCostEstimate}</span>
              </button>
            ))}
          </div>

          {/* 当天时间轴 */}
          {(() => {
            const day = plan.scheduledDays[activeDay];
            if (day.items.length === 0) {
              return <p className="text-sm text-gray-400">这一天没有安排景点。</p>;
            }
            return (
              <div className="tl">
                {plan.hotelName && (
                  <div className="tl-row">
                    <span className="tl-dot tl-dot--hotel" />
                    <div className="pt-2.5 text-sm font-medium" style={{ color: "var(--ink)" }}>
                      🏨 {plan.hotelName} 出发
                    </div>
                  </div>
                )}

                {day.items.map((it, idx) => (
                  <Fragment key={idx}>
                    {it.legIn && <Leg leg={it.legIn} />}
                    <div className="tl-row">
                      <span className="tl-time tnum">{it.arrive}</span>
                      <span className={`tl-dot ${it.kind === "meal" ? "tl-dot--meal" : ""}`} />
                      <div
                        className="rounded-xl border shadow-sm p-3"
                        style={{
                          background: "var(--paper-card)",
                          borderColor: it.kind === "meal" ? "#e8d2a6" : "var(--line)",
                        }}
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-base">{it.kind === "meal" ? "🍽" : "📍"}</span>
                          <span className="font-semibold" style={{ color: "var(--ink)" }}>
                            {it.kind === "meal" ? it.name : it.matchedName || it.name}
                          </span>
                          <span
                            className="text-[11px] px-2 py-0.5 rounded-full"
                            style={
                              it.kind === "meal"
                                ? { background: "#f6ecd6", color: "var(--amber)" }
                                : { background: "#dcebe8", color: "var(--route)" }
                            }
                          >
                            {it.category || "景点"}
                          </span>
                          <span className="tnum text-[11px] ml-auto" style={{ color: "var(--ink-soft)" }}>
                            {it.arrive}–{it.depart} · {it.durationMin}分 · ¥{it.costEstimate}
                          </span>
                        </div>
                        {it.kind === "poi" && it.matchedName && it.matchedName !== it.name && (
                          <p className="text-xs mt-0.5" style={{ color: "var(--ink-soft)" }}>
                            你写的是：{it.name}
                          </p>
                        )}
                        {it.note && (
                          <p className="text-sm mt-1" style={{ color: "var(--ink-soft)" }}>{it.note}</p>
                        )}
                        {it.address && (
                          <p className="text-xs mt-1" style={{ color: "var(--ink-soft)" }}>📍 {it.address}</p>
                        )}
                      </div>
                    </div>
                  </Fragment>
                ))}

                {plan.hotelName && day.lastToHotel && (
                  <>
                    <Leg leg={day.lastToHotel} />
                    <div className="tl-row">
                      <span className="tl-dot tl-dot--hotel" />
                      <div className="pt-2.5 text-sm font-medium" style={{ color: "var(--ink)" }}>
                        🏨 返回 {plan.hotelName}
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })()}

          {/* 对话调整 */}
          <div className="mt-6 p-4 rounded-xl bg-gray-50 border border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">💬 还想调整？直接说</h3>
            {chatMsgs.length > 0 && (
              <div className="space-y-2 mb-3 max-h-56 overflow-y-auto">
                {chatMsgs.map((m, i) => (
                  <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <span
                      style={m.role === "user" ? { background: "var(--route)" } : undefined}
                      className={`inline-block max-w-[85%] px-3 py-2 rounded-2xl text-sm ${
                        m.role === "user"
                          ? "text-white rounded-br-sm"
                          : "bg-white border border-gray-200 text-gray-700 rounded-bl-sm"
                      }`}
                    >
                      {m.text}
                    </span>
                  </div>
                ))}
                {adjusting && <p className="text-xs text-gray-400">正在理解并重新规划...</p>}
              </div>
            )}
            <div className="flex gap-2">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleChat();
                }}
                disabled={adjusting || loading}
                placeholder="如：第二天太累，少安排一个 / 不想去天坛 / 酒店要离地铁更近 / 多玩一天"
                className="flex-1 px-3 py-2.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleChat}
                disabled={adjusting || loading || !chatInput.trim()}
                className="px-4 py-2.5 rounded-lg btn-route text-sm font-medium"
              >
                发送
              </button>
            </div>
          </div>

          <p className="mt-8 text-center text-xs text-gray-400">
            坐标、距离、交通耗时、餐厅与酒店均来自高德地图（真实数据）；游玩时长、门票与预算为粗略估算，出行前请再核对。
          </p>
        </div>
      )}
    </main>
  );
}

export default function PlanRoutePage() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center">
          <p className="text-gray-400">加载中...</p>
        </div>
      }
    >
      <PlanRouteContent />
    </Suspense>
  );
}
