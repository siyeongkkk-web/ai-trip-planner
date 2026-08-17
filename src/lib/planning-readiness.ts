import { getSelectedSavedCandidateCount, getUsableSavedCandidates } from "./poi-source";
import { POICandidate, POICollection, PlanningReadinessItem, PlanningReadinessReport } from "./types";

function placeKey(value?: string) {
  return String(value || "").replace(/[（）()·\s\-_—]/g, "").toLowerCase();
}

function isFood(candidate: POICandidate) {
  return /美食|餐饮|咖啡|甜品|酒吧|小吃/.test(candidate.category || "");
}

/**
 * 规划前准备度 Agent：只核对已有保存状态与容量启发式，不抽取、补造或修改地点。
 * “可开始”只代表输入可安全交给后续规划，不代表所有地点都必然会被排入行程。
 */
export function buildPlanningReadinessReport(
  collection: POICollection,
  days?: number
): PlanningReadinessReport {
  const items: PlanningReadinessItem[] = [];
  const selectedCount = getSelectedSavedCandidateCount(collection);
  const usable = getUsableSavedCandidates(collection);
  const selected = collection.candidates.filter((candidate) => candidate.selected);
  const mapUnverified = selected.filter((candidate) => candidate.mapVerification?.status !== "matched");

  if (!collection.city?.trim()) {
    items.push({
      id: "missing-city",
      status: "blocked",
      title: "尚未确认城市",
      detail: "地点必须按已确认城市做地图实体核验；请回到地点清单确认城市后再规划。",
    });
  } else {
    items.push({
      id: "city-ready",
      status: "ready",
      title: `城市已确认：${collection.city}`,
      detail: "后续路线与候选地点会以该城市为边界。",
    });
  }

  if (!selectedCount) {
    items.push({
      id: "no-selected-places",
      status: "blocked",
      title: "还没有选中要去的地点",
      detail: "请先在地点清单中勾选并保存至少一个地点。",
    });
  } else if (!usable.length) {
    items.push({
      id: "no-usable-places",
      status: "blocked",
      title: "已选地点暂不能安全用于规划",
      detail: "它们需要同时满足来源证据（或手动补充）与地图匹配，才会进入后续行程。",
    });
  } else {
    items.push({
      id: "usable-places",
      status: "ready",
      title: `${usable.length} 个已保存地点可用于规划`,
      detail: "每个地点都来自用户选择，且已具备地图匹配结果；不会由模型凭空补进帖子地点。",
    });
  }

  if (mapUnverified.length) {
    items.push({
      id: "map-unverified",
      status: "blocked",
      title: `${mapUnverified.length} 个已选地点尚未地图核验`,
      detail: `包括 ${mapUnverified.slice(0, 3).map((candidate) => candidate.name).join("、")}${mapUnverified.length > 3 ? "等" : ""}。请回到地点清单完成核验，不能由 Agent 猜测实体。`,
    });
  }

  const duplicates = new Map<string, POICandidate[]>();
  usable.forEach((candidate) => {
    const key = placeKey(candidate.mapVerification?.matchedName || candidate.name);
    if (!key) return;
    duplicates.set(key, [...(duplicates.get(key) || []), candidate]);
  });
  const duplicateGroups = [...duplicates.values()].filter((group) => group.length > 1);
  if (duplicateGroups.length) {
    items.push({
      id: "duplicate-places",
      status: "attention",
      title: `发现 ${duplicateGroups.length} 组可能重复地点`,
      detail: `例如 ${duplicateGroups[0].map((candidate) => candidate.name).join("、")} 可能匹配同一地图实体；规划前建议回到清单保留一个。`,
    });
  }

  if (usable.length && !usable.some(isFood)) {
    items.push({
      id: "food-gap",
      status: "attention",
      title: "保存清单中没有餐饮地点",
      detail: "这不阻止规划。生成方案时如出现餐饮缺口，系统才会以“助手推荐”身份提供附近候选供你确认。",
    });
  }

  if (days && usable.length > days * 5) {
    items.push({
      id: "capacity-warning",
      status: "attention",
      title: `${usable.length} 个地点可能无法在 ${days} 天内全部安排`,
      detail: `按每天天约 4–5 个主地点的保守容量估算，系统会明确保留未纳入清单与原因，不会假装全部排进去了。`,
    });
  } else if (days && usable.length) {
    items.push({
      id: "capacity-ready",
      status: "ready",
      title: `${days} 天的地点容量初步可安排`,
      detail: "这只是规划前估算；实际交通、营业时间与用户锁定项仍会在生成后继续核对。",
    });
  }

  const blocked = items.some((item) => item.status === "blocked");
  const attention = items.filter((item) => item.status === "attention").length;
  return {
    canStart: !blocked,
    summary: blocked
      ? "还不能开始规划：请先处理标记为“需补齐”的项目。"
      : attention
        ? `可以开始规划，但有 ${attention} 项会在方案中保留为待确认。`
        : "可以开始规划：地点来源、地图核验与当前容量均已就绪。",
    items,
  };
}
