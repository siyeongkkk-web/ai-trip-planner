"use client";

import { ActivityBlock, AdjustAction } from "@/lib/types";

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
  onAdjust?: (action: AdjustAction) => void;
  adjusting?: boolean;
}

export default function ActivityCard({ block, onAdjust, adjusting }: Props) {
  const style = CATEGORY_STYLES[block.category] || DEFAULT_STYLE;
  const mapQuery = encodeURIComponent(block.title);
  const mapUrl = `https://uri.amap.com/search?keyword=${mapQuery}`;

  return (
    <div className={`relative rounded-xl border ${style.border} ${style.bg} p-4 shadow-sm transition-all hover:shadow-md`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">{style.icon}</span>
            <span className="text-sm font-medium text-gray-500">
              {block.startTime} - {block.endTime}
            </span>
          </div>
          <h3 className="text-base font-semibold text-gray-900 mb-2">{block.title}</h3>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
            <span>⏱ {block.duration}</span>
            <span>💰 {block.cost}</span>
            <a
              href={mapUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-800 hover:underline"
            >
              📍 在地图中查看
            </a>
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
            onClick={() => onAdjust("replace")}
            disabled={adjusting}
            className="text-xs px-3 py-1.5 rounded-full bg-white border border-gray-200 text-gray-600 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-600 transition-colors disabled:opacity-50"
          >
            换一个
          </button>
        </div>
      )}

      {adjusting && (
        <div className="absolute inset-0 bg-white/70 rounded-xl flex items-center justify-center">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            AI 正在重新规划...
          </div>
        </div>
      )}
    </div>
  );
}
