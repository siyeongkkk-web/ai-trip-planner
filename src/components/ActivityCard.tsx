"use client";

import { ActivityBlock, AdjustAction } from "@/lib/types";
import { activityMapUrl, activityPlace } from "@/lib/place-utils";

const CATEGORY_STYLES: Record<string, { bg: string; border: string; icon: string }> = {
  美食: { bg: "bg-orange-50", border: "border-orange-200", icon: "🍜" },
  文化古迹: { bg: "bg-blue-50", border: "border-blue-200", icon: "🏛" },
  自然风光: { bg: "bg-green-50", border: "border-green-200", icon: "🌿" },
  购物: { bg: "bg-pink-50", border: "border-pink-200", icon: "🛍" },
  亲子: { bg: "bg-purple-50", border: "border-purple-200", icon: "👨‍👩‍👧" },
  摄影打卡: { bg: "bg-indigo-50", border: "border-indigo-200", icon: "📸" },
  休闲: { bg: "bg-amber-50", border: "border-amber-200", icon: "☕" },
  住宿: { bg: "bg-slate-50", border: "border-slate-200", icon: "🏨" },
};

const DEFAULT_STYLE = { bg: "bg-gray-50", border: "border-gray-200", icon: "📍" };

interface Props {
  block: ActivityBlock;
  city: string;
  timeline?: boolean;
  onAdjust?: (action: AdjustAction) => void;
  onRequestReplace?: () => void;
  adjusting?: boolean;
  onCancelAdjust?: () => void;
}

export default function ActivityCard({ block, city, timeline = false, onAdjust, onRequestReplace, adjusting, onCancelAdjust }: Props) {
  const category = block.category || "休闲";
  const style = CATEGORY_STYLES[category] || DEFAULT_STYLE;
  const place = activityPlace(block);
  const amapUrl = activityMapUrl(block, city);
  const isFood = category.includes("美食");
  const mealLabel = /早餐|午餐|晚餐/.exec(block.title)?.[0];
  const xhsKeyword = place
    ? `${place}${isFood ? ` ${mealLabel || "美食"}` : " 攻略"}`
    : "";
  const xhsUrl = place
    ? `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(xhsKeyword)}&type=51`
    : undefined;
  const safeHighlights = (block.highlights || []).filter(
    (item) => !/[¥￥]\s*\d|(?:\d+(?:\.\d+)?)\s*元|\/只|\/人/.test(item)
  );
  const safeCost =
    block.cost &&
    (block.costSource === "amap-reference" ||
      !/[¥￥]\s*\d|(?:\d+(?:\.\d+)?)\s*元/.test(block.cost))
      ? block.cost
      : "价格待核实";
  const isFlexibleActivity = block.activityKind === "flexible";

  return (
    <div className={`relative rounded-xl border ${timeline ? "border-[color:var(--line)] bg-[color:var(--paper-card)]" : `${style.border} ${style.bg}`} p-4 shadow-sm transition-all hover:shadow-md`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={timeline ? "text-base" : "text-lg"}>{style.icon}</span>
            {!timeline && <span className="text-sm font-medium text-gray-500">{block.startTime} - {block.endTime}</span>}
            <span className="ml-auto text-xs font-medium text-gray-500 tnum">{block.startTime}–{block.endTime} · {block.duration}</span>
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-gray-900">{block.title}</h3>
            {block.origin === "assistant-recommended" && <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-800">小助手推荐 · 附近</span>}
            {isFlexibleActivity && <span className="rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-800">自由活动 · 不固化景点</span>}
            {block.origin === "post" && <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-800">来自帖子清单</span>}
          </div>
          {block.address && !isFlexibleActivity && (
            <p className="mb-2 text-xs text-gray-500">地址：{block.address}</p>
          )}

          {safeHighlights.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {safeHighlights.map((h, i) => (
                <span
                  key={i}
                  className="text-xs px-2 py-0.5 rounded-full bg-white/80 text-gray-700 border border-gray-200/60"
                >
                  {h}
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
            <span>⏱ {block.duration}</span>
            <span>💰 {safeCost}</span>
          </div>
          <div className="flex flex-wrap gap-x-3 mt-1.5 text-xs">
            {amapUrl && (
              <a
                href={amapUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-800 hover:underline"
              >
                📍 高德地图{block.matchedName ? "（已定位）" : ""}
              </a>
            )}
            {xhsUrl && !isFlexibleActivity && (
              <a
                href={xhsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-red-500 hover:text-red-700 hover:underline"
              >
                📕 小红书攻略
              </a>
            )}
            {!place && (
              <span className="text-gray-400">这是行程动作，不生成地点搜索</span>
            )}
          </div>
          {block.tip && (
            <p className="mt-2 text-sm text-gray-500 bg-white/60 rounded-lg px-3 py-1.5">
              💡 {block.tip}
            </p>
          )}
        </div>
      </div>

      {onAdjust && (
        <div className="flex gap-2 mt-3 pt-3 border-t border-gray-200/60">
          <button
            onClick={() => onAdjust("remove")}
            disabled={adjusting}
            className="text-xs px-3 py-1.5 rounded-full bg-white border border-gray-200 text-gray-600 hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors disabled:opacity-50"
          >
            不想去
          </button>
          <button
            onClick={() => onAdjust("extend")}
            disabled={adjusting}
            className="text-xs px-3 py-1.5 rounded-full bg-white border border-gray-200 text-gray-600 hover:bg-amber-50 hover:border-amber-200 hover:text-amber-600 transition-colors disabled:opacity-50"
          >
            多待会
          </button>
          <button
            onClick={() => onRequestReplace ? onRequestReplace() : onAdjust("replace")}
            disabled={adjusting}
            className="text-xs px-3 py-1.5 rounded-full bg-white border border-gray-200 text-gray-600 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-600 transition-colors disabled:opacity-50"
          >
            先看可换选项
          </button>
        </div>
      )}

      {adjusting && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/80">
          <div className="flex flex-col items-center gap-3 text-sm text-gray-600">
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span role="status">正在重新计算时间与路线...</span>
            </div>
            {onCancelAdjust && (
              <button
                type="button"
                onClick={onCancelAdjust}
                className="cursor-pointer rounded-full border border-gray-300 bg-white px-4 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
              >
                取消
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
