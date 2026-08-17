"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HotelCandidate, TripPlan } from "@/lib/types";
import { savePlan } from "@/lib/storage";

export default function HotelSetup({ plan }: { plan: TripPlan }) {
  const router = useRouter();
  const [candidates, setCandidates] = useState<HotelCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [name, setName] = useState(plan.selectedHotel?.name || "");
  const [address, setAddress] = useState(plan.selectedHotel?.address || "");
  const [ctripUrl, setCtripUrl] = useState(plan.selectedHotel?.ctripUrl || "");
  const [totalPrice, setTotalPrice] = useState(plan.selectedHotel?.totalPrice || 0);
  const [message, setMessage] = useState("");
  const [resolvingHotel, setResolvingHotel] = useState<string | null>(null);
  const generationSequence = useRef(0);
  const hasGeneratedItinerary = plan.dailyPlans.length > 0;

  useEffect(() => {
    let active = true;
    const loadCandidates = async (attempt = 0): Promise<void> => {
      try {
        const response = await fetch("/api/hotel-options", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(plan),
        });
        const data = await response.json();
        if (response.ok) {
          if (active) setCandidates(data.candidates || []);
          return;
        }
        throw new Error(data.error || "加载失败");
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "酒店候选加载失败。");
      } finally {
        if (active && attempt === 0) setLoading(false);
      }
    };
    void loadCandidates();
    return () => {
      active = false;
    };
  }, [plan]);

  const select = async (candidate: HotelCandidate) => {
    setName(candidate.name);
    setAddress(candidate.address || "");
    setResolvingHotel(candidate.id);
    try {
      await navigator.clipboard.writeText(candidate.name);
    } catch {
      // 浏览器不允许剪贴板时，名称仍已自动填入。
    }
    try {
      if (candidate.ctripUrl) {
        setCtripUrl(candidate.ctripUrl);
        window.open(candidate.ctripUrl, "_blank", "noopener,noreferrer");
        setMessage("已打开这家酒店的携程详情页。请核对日期、房型和总价后回来填写。");
      } else {
        setCtripUrl("");
        window.open("https://hotels.ctrip.com/", "_blank", "noopener,noreferrer");
        setMessage("已填入并复制酒店名称，也为你打开了携程酒店搜索。粘贴名称后请核对地址、日期、房型和总价。");
      }
    } finally {
      setResolvingHotel(null);
    }
  };

  const generatePlan = async () => {
    if (!name.trim() || totalPrice <= 0) {
      setMessage("请选择酒店，并填写携程订单页显示的整个入住期间总价。");
      return;
    }
    const selectedHotel = { name: name.trim(), address: address.trim() || undefined, totalPrice, ctripUrl: ctripUrl || undefined, source: "user-confirmed" as const, confirmedAt: new Date().toISOString() };
    const sequence = ++generationSequence.current;
    setGenerating(true);
    setMessage("");
    try {
      const response = await fetch("/api/generate-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...plan, selectedHotel, planningStrategy: undefined }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "行程生成失败，请重试。");
      if (sequence !== generationSequence.current) return;
      const generatedPlan: TripPlan = {
        ...data,
        id: plan.id,
        createdAt: plan.createdAt,
        transportPricing: plan.transportPricing,
        sourcePOIs: plan.sourcePOIs,
        sourcePOICollectionId: plan.sourcePOICollectionId,
        planningStrategy: undefined,
        status: "generated",
      };
      savePlan(generatedPlan);
      router.push(`/plan?id=${plan.id}`);
    } catch (error) {
      if (sequence === generationSequence.current) setMessage(error instanceof Error ? error.message : "行程生成失败，请重试。");
    } finally { if (sequence === generationSequence.current) setGenerating(false); }
  };

  const groups = [
    {
      key: "arrival" as const,
      title: `靠近${plan.outboundTransport?.arrivalTerminal || "到达点"}`,
      description: "适合晚到、早班或不想拖着行李长距离换乘",
    },
    {
      key: "preference" as const,
      title: "靠近符合旅行偏好的景点区域",
      description: `根据“${plan.preferences.join("、") || "热门景点"}”筛选真实地点周边酒店`,
    },
  ];

  return (
    <div className="space-y-4">
      <section className="hotel-hero flow-card">
        <div className="hotel-hero__copy">
          <span className="travel-kicker">第三站 · 今晚睡哪里</span>
          <h1>选择酒店</h1>
          <p>
          候选来自高德真实地点。已核对携程详情页的可直接打开；尚未核对的会复制名称并带你到携程搜索，避免空白推荐区。
          </p>
        {!!plan.hotelPreferences?.length && (
          <div className="hotel-tags mt-3 flex flex-wrap gap-1.5">
            {plan.hotelPreferences.map((preference) => (
              <span
                key={preference}
                className="rounded-full border border-violet-200 bg-white px-2.5 py-1 text-xs text-violet-800"
              >
                {preference}
              </span>
            ))}
          </div>
        )}
        {(plan.hotelPreferences?.includes("卫生优先") ||
          plan.hotelPreferences?.includes("安全优先")) && (
          <p className="mt-2 text-xs text-violet-700">
            高德地点数据不能证明卫生或安全；候选只做位置与档次初筛，这两项会明确提示你到携程看近期住客点评。
          </p>
        )}
        </div>
      </section>

      {loading && <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">正在查找真实酒店候选，并核对可直达的携程详情页…</p>}
      {!loading &&
        groups.map((group) => {
          const items = candidates.filter((candidate) => candidate.group === group.key);
          if (!items.length) return null;
          return (
            <section key={group.key} className="flow-card hotel-candidate-group">
              <h2 className="font-semibold text-gray-900">{group.title}</h2>
              <p className="mt-0.5 text-xs text-gray-500">{group.description}</p>
              <div className="mt-3 space-y-2">
                {items.map((candidate) => (
                  <div key={candidate.id} className={`rounded-lg border p-3 ${name === candidate.name ? "border-violet-400 bg-violet-50" : "border-gray-200"}`}>
                    <p className="font-medium text-gray-900">{candidate.name}</p>
                    {candidate.address && <p className="mt-0.5 text-xs text-gray-500">{candidate.address}</p>}
                    <p className="mt-1 text-xs text-violet-700">{candidate.reason}</p>
                    {!!candidate.preferenceNotes?.length && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {candidate.preferenceNotes.map((note) => (
                          <span
                            key={note}
                            className="rounded bg-gray-50 px-2 py-1 text-[11px] text-gray-600"
                          >
                            {note}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${candidate.ctripUrl ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
                        {candidate.ctripUrl ? "携程详情页已核对" : "高德真实候选 · 携程详情页待核对"}
                      </span>
                      <button
                        disabled={resolvingHotel === candidate.id}
                        onClick={() => select(candidate)}
                        className="rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs text-violet-700 transition-colors hover:bg-violet-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-700 disabled:opacity-50"
                      >
                        {resolvingHotel === candidate.id
                          ? "正在准备携程页面…"
                          : candidate.ctripUrl
                            ? "选择并打开携程详情"
                            : "复制名称并打开携程搜索"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}

      <section className="flow-card hotel-confirm-card">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-semibold text-emerald-950">确认你在携程选中的酒店</h2>
            <p className="mt-1 text-xs text-emerald-800">外部确认任务：打开真实平台 → 核对名称、地址、日期、房型与总价 → 回来填写。</p>
          </div>
          <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${name.trim() && totalPrice > 0 ? "border-emerald-400 bg-white text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
            {name.trim() && totalPrice > 0 ? "信息已齐，可生成行程" : "等待你完成平台核对"}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs" aria-label="酒店确认进度">
          <div className={`rounded-lg border p-2 ${name.trim() ? "border-emerald-300 bg-white text-emerald-800" : "border-emerald-200 bg-white/60 text-gray-600"}`}>{name.trim() ? "✓" : "1"} 酒店名称</div>
          <div className={`rounded-lg border p-2 ${address.trim() ? "border-emerald-300 bg-white text-emerald-800" : "border-emerald-200 bg-white/60 text-gray-600"}`}>{address.trim() ? "✓" : "2"} 地址</div>
          <div className={`rounded-lg border p-2 ${totalPrice > 0 ? "border-emerald-300 bg-white text-emerald-800" : "border-emerald-200 bg-white/60 text-gray-600"}`}>{totalPrice > 0 ? "✓" : "3"} 入住总价</div>
        </div>
        <div className="mt-3 space-y-3">
          <label className="block text-xs text-gray-600">酒店准确名称<input value={name} onChange={(event) => { setName(event.target.value); setCtripUrl(""); }} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900" /></label>
          <label className="block text-xs text-gray-600">酒店地址<input value={address} onChange={(event) => setAddress(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900" /></label>
          <label className="block text-xs text-gray-600">整个入住期间总价<input type="number" min={0} value={totalPrice || ""} onChange={(event) => setTotalPrice(Number(event.target.value) || 0)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900" /></label>
        </div>
        <div className="mt-4 rounded-lg border border-emerald-100 bg-white p-3 text-xs leading-5 text-emerald-900">
          系统会根据你已确认的日期、交通、酒店和旅行偏好生成一套完整行程，同时兼顾地点覆盖、通勤距离和每日节奏。生成后可以在行程页继续调整。
        </div>
        {hasGeneratedItinerary ? (
          <div className="generated-itinerary-actions mt-3">
            <button type="button" onClick={() => router.push(`/plan?id=${plan.id}`)} className="flow-primary-button">
              返回已生成行程 →
            </button>
            <button
              type="button"
              disabled={generating}
              onClick={generatePlan}
              aria-busy={generating}
              className="flow-secondary-button disabled:cursor-wait disabled:opacity-60"
            >
              {generating ? "正在重新规划并校验路线…" : "酒店信息已改变，重新生成行程"}
            </button>
            <p>查看本页不会清除原行程；只有点击“重新生成”才会用当前酒店信息覆盖规划。</p>
          </div>
        ) : (
          <button
            type="button"
            disabled={generating}
            onClick={generatePlan}
            aria-busy={generating}
            className="flow-primary-button mt-3 disabled:cursor-wait disabled:opacity-60"
          >
            {generating ? "正在根据你的偏好生成并校验路线…" : "生成我的行程"}
          </button>
        )}
      </section>
      {message && <p aria-live="polite" className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-600">{message}</p>}
    </div>
  );
}
