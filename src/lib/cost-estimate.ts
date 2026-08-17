import { ActivityBlock, TransportBlock, TripPlan } from "./types";

export type EstimateSource = "confirmed" | "amap" | "baseline";

export interface CostEstimateLine {
  id: string;
  label: string;
  amount: number;
  source: EstimateSource;
  note: string;
}

export interface CostEstimate {
  minimumPerPerson: number;
  suggestedHighPerPerson: number;
  flexibleReserve: number;
  unverifiedTicketReserve: number;
  lines: CostEstimateLine[];
  excludedTicketNames: string[];
  localTransportFallbackLegs: number;
}

const BASIC_MEAL_BUDGET: Record<"早餐" | "午餐" | "晚餐", number> = {
  早餐: 15,
  午餐: 35,
  晚餐: 45,
};

const PUBLIC_TRANSPORT_FALLBACK = 3;
const UNVERIFIED_TICKET_RESERVE = 30;

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function moneyIn(text?: string): number | undefined {
  const match = String(text || "").match(/[¥￥]\s*(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : undefined;
}

function activityMealKind(block: ActivityBlock): "早餐" | "午餐" | "晚餐" | null {
  if (/早餐/.test(block.title)) return "早餐";
  if (/午餐/.test(block.title)) return "午餐";
  if (/晚餐/.test(block.title)) return "晚餐";
  return null;
}

function confirmedTransportAmount(plan: TripPlan): number | undefined {
  if (plan.transportPricing?.kind === "per-leg") {
    return plan.transportPricing.outboundPricePerPerson + plan.transportPricing.returnPricePerPerson;
  }
  if (plan.transportPricing?.kind === "round-trip-total") {
    return plan.transportPricing.totalPricePerPerson;
  }
  const outbound = plan.outboundTransport?.pricePerPerson;
  const inbound = plan.returnTransport?.pricePerPerson;
  return outbound !== undefined && inbound !== undefined ? outbound + inbound : undefined;
}

function publicTransportCost(block: TransportBlock): { amount: number; fallback: boolean } | null {
  if (block.mode === "walking") return null;
  // 打车区间只是路线比较的粗估，不把它当作确定预算混入最低预估。
  if (block.mode === "taxi") return null;
  const displayed = moneyIn(block.cost);
  if (displayed !== undefined) return { amount: displayed, fallback: false };

  // “最低预估”统一采用这段路线可行的公交/地铁方案；即使当前只是查看打车方案，
  // 也不把无法核实的打车价格偷偷写进预算。
  const transitAlternative = block.alternatives?.find((item) => item.mode === "subway");
  if (transitAlternative?.estimatedCost !== undefined) {
    return { amount: transitAlternative.estimatedCost, fallback: false };
  }
  if (block.mode === "subway" || transitAlternative) {
    return { amount: PUBLIC_TRANSPORT_FALLBACK, fallback: true };
  }
  return null;
}

/**
 * 费用只在浏览器本地按已生成的行程计算：
 * - 已确认的大交通、酒店使用用户输入；
 * - 地图价格/人均使用高德返回值；
 * - 地图没有餐饮价格时使用公开展示的基础餐标；
 * - 不知道票价的景点绝不伪造金额，单列为“未纳入”。
 */
export function calculateTripCostEstimate(plan: TripPlan): CostEstimate {
  const lines: CostEstimateLine[] = [];
  const excludedTicketNames: string[] = [];
  let localTransportFallbackLegs = 0;

  const longDistance = confirmedTransportAmount(plan);
  if (longDistance !== undefined) {
    lines.push({
      id: "long-distance",
      label: "往返交通",
      amount: longDistance,
      source: "confirmed",
      note: "使用你确认的票价",
    });
  }

  if (plan.selectedHotel && plan.selectedHotel.totalPrice >= 0) {
    const travelers = Math.max(1, plan.travelers || 1);
    lines.push({
      id: "hotel",
      label: "住宿",
      amount: roundMoney(plan.selectedHotel.totalPrice / travelers),
      source: "confirmed",
      note: `${plan.selectedHotel.name}，入住总价按 ${travelers} 人分摊`,
    });
  }

  let transitTotal = 0;
  for (const day of plan.dailyPlans) {
    for (const block of day.blocks) {
      if (block.type !== "transport") continue;
      const cost = publicTransportCost(block);
      if (!cost) continue;
      transitTotal += cost.amount;
      if (cost.fallback) localTransportFallbackLegs += 1;
    }
  }
  if (transitTotal > 0) {
    lines.push({
      id: "local-transport",
      label: "市内交通",
      amount: roundMoney(transitTotal),
      source: localTransportFallbackLegs ? "baseline" : "amap",
      note: localTransportFallbackLegs
        ? `按 ${localTransportFallbackLegs} 段未返回票价的公交/地铁路线各 ¥${PUBLIC_TRANSPORT_FALLBACK} 预留`
        : "按高德路线返回的公共交通票价计算",
    });
  }

  for (const day of plan.dailyPlans) {
    for (const block of day.blocks) {
      if (block.type !== "activity" || block.category === "住宿") continue;
      const mealKind = activityMealKind(block);
      const mapPrice = block.costSource === "amap-reference" ? moneyIn(block.cost) : undefined;
      if (mealKind) {
        const amount = mapPrice ?? BASIC_MEAL_BUDGET[mealKind];
        lines.push({
          id: `meal-${block.id}`,
          label: `${day.dayLabel}${mealKind}`,
          amount,
          source: mapPrice !== undefined ? "amap" : "baseline",
          note:
            mapPrice !== undefined
              ? `${block.placeName || block.title}：高德参考人均`
              : `${block.placeName || block.title}：未返回人均，按基础餐标预留`,
        });
        continue;
      }
      if (mapPrice !== undefined) {
        lines.push({
          id: `ticket-${block.id}`,
          label: `${day.dayLabel}门票`,
          amount: mapPrice,
          source: "amap",
          note: `${block.placeName || block.title}：高德参考票价`,
        });
      } else if (block.category !== "休闲" && block.category !== "购物") {
        excludedTicketNames.push(block.placeName || block.title);
      }
    }
  }

  const minimumPerPerson = roundMoney(lines.reduce((sum, item) => sum + item.amount, 0));
  // 浮动只加在本来就会波动的市内消费上，不对用户已确认的交通与酒店重复加价。
  const flexibleBase = lines
    .filter((item) => item.id !== "long-distance" && item.id !== "hotel")
    .reduce((sum, item) => sum + item.amount, 0);
  const flexibleReserve = flexibleBase > 0 ? Math.max(50, Math.round(flexibleBase * 0.15)) : 0;
  const uniqueExcludedTicketNames = [...new Set(excludedTicketNames)].slice(0, 8);
  const unverifiedTicketReserve = uniqueExcludedTicketNames.length * UNVERIFIED_TICKET_RESERVE;

  return {
    minimumPerPerson,
    suggestedHighPerPerson: minimumPerPerson + flexibleReserve + unverifiedTicketReserve,
    flexibleReserve,
    unverifiedTicketReserve,
    lines,
    excludedTicketNames: uniqueExcludedTicketNames,
    localTransportFallbackLegs,
  };
}
