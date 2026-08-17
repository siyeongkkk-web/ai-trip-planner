"use client";

import { useMemo } from "react";
import { calculateTripCostEstimate, EstimateSource } from "@/lib/cost-estimate";
import { TripPlan } from "@/lib/types";

const SOURCE_LABEL: Record<EstimateSource, string> = {
  confirmed: "已确认",
  amap: "地图参考",
  baseline: "基础预留",
};

const SOURCE_STYLE: Record<EstimateSource, string> = {
  confirmed: "bg-emerald-50 text-emerald-800 border-emerald-200",
  amap: "bg-sky-50 text-sky-800 border-sky-200",
  baseline: "bg-amber-50 text-amber-800 border-amber-200",
};

function yuan(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

export default function CostEstimateCard({ plan }: { plan: TripPlan }) {
  const estimate = useMemo(() => calculateTripCostEstimate(plan), [plan]);

  return (
    <section className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-emerald-950">费用预估（单人）</h2>
          <p className="mt-1 text-xs text-emerald-800">
            已确认交通和住宿 + 行程中的门票、餐饮、市内公共交通
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-emerald-800">最低预估</p>
          <p className="text-2xl font-bold text-emerald-800">¥{yuan(estimate.minimumPerPerson)}</p>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-emerald-200 bg-white/80 px-3 py-2 text-sm text-emerald-950">
        建议准备：<strong>¥{yuan(estimate.minimumPerPerson)}–¥{yuan(estimate.suggestedHighPerPerson)}/人</strong>
        {estimate.flexibleReserve > 0 && (
          <span className="ml-1 text-xs text-emerald-800">
            （含 ¥{yuan(estimate.flexibleReserve)} 的餐饮与市内出行浮动
            {estimate.unverifiedTicketReserve > 0 ? `，及 ¥${yuan(estimate.unverifiedTicketReserve)} 门票预留` : ""}）
          </span>
        )}
      </div>

      <details className="mt-3 rounded-lg border border-emerald-100 bg-white/70 px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium text-emerald-900">
          查看计算明细（{estimate.lines.length} 项）
        </summary>
        <div className="mt-3 space-y-2">
          {estimate.lines.map((line) => (
            <div key={line.id} className="flex items-start justify-between gap-3 text-xs">
              <div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium text-gray-800">{line.label}</span>
                  <span className={`rounded-full border px-1.5 py-0.5 ${SOURCE_STYLE[line.source]}`}>
                    {SOURCE_LABEL[line.source]}
                  </span>
                </div>
                <p className="mt-0.5 text-gray-500">{line.note}</p>
              </div>
              <strong className="shrink-0 text-gray-800">¥{yuan(line.amount)}</strong>
            </div>
          ))}
        </div>
      </details>

      {estimate.excludedTicketNames.length > 0 && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          以下景点未返回可核实票价，尚未计入最低预估：{estimate.excludedTicketNames.join("、")}；建议准备中已按每个 ¥30 预留。
        </p>
      )}
      <p className="mt-3 text-[11px] leading-5 text-emerald-800">
        “最低预估”默认按公共交通计算；切换打车、购物、伴手礼、升级房型和未列出门票不含在内。地图参考价格会变化，请以购票和商家页为准。
      </p>
    </section>
  );
}
