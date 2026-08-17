"use client";

import { useState } from "react";
import { ActivityOption } from "@/lib/types";

interface Props {
  title: string;
  options: ActivityOption[];
  busy?: boolean;
  onChoose: (option: ActivityOption) => void;
  onRecommend: () => void;
  recommending?: boolean;
  onClose: () => void;
}

export default function ActivityChoicePanel({ title, options, busy, onChoose, onRecommend, recommending, onClose }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = options.find((option) => option.id === selectedId);
  const includesAssistantOptions = options.some((option) => option.origin === "assistant-recommended");
  const includesAgentSlots = options.some((option) => option.proposedAnchorBlockId);
  return (
    <section className="mb-4 rounded-xl border border-teal-200 bg-teal-50 p-4" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-teal-950">
            {includesAgentSlots ? "选择一个顺路方案，再更新行程" : "先选一个，再更新后续行程"}
          </h2>
          <p className="mt-1 text-xs text-teal-800">
            {includesAgentSlots
              ? "Agent 已比较不同日期和插入位置；所有既有活动默认锁定，确认前不会改变行程。"
              : includesAssistantOptions
              ? "这些是已核对地点与预计到达时段的附近候选；选择前不会改变当前行程。"
              : "这些是已保存但暂未纳入的地点；选择前不会改变当前行程。"}
          </p>
          {!includesAgentSlots && <p className="mt-1 text-xs text-teal-700">当前活动：{title}</p>}
        </div>
        <button type="button" onClick={onClose} className="text-xs text-teal-800 underline">取消</button>
      </div>
      {options.length ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              disabled={busy}
              onClick={() => setSelectedId(option.id)}
              className={`rounded-lg border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-50 ${selectedId === option.id ? "border-teal-600 bg-teal-100" : "border-teal-200 bg-white hover:bg-teal-100"}`}
            >
              <p className="text-sm font-medium text-gray-900">{option.activityKind === "flexible" ? `自由活动：${option.flexibleArea || option.name}` : option.name}</p>
              <p className="mt-1 text-xs text-gray-500">{option.activityKind === "flexible" ? "不对应单一景点，可按现场情况自由安排" : option.address || "地址请在地图复核"}</p>
              {option.proposedAnchorBlockId && (
                <div className="mt-2 space-y-1 text-xs text-gray-700">
                  <p>Day {(option.proposedDayIndex || 0) + 1} · 在“{option.proposedAnchorTitle}”后</p>
                  <p>{option.estimatedStartTime}–{option.estimatedEndTime} · 预计新增交通约 {option.estimatedAddedTravelMinutes || 0} 分钟</p>
                  <p>预计当天约 {option.projectedDayEndTime} 结束</p>
                </div>
              )}
              <p className="mt-2 text-xs font-medium text-teal-800">{option.origin === "post" ? "来自帖子清单" : "小助手推荐 · 附近"}</p>
              {option.businessHours ? <p className="mt-1 text-xs text-gray-600">地图营业时间：{option.businessHours}</p> : null}
              {option.origin === "assistant-recommended" && option.openingStatus === "open" ? (
                <p className="mt-1 text-xs font-medium text-teal-800">预计到达时营业 · 已核对</p>
              ) : null}
              {option.agentReason && <p className="mt-1 text-xs text-teal-900">{option.agentReason}</p>}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-teal-900">这里没有可用的已保存地点，当前行程没有变化。</p>
      )}
      {selected && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-teal-900">已选：{selected.name}</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => onChoose(selected)}
            className="rounded-lg bg-teal-700 px-3 py-2 text-xs font-medium text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-50"
          >
            {busy ? "正在更新…" : includesAgentSlots ? "确认这个方案并更新行程" : "确认并更新后续行程"}
          </button>
        </div>
      )}
      {!includesAgentSlots && <div className="mt-3 border-t border-teal-200 pt-3">
        <p className="text-xs text-teal-900">都不想去？下一批会排除本批地点，只展示新的高德真实候选。</p>
        <button
          type="button"
          disabled={busy || recommending}
          onClick={onRecommend}
          className="mt-2 rounded-lg border border-teal-300 bg-white px-3 py-2 text-xs font-medium text-teal-800 hover:bg-teal-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-50"
        >
          {recommending ? "正在换一批…" : includesAssistantOptions ? "这一批也不想去，换一批" : "都不想去，让小助手推荐附近地点"}
        </button>
      </div>}
    </section>
  );
}
