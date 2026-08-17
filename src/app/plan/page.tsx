"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  POICollection,
  TripPlan,
  AdjustAction,
  ActivityOption,
  AdjustOperationResult,
  AdjustResponse,
  PREFERENCE_OPTIONS,
} from "@/lib/types";
import { getHistory, getPlanPath, getPOICollection, savePlan } from "@/lib/storage";
import { getVerifiedCtripHotelUrl } from "@/lib/ctrip-hotels";
import { exportPlanAsJpg, exportPlanAsPdf } from "@/lib/plan-export";
import Timeline from "@/components/Timeline";
import CostEstimateCard from "@/components/CostEstimateCard";
import PlanAssistantChat from "@/components/PlanAssistantChat";
import PlanHealthPanel from "@/components/PlanHealthPanel";
import TravelUpdatePanel from "@/components/TravelUpdatePanel";
import { calculateTripCostEstimate } from "@/lib/cost-estimate";
import { getSelectedSavedCandidateCount, sourcePOIsFromCollection } from "@/lib/poi-source";
import PlanningSteps from "@/components/PlanningSteps";
import AdjustmentReceipt from "@/components/AdjustmentReceipt";
import { isCurrentAdjustmentPreview, isLatestAdjustmentResponse } from "@/lib/adjust-transaction";

function PlanContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const planId = searchParams.get("id");

  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [activeDay, setActiveDay] = useState(0);
  const [adjustingBlockId, setAdjustingBlockId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [confirmingTransportId, setConfirmingTransportId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"pdf" | "jpg" | null>(null);
  const [selectedSourcePoiIds, setSelectedSourcePoiIds] = useState<string[]>([]);
  const [pendingChoice, setPendingChoice] = useState<{
    dayIndex: number;
    blockId: string;
    title: string;
    action: "replace" | "add";
    options: ActivityOption[];
    rejectedOptionNames: string[];
  } | null>(null);
  const [loadingChoices, setLoadingChoices] = useState(false);
  const [sourceCollection, setSourceCollection] = useState<POICollection | null>(null);
  const [assistantPrompt, setAssistantPrompt] = useState<{ id: string; text: string } | null>(null);
  const [lastAdjustment, setLastAdjustment] = useState<AdjustOperationResult | null>(null);
  const adjustAbortController = useRef<AbortController | null>(null);
  const choiceAbortController = useRef<AbortController | null>(null);
  const adjustRequestSequence = useRef(0);
  const savedPlacesSectionRef = useRef<HTMLElement | null>(null);
  const assistantSectionRef = useRef<HTMLElement | null>(null);

  useEffect(
    () => () => {
      adjustAbortController.current?.abort();
      choiceAbortController.current?.abort();
    },
    []
  );

  useEffect(() => {
    if (!planId) return;
    const timer = window.setTimeout(() => {
      const stored = getHistory().find((item) => item.id === planId);
      if (!stored) return;
      if (stored.dailyPlans.length === 0) {
        router.replace(getPlanPath(stored));
        return;
      }
      const collection = stored.sourcePOICollectionId
        ? getPOICollection(stored.sourcePOICollectionId) || null
        : null;
      const found: TripPlan = collection
        ? { ...stored, sourcePOIs: sourcePOIsFromCollection(collection) }
        : stored;
      setSourceCollection(collection);
      setPlan(found);
      if (found.engineVersion !== 7 && found.selectedHotel) {
        setRepairing(true);
        fetch("/api/repair-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(found),
        })
          .then(async (response) => {
            const repaired = await response.json();
            if (!response.ok) throw new Error(repaired.error || "修复失败");
            setPlan(repaired);
            savePlan(repaired);
          })
          .catch(() => {
            setError("旧行程自动修复失败，你可以重新生成一次行程。");
          })
          .finally(() => setRepairing(false));
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [planId, router]);

  const handleAdjust = useCallback(
    async (
      dayIndex: number,
      blockId: string,
      action: AdjustAction,
      option?: ActivityOption,
      anchorBlockId?: string
    ): Promise<AdjustOperationResult> => {
      const baseRevision = plan?.revision || 0;
      const clientRejected = (
        message: string,
        reasonCode: AdjustOperationResult["reasonCode"]
      ): AdjustOperationResult => ({
        operationId: `client-${Date.now()}`,
        status: "rejected",
        action,
        dayIndex,
        targetBlockId: blockId,
        anchorBlockId,
        changedBlockIds: [],
        unchangedBlockIds: [],
        message,
        reasonCode,
        baseRevision,
        nextRevision: baseRevision,
      });
      const recordResult = (result: AdjustOperationResult) => {
        setLastAdjustment(result);
        return result;
      };
      if (!plan) return recordResult(clientRejected("行程尚未加载，当前行程没有改变。", "invalid-request"));
      if (option && !isCurrentAdjustmentPreview(option.previewBaseRevision, baseRevision)) {
        return recordResult(
          clientRejected("候选方案基于较早的行程版本，请重新获取后再确认。", "stale-plan")
        );
      }
      adjustAbortController.current?.abort();
      const controller = new AbortController();
      adjustAbortController.current = controller;
      const requestSequence = ++adjustRequestSequence.current;
      let timedOut = false;
      const timeout = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 45_000);
      setAdjustingBlockId(blockId);
      setError(null);

      try {
        const res = await fetch("/api/adjust-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            plan,
            dayIndex,
            blockId,
            action,
            extraMinutes: action === "extend" ? 60 : undefined,
            option,
            preRemoveBlockIds: option?.preRemoveBlockIds,
            anchorBlockId,
          }),
        });

        const data = (await res.json()) as AdjustResponse & { error?: string };
        if (!res.ok) {
          const rejected =
            data.operationResult ||
            clientRejected(data.error || "调整失败，当前行程没有改变。", "result-mismatch");
          if (requestSequence === adjustRequestSequence.current) setError(rejected.message);
          return recordResult(rejected);
        }
        if (!isLatestAdjustmentResponse(requestSequence, adjustRequestSequence.current)) {
          return recordResult(clientRejected("较早的调整结果已过期，没有覆盖当前行程。", "stale-plan"));
        }
        const result = data.operationResult;
        const updatedPlan = data.plan;
        if (
          !result ||
          result.status !== "applied" ||
          !updatedPlan ||
          result.baseRevision !== baseRevision ||
          result.nextRevision !== updatedPlan.revision
        ) {
          const rejected = clientRejected(
            "服务回执与当前行程版本不一致，因此没有保存这次调整。",
            "stale-plan"
          );
          setError(rejected.message);
          return recordResult(rejected);
        }
        setPlan(updatedPlan);
        savePlan(updatedPlan);
        return recordResult(result);
      } catch (requestError) {
        if (requestError instanceof DOMException && requestError.name === "AbortError") {
          const rejected = clientRejected(
            timedOut
              ? "路线计算超过45秒，本次调整已结束，当前行程保持不变。"
              : "已取消本次调整，当前行程保持不变。",
            timedOut ? "network-error" : "request-cancelled"
          );
          if (requestSequence === adjustRequestSequence.current) setError(rejected.message);
          return recordResult(rejected);
        }
        const rejected = clientRejected("网络错误，当前行程保持不变。", "network-error");
        if (requestSequence === adjustRequestSequence.current) setError(rejected.message);
        return recordResult(rejected);
      } finally {
        window.clearTimeout(timeout);
        if (
          adjustAbortController.current === controller &&
          requestSequence === adjustRequestSequence.current
        ) {
          adjustAbortController.current = null;
          setAdjustingBlockId(null);
        }
      }
    },
    [plan]
  );

  const cancelAdjust = useCallback(() => {
    adjustAbortController.current?.abort();
  }, []);

  const getChoiceOptions = useCallback(
    async (
      dayIndex: number,
      blockId: string,
      _action: "replace" | "add" = "replace",
      addQuery?: string,
      recommendOnly = false,
      excludeNames: string[] = []
    ): Promise<ActivityOption[]> => {
      if (!plan) return [];
      void _action;
      choiceAbortController.current?.abort();
      const controller = new AbortController();
      choiceAbortController.current = controller;
      let timedOut = false;
      const timeout = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 25_000);
      setLoadingChoices(true);
      setError(null);
      try {
        const response = await fetch("/api/activity-options", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ plan, dayIndex, blockId, preferredSourcePoiIds: selectedSourcePoiIds, addQuery, recommendOnly, excludeNames }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "候选地点加载失败。");
        return (data.options || []).map((option: ActivityOption) => ({
          ...option,
          previewBaseRevision: plan.revision || 0,
        }));
      } catch (error) {
        setError(
          error instanceof DOMException && error.name === "AbortError"
            ? timedOut
              ? "候选地点查询超过25秒，已结束本次查询。"
              : "已取消上一轮候选地点查询。"
            : error instanceof Error
              ? error.message
              : "候选地点加载失败。"
        );
        return [];
      } finally {
        window.clearTimeout(timeout);
        if (choiceAbortController.current === controller) {
          choiceAbortController.current = null;
          setLoadingChoices(false);
        }
      }
    },
    [plan, selectedSourcePoiIds]
  );

  const requestChoices = useCallback(
    async (
      dayIndex: number,
      blockId: string,
      action: "replace" | "add" = "replace",
      addQuery?: string,
      recommendOnly = false,
      rejectedOptionNames: string[] = []
    ) => {
      if (!plan) return;
      const target = plan.dailyPlans[dayIndex]?.blocks.find(
        (block) => block.type === "activity" && block.id === blockId
      );
      if (!target || target.type !== "activity") return;
      const options = await getChoiceOptions(
        dayIndex,
        blockId,
        action,
        addQuery,
        recommendOnly,
        rejectedOptionNames
      );
      setPendingChoice({ dayIndex, blockId, title: target.title, action, options, rejectedOptionNames });
    },
    [getChoiceOptions, plan]
  );

  const copyPlan = useCallback(() => {
    if (!plan) return;
    const lines: string[] = [];
    lines.push(`${plan.destination} ${plan.days}日游行程`);
    if (plan.departureCity) lines.push(`出发城市：${plan.departureCity}`);
    if (plan.startDate && plan.endDate) lines.push(`日期：${plan.startDate} 至 ${plan.endDate}`);
    lines.push(`公交转打车阈值：${plan.publicTransportTaxiThreshold || 60}分钟`);
    if (plan.preferences.length > 0) lines.push(`偏好：${plan.preferences.join("、")}`);
    if (plan.hotelPreferences?.length) {
      lines.push(`酒店偏好：${plan.hotelPreferences.join("、")}`);
    }
    if (plan.foodPreferences?.length) {
      lines.push(`饮食偏好：${plan.foodPreferences.join("、")}`);
    }
    if (plan.breakfastHabit) lines.push(`早餐习惯：${plan.breakfastHabit}`);
    lines.push("");

    if (plan.outboundTransport && plan.returnTransport) {
      lines.push(`去程：${plan.outboundTransport.serviceNumber} ${plan.outboundTransport.departureTerminal} ${plan.outboundTransport.departTime} → ${plan.outboundTransport.arrivalTerminal} ${plan.outboundTransport.arriveTime}`);
      lines.push(`返程：${plan.returnTransport.serviceNumber} ${plan.returnTransport.departureTerminal} ${plan.returnTransport.departTime} → ${plan.returnTransport.arrivalTerminal} ${plan.returnTransport.arriveTime}`);
      if (plan.transportPricing?.kind === "per-leg") {
        lines.push(`票价：去程¥${plan.transportPricing.outboundPricePerPerson}/人，返程¥${plan.transportPricing.returnPricePerPerson}/人`);
      } else if (plan.transportPricing?.kind === "round-trip-total") {
        lines.push(`票价：往返合计¥${plan.transportPricing.totalPricePerPerson}/人`);
      } else if (
        plan.outboundTransport.pricePerPerson &&
        plan.returnTransport.pricePerPerson
      ) {
        lines.push(`票价：去程¥${plan.outboundTransport.pricePerPerson}/人，返程¥${plan.returnTransport.pricePerPerson}/人`);
      }
      lines.push("");
    }

    if (plan.selectedHotel) {
      lines.push(`🏨 住宿：${plan.selectedHotel.name}，总价¥${plan.selectedHotel.totalPrice}`);
      lines.push("");
    }

    const estimate = calculateTripCostEstimate(plan);
    lines.push(`💰 最低预估：¥${estimate.minimumPerPerson}/人`);
    lines.push(`建议准备：¥${estimate.minimumPerPerson}–¥${estimate.suggestedHighPerPerson}/人`);
    if (estimate.excludedTicketNames.length) {
      lines.push(`未计入的待核实门票：${estimate.excludedTicketNames.join("、")}`);
    }
    lines.push("");

    plan.dailyPlans.forEach((day) => {
      lines.push(`📅 ${day.dayLabel}`);
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

    lines.push("⚠️ 大交通和酒店为用户确认价格；市内路线来自高德时标注，其他费用需另行核实。");

    navigator.clipboard.writeText(lines.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [plan]);

  const confirmTransport = useCallback(
    async (blockId: string, mode: "subway" | "taxi") => {
      if (!plan) return;
      setConfirmingTransportId(blockId);
      setError(null);
      try {
        const response = await fetch("/api/confirm-transport", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan, blockId, mode }),
        });
        const updated = await response.json();
        if (!response.ok) throw new Error(updated.error || "更新失败");
        setPlan(updated);
        savePlan(updated);
      } catch (error) {
        setError(error instanceof Error ? error.message : "确认交通方案失败，请重试。");
      } finally {
        setConfirmingTransportId(null);
      }
    },
    [plan]
  );

  const exportPlan = useCallback(
    async (format: "pdf" | "jpg") => {
      if (!plan) return;
      setExporting(format);
      setError(null);
      try {
        if (format === "pdf") exportPlanAsPdf(plan);
        else await exportPlanAsJpg(plan);
      } catch (error) {
        setError(error instanceof Error ? error.message : "导出失败，请重试。");
      } finally {
        setExporting(null);
      }
    },
    [plan]
  );

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
  const hotelCtripUrl = plan.selectedHotel
    ? plan.selectedHotel.ctripUrl || getVerifiedCtripHotelUrl(plan.selectedHotel.name)
    : undefined;
  const normalizePlaceName = (name?: string) =>
    String(name || "").replace(/[（）()·\s\-—_]/g, "").toLowerCase();
  const scheduledSourceNames = new Set(
    plan.dailyPlans.flatMap((day) =>
      day.blocks
        .filter((block) => block.type === "activity")
        .map((block) => normalizePlaceName(block.matchedName || block.placeName))
        .filter(Boolean)
    )
  );
  const scheduledSourceIds = new Set(
    plan.dailyPlans.flatMap((day) =>
      day.blocks
        .filter((block) => block.type === "activity" && Boolean(block.sourcePOIId))
        .map((block) => block.type === "activity" ? block.sourcePOIId as string : "")
        .filter(Boolean)
    )
  );
  const unscheduledSourcePOIs = (plan.sourcePOIs || []).filter(
    (poi) =>
      !scheduledSourceIds.has(poi.id) &&
      !scheduledSourceNames.has(normalizePlaceName(poi.name)) &&
      !scheduledSourceNames.has(normalizePlaceName(poi.matchedName))
  );
  const sourceTotal = plan.sourcePOIs?.length || 0;
  const selectedSavedCount = sourceCollection ? getSelectedSavedCandidateCount(sourceCollection) : sourceTotal;
  const rejectedSavedCount = Math.max(0, selectedSavedCount - sourceTotal);
  const sourceScheduledCount = sourceTotal - unscheduledSourcePOIs.length;

  return (
    <main className="flow-page flex-1">
      <div className="flow-shell itinerary-shell">
      <PlanningSteps current="itinerary" planId={plan.id} />
      <section className="itinerary-hero flow-card">
        <div>
          <button
            onClick={() => router.push(`/?id=${plan.id}`)}
            className="flow-back mb-2"
          >
            ← 返回
          </button>
          <span className="travel-kicker">第四站 · 路线已经排好</span>
          <h1>
            {plan.destination} {plan.days}日游
          </h1>
          {plan.departureCity && (
            <div className="text-sm text-gray-500 mt-1 space-y-0.5">
              <p>{plan.departureCity}出发 · {plan.travelers || 1}人</p>
              {plan.startDate && plan.endDate && <p>{plan.startDate} 至 {plan.endDate}</p>}
              <p>公交/地铁超过 {plan.publicTransportTaxiThreshold || 60} 分钟时比较打车方案</p>
            </div>
          )}
        </div>
        <div className="itinerary-actions">
          <button
            onClick={copyPlan}
            className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm text-gray-700 transition-colors"
          >
            {copied ? "已复制 ✓" : "复制行程"}
          </button>
          <details className="relative">
            <summary className="cursor-pointer list-none rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200">
              导出行程 ▾
            </summary>
            <div className="absolute right-0 z-10 mt-2 w-36 rounded-lg border border-gray-200 bg-white p-1.5 shadow-lg">
              <button
                type="button"
                onClick={() => exportPlan("pdf")}
                disabled={exporting !== null}
                className="w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                {exporting === "pdf" ? "正在打开…" : "导出 PDF"}
              </button>
              <button
                type="button"
                onClick={() => exportPlan("jpg")}
                disabled={exporting !== null}
                className="w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                {exporting === "jpg" ? "正在生成…" : "导出 JPG"}
              </button>
            </div>
          </details>
        </div>
      </section>

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

      {(plan.hotelPreferences?.length ||
        plan.foodPreferences?.length ||
        plan.breakfastHabit) && (
        <section className="mb-4 rounded-xl border border-gray-200 bg-white p-3">
          <h2 className="text-xs font-semibold text-gray-700">本次规划使用的偏好</h2>
          <div className="mt-2 space-y-2 text-xs">
            {!!plan.hotelPreferences?.length && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-gray-500">酒店</span>
                {plan.hotelPreferences.map((preference) => (
                  <span key={preference} className="rounded-full bg-violet-50 px-2.5 py-1 text-violet-800">
                    {preference}
                  </span>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-gray-500">饮食</span>
              {plan.foodPreferences?.map((preference) => (
                <span key={preference} className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-900">
                  {preference}
                </span>
              ))}
              {plan.breakfastHabit && (
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-800">
                  早餐：{plan.breakfastHabit}
                </span>
              )}
            </div>
          </div>
        </section>
      )}

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}
      {repairing && (
        <div className="mb-4 rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-800">
          正在修复旧行程中的重复活动、模糊餐厅、缺失路线和时间冲突…
        </div>
      )}

      {plan.dailyPlans.length > 0 && (
        <section className="mb-5 rounded-2xl border border-[color:var(--line)] bg-[color:var(--paper-card)] p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-[color:var(--route)]">现在查看</p>
              <h2 className="mt-1 text-base font-semibold text-gray-900">{plan.dailyPlans[activeDay]?.dayLabel} 行程</h2>
              <p className="mt-1 text-sm text-gray-600">先看当天路线；预算、风险和已确认信息收在下方概览。</p>
            </div>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">已选方案</span>
          </div>
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {plan.dailyPlans.map((day, i) => (
              <button key={day.dayLabel} onClick={() => setActiveDay(i)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-all ${activeDay === i ? "bg-[color:var(--route)] text-white shadow-sm" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                {day.dayLabel}
              </button>
            ))}
          </div>
        </section>
      )}

      {plan.dailyPlans.length > 0 && <Timeline
        dayPlan={plan.dailyPlans[activeDay]}
        dayIndex={activeDay}
        city={plan.destination}
        onAdjust={handleAdjust}
        onRequestReplace={(dayIndex, blockId) => requestChoices(dayIndex, blockId)}
        pendingChoice={pendingChoice}
        onCloseChoice={() => setPendingChoice(null)}
        onChooseOption={async (option) => {
          if (!pendingChoice) return;
          const result = await handleAdjust(pendingChoice.dayIndex, pendingChoice.blockId, pendingChoice.action, option);
          if (result.status === "applied") setPendingChoice(null);
        }}
        onRecommendChoice={() => {
          if (pendingChoice) {
            const rejected = [...pendingChoice.rejectedOptionNames, ...pendingChoice.options.map((option) => option.name)];
            void requestChoices(pendingChoice.dayIndex, pendingChoice.blockId, pendingChoice.action, undefined, true, rejected);
          }
        }}
        recommendingChoice={loadingChoices}
        adjustingBlockId={adjustingBlockId}
        onCancelAdjust={cancelAdjust}
        onConfirmTransport={confirmTransport}
        confirmingTransportId={confirmingTransportId}
      />}

      {lastAdjustment && <AdjustmentReceipt result={lastAdjustment} />}

      {plan.dailyPlans.length > 0 && <details className="group mt-5 rounded-2xl border border-[color:var(--line)] bg-[color:var(--paper-card)] shadow-sm" open>
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-gray-900"><span className="flex items-center justify-between">行程概览与检查 <span aria-hidden="true" className="text-gray-400 group-open:rotate-180">⌄</span></span></summary>
        <div className="border-t border-[color:var(--line)] px-4 py-4">
      {plan.dailyPlans.length > 0 && <CostEstimateCard plan={plan} />}

      {plan.dailyPlans.length > 0 && (
        <PlanHealthPanel
          plan={plan}
          onOpenDay={setActiveDay}
          onOpenSavedPlaces={() => savedPlacesSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
          onOpenAssistant={(prompt) => {
            if (prompt) setAssistantPrompt({ id: `${Date.now()}`, text: prompt });
            window.setTimeout(() => assistantSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
          }}
        />
      )}

      {plan.dailyPlans.length > 0 && (
        <TravelUpdatePanel
          plan={plan}
          activeDay={activeDay}
          onOpenAssistant={(prompt) => {
            setAssistantPrompt({ id: `${Date.now()}`, text: prompt });
            window.setTimeout(() => assistantSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
          }}
        />
      )}

      {plan.dailyPlans.length > 0 && plan.outboundTransport && plan.returnTransport && (
        <div className="mb-4 p-4 rounded-xl bg-sky-50 border border-sky-200">
          <h3 className="text-sm font-semibold text-sky-950 mb-2">已确认往返交通</h3>
          <div className="space-y-1 text-sm text-sky-900">
            <p>
              去程：{plan.outboundTransport.serviceNumber} · {plan.outboundTransport.departureTerminal}{" "}
              {plan.outboundTransport.departTime} → {plan.outboundTransport.arrivalTerminal}{" "}
              {plan.outboundTransport.arriveTime}
              {plan.transportPricing?.kind === "per-leg"
                ? ` · ¥${plan.transportPricing.outboundPricePerPerson}/人`
                : plan.outboundTransport.pricePerPerson
                  ? ` · ¥${plan.outboundTransport.pricePerPerson}/人`
                  : ""}
            </p>
            <p>
              返程：{plan.returnTransport.serviceNumber} · {plan.returnTransport.departureTerminal}{" "}
              {plan.returnTransport.departTime} → {plan.returnTransport.arrivalTerminal}{" "}
              {plan.returnTransport.arriveTime}
              {plan.transportPricing?.kind === "per-leg"
                ? ` · ¥${plan.transportPricing.returnPricePerPerson}/人`
                : plan.returnTransport.pricePerPerson
                  ? ` · ¥${plan.returnTransport.pricePerPerson}/人`
                  : ""}
            </p>
            {plan.transportPricing?.kind === "round-trip-total" && (
              <p>往返合计：¥{plan.transportPricing.totalPricePerPerson}/人</p>
            )}
          </div>
        </div>
      )}

      {plan.dailyPlans.length > 0 && plan.selectedHotel && (
        <div className="mb-4 p-4 rounded-xl bg-violet-50 border border-violet-200">
          <h3 className="text-sm font-semibold text-violet-950">已确认酒店</h3>
          <p className="mt-1 text-sm text-violet-900">
            {plan.selectedHotel.name} · 入住总价 ¥{plan.selectedHotel.totalPrice}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <a
              href={hotelCtripUrl || "https://hotels.ctrip.com/"}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-violet-700"
            >
              {hotelCtripUrl ? "打开这家酒店的携程详情" : "打开携程复核价格"}
            </a>
            <a
              href={`https://www.amap.com/search?query=${encodeURIComponent(`${plan.destination} ${plan.selectedHotel.name}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-violet-700"
            >
              高德查看酒店
            </a>
          </div>
        </div>
      )}

      {(unscheduledSourcePOIs.length > 0 || (sourceCollection && selectedSavedCount > 0)) && (
        <section ref={savedPlacesSectionRef} className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-4">
          <h2 className="text-sm font-semibold text-rose-950">已保存地点对账 · {selectedSavedCount} 个</h2>
          <p className="mt-1 text-xs text-rose-800">可用于帖子行程 {sourceTotal} 个；已纳入 {sourceScheduledCount} 个，暂未纳入 {unscheduledSourcePOIs.length} 个。这里只显示能回到原帖名称和证据、或由你手动补充并保存的地点。</p>
          {rejectedSavedCount > 0 && (
            <p className="mt-2 text-xs text-amber-900">另有 {rejectedSavedCount} 条旧记录未同时通过“原帖名称＋证据”校验，已排除在帖子地点之外，不会再被当成你保存的地点。</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {unscheduledSourcePOIs.map((poi) => {
              const selected = selectedSourcePoiIds.includes(poi.id);
              return (
                <button
                  key={poi.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setSelectedSourcePoiIds((current) => selected ? current.filter((id) => id !== poi.id) : [...current, poi.id])}
                  className={`rounded-full border px-3 py-1.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700 ${selected ? "border-rose-500 bg-rose-600 text-white" : "border-rose-200 bg-white text-rose-900 hover:bg-rose-100"}`}
                >
                  {selected ? "已选 · " : ""}{poi.name}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {sourceCollection && sourceTotal === 0 && (
        <section className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          这份旧行程缺少可核对的帖子地点证据，因此不会展示“未纳入清单”，以免误把非原帖地点算进去。
        </section>
      )}

        </div>
      </details>}

      {plan.dailyPlans.length > 0 && (
        <section ref={assistantSectionRef}>
          <PlanAssistantChat
            plan={plan}
            onAdjust={handleAdjust}
            onGetChoices={getChoiceOptions}
            loadingChoices={loadingChoices}
            activeDayIndex={activeDay}
            adjustingBlockId={adjustingBlockId}
            onCancelAdjust={cancelAdjust}
            suggestedPrompt={assistantPrompt}
          />
        </section>
      )}

      {plan.dailyPlans.length > 0 && (
        <p className="mt-8 text-center text-xs text-gray-400">
          最低预估默认按公共交通计算；大交通和酒店使用你确认的价格，地图参考价与基础餐标可在费用明细中查看。
        </p>
      )}
      </div>
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
