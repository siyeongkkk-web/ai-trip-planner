import { buildLeg, getPlaceBusinessHours, searchAround, searchPlaces } from "./amap";
import { haversine } from "./planner";
import {
  ActivityBlock,
  ActivityOption,
  Block,
  DayPlan,
  TripPlan,
} from "./types";

export interface ResolvedAgentPlace {
  handle: string;
  mapPOIId?: string;
  name: string;
  address?: string;
  lng: number;
  lat: number;
  type?: string;
  businessHours?: string;
  matchedFrom: string;
}

export interface AgentDayAnalysis {
  day: number;
  firstStart?: string;
  lastEnd?: string;
  activityCount: number;
  activityMinutes: number;
  transportMinutes: number;
  scheduledSpanMinutes: number;
  unallocatedMinutes: number;
  longestGapMinutes: number;
  summary: string;
}

export interface AgentBusinessHoursCheck {
  name: string;
  businessHours?: string;
  requestedTime?: string;
  status: "open" | "closed" | "unknown";
  message: string;
}

/**
 * 仅供评测 Trace 使用的候选筛选证据；不会传给模型，也不会改变推荐结果。
 * 它将“没有候选”拆成可复核的地图检索、详情、路线、时间和营业状态原因。
 */
export interface RecommendationDiagnostic {
  stage: "search" | "detail" | "filter" | "route" | "result";
  name?: string;
  mapPOIId?: string;
  reason?: string;
  businessHours?: string;
  expectedStartTime?: string;
  addedTravelMinutes?: number;
  projectedDayEndTime?: string;
}

export type InsertionRejectionReason =
  | "visit-crosses-closing"
  | "insufficient-return-buffer"
  | "no-feasible-insertion-slot";

export interface InsertionOptionsResult {
  options: ActivityOption[];
  rejection?: {
    reasonCode: InsertionRejectionReason;
    facts: Record<string, unknown>;
  };
  diagnostics: Array<{
    day: number;
    anchorBlockId: string;
    reasonCode?: InsertionRejectionReason;
    estimatedStartTime?: string;
    estimatedEndTime?: string;
    businessHours?: string;
    latestReturnArrivalTime?: string;
    projectedReturnArrivalTime?: string;
  }>;
}

export type RecommendationDiagnosticsSink = (event: RecommendationDiagnostic) => void;

function placeKey(value?: string) {
  return String(value || "")
    .replace(/[（）()·\s\-—_]/g, "")
    .toLowerCase();
}

function hmToMinutes(value?: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return Number.isFinite(minutes) ? minutes : null;
}

function minutesToHm(value: number) {
  const safe = Math.max(0, Math.min(23 * 60 + 59, Math.round(value)));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

/** 未返回结构化时段时保持 unknown，绝不把“未返回”当作“晚上开放”。 */
export function businessHoursStatus(hours?: string, atTime?: string): "open" | "closed" | "unknown" {
  const target = hmToMinutes(atTime);
  if (!hours || target === null) return "unknown";
  const matches = [...hours.matchAll(/(\d{1,2}:\d{2})\s*[-~—–至]\s*(\d{1,2}:\d{2})/g)];
  if (!matches.length) return "unknown";
  for (const match of matches) {
    const start = hmToMinutes(match[1]);
    const end = hmToMinutes(match[2]);
    if (start === null || end === null) continue;
    if (end >= start ? target >= start && target <= end : target >= start || target <= end) return "open";
  }
  return "closed";
}

export function checkAgentBusinessHours(option: ActivityOption, atTime?: string): AgentBusinessHoursCheck {
  const status = businessHoursStatus(option.businessHours, atTime);
  return {
    name: option.name,
    businessHours: option.businessHours,
    requestedTime: atTime,
    status,
    message: status === "open"
      ? `地图营业时间显示 ${option.businessHours}，${atTime} 在该时段内。`
      : status === "closed"
        ? `地图营业时间显示 ${option.businessHours}，${atTime} 不在该时段内。`
        : "地图没有返回可用于核对的营业时间，不能据此断言晚上开放。",
  };
}

/** 将“沿线散步、周边夜景”等非 POI 需求显式建模为自由活动，不伪造一个景点。 */
export function proposeFlexibleActivity(
  plan: TripPlan,
  dayNumber: number,
  anchorBlockId: string,
  area: string,
  visitMinutes = 45
): ActivityOption | null {
  const dayIndex = dayNumber - 1;
  const anchor = activities(plan.dailyPlans[dayIndex] || { dayLabel: "", blocks: [] })
    .find((activity) => activity.id === anchorBlockId);
  if (!anchor || !Number.isFinite(anchor.lng) || !Number.isFinite(anchor.lat)) return null;
  const start = (hmToMinutes(anchor.endTime) || 0) + 5;
  const end = start + Math.max(15, Math.min(180, visitMinutes));
  if (end > dayDeadline(plan, dayIndex)) return null;
  return {
    id: `agent-flexible-${dayIndex}-${anchor.id}-${area.replace(/\s/g, "").slice(0, 16)}`,
    name: area,
    category: "休闲",
    note: "自由活动建议，不对应单一地图地点；按当晚现场情况散步、看夜景即可。",
    lng: anchor.lng as number,
    lat: anchor.lat as number,
    origin: "assistant-recommended",
    activityKind: "flexible",
    flexibleArea: area,
    proposedDayIndex: dayIndex,
    proposedAnchorBlockId: anchor.id,
    proposedAnchorTitle: anchor.title,
    estimatedStartTime: minutesToHm(start),
    estimatedEndTime: minutesToHm(end),
    estimatedAddedTravelMinutes: 0,
    projectedDayEndTime: minutesToHm(end),
    agentReason: `作为“${anchor.title}”后的自由活动时段，不替代任何既有地点。`,
  };
}

function durationTextMinutes(value?: string) {
  const hours = /([\d.]+)\s*小时/.exec(String(value || ""));
  const minutes = /(\d+)\s*分钟/.exec(String(value || ""));
  return Math.round(Number(hours?.[1] || 0) * 60 + Number(minutes?.[1] || 0));
}

function activityDurationMinutes(activity: ActivityBlock) {
  return activity.durationMinutes || Math.max(
    0,
    (hmToMinutes(activity.endTime) || 0) - (hmToMinutes(activity.startTime) || 0)
  );
}

function activities(day: DayPlan) {
  return day.blocks.filter(
    (block): block is ActivityBlock =>
      block.type === "activity" &&
      Number.isFinite(block.lng) &&
      Number.isFinite(block.lat)
  );
}

function existingTravelMinutes(
  blocks: Block[],
  anchorId: string,
  nextActivityId?: string
) {
  const anchorIndex = blocks.findIndex((block) => block.id === anchorId);
  if (anchorIndex < 0) return 0;
  let total = 0;
  for (let index = anchorIndex + 1; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.type === "activity") {
      if (!nextActivityId || block.id === nextActivityId) break;
      continue;
    }
    total += durationTextMinutes(block.duration);
  }
  return total;
}

function categoryFromType(type?: string) {
  if (/餐饮|咖啡|甜品/.test(type || "")) return "美食";
  if (/购物|商业街/.test(type || "")) return "购物";
  if (/风景名胜|公园/.test(type || "")) return "自然风光";
  if (/科教文化|博物馆|展览/.test(type || "")) return "文化古迹";
  return "休闲";
}

/**
 * 地点身份工具：模型可以提供俗称的可能别名，但只有高德实际返回的实体才能进入下一步。
 * `matchedFrom` 会保留是哪一个检索词命中的，界面不会把模型猜测冒充地图事实。
 */
export async function resolveAgentPlaces(
  query: string,
  city: string,
  aliases: string[] = []
): Promise<ResolvedAgentPlace[]> {
  const terms = [...new Set([query, ...aliases].map((item) => item.trim()).filter(Boolean))].slice(0, 5);
  const seen = new Set<string>();
  const resolved: ResolvedAgentPlace[] = [];
  for (const term of terms) {
    const places = await searchPlaces(term, city, 8);
    const requested = placeKey(term);
    const ranked = [...places].sort((a, b) => {
      const score = (name: string) => {
        const key = placeKey(name);
        if (key === requested) return 3;
        if (key.includes(requested) || requested.includes(key)) return 2;
        return 0;
      };
      return score(b.name) - score(a.name);
    });
    let acceptedForTerm = 0;
    for (const place of ranked) {
      if (/公交站|地铁站|停车场|出入口|售票处|服务区|酒店|宾馆/.test(`${place.name}${place.type || ""}`)) continue;
      const identity = place.id || `${place.name}-${place.lng}-${place.lat}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      resolved.push({
        handle: `place-${resolved.length + 1}`,
        mapPOIId: place.id,
        name: place.name,
        address: place.address,
        lng: place.lng,
        lat: place.lat,
        type: place.type,
        businessHours: place.businessHours,
        matchedFrom: term,
      });
      acceptedForTerm += 1;
      if (acceptedForTerm >= 2) break;
    }
  }
  return resolved.slice(0, 6);
}

type CandidateSlot = {
  dayIndex: number;
  anchor: ActivityBlock;
  next?: ActivityBlock;
  straightDetour: number;
};

function dayDeadline(plan: TripPlan, dayIndex: number) {
  const isLastDay = dayIndex === plan.dailyPlans.length - 1;
  if (!isLastDay) return 23 * 60 + 59;
  const departure = hmToMinutes(plan.returnTransport?.departTime);
  if (departure === null) return 23 * 60 + 59;
  return departure - (plan.returnTransport?.mode === "flight" ? 90 : 60);
}

function visitFitsBusinessHours(hours: string | undefined, startMinutes: number, endMinutes: number) {
  if (!hours) return true;
  const windows = [...hours.matchAll(/(\d{1,2}:\d{2})\s*[-~—–至]\s*(\d{1,2}:\d{2})/g)];
  if (!windows.length) return true;
  return windows.some((window) => {
    const open = hmToMinutes(window[1]);
    const close = hmToMinutes(window[2]);
    if (open === null || close === null) return false;
    if (close >= open) return startMinutes >= open && endMinutes <= close;
    const normalizedEnd = endMinutes < startMinutes ? endMinutes + 24 * 60 : endMinutes;
    return startMinutes >= open && normalizedEnd <= close + 24 * 60;
  });
}

type InsertionToolDependencies = {
  searchPlaces: typeof searchPlaces;
  buildLeg: typeof buildLeg;
};

const DEFAULT_INSERTION_TOOL_DEPENDENCIES: InsertionToolDependencies = {
  searchPlaces,
  buildLeg,
};

/**
 * 跨天顺路插入模拟：先用直线增量筛掉明显绕路位置，再用高德路线核对候选。
 * 这里只生成提案，不修改 plan；全部原活动始终作为硬约束保留。
 */
export async function findBestInsertionOptions(
  plan: TripPlan,
  place: ResolvedAgentPlace,
  visitMinutes = 60,
  allowedDayNumbers: number[] = []
): Promise<ActivityOption[]> {
  const result = await findBestInsertionOptionsWithDiagnostics(
    plan,
    place,
    visitMinutes,
    allowedDayNumbers
  );
  return result.options;
}

/**
 * 与生产插入算法共用同一条路线和时间计算，同时保留空结果的结构化原因。
 * 评测可注入固定路线事实；生产默认仍使用真实地图搜索与路线函数。
 */
export async function findBestInsertionOptionsWithDiagnostics(
  plan: TripPlan,
  place: ResolvedAgentPlace,
  visitMinutes = 60,
  allowedDayNumbers: number[] = [],
  dependencies: Partial<InsertionToolDependencies> = {}
): Promise<InsertionOptionsResult> {
  const deps = { ...DEFAULT_INSERTION_TOOL_DEPENDENCIES, ...dependencies };
  const allowed = new Set(allowedDayNumbers.filter((day) => day >= 1 && day <= plan.dailyPlans.length));
  const hotelCandidates = plan.selectedHotel?.name
    ? await deps.searchPlaces(plan.selectedHotel.name, plan.destination, 3)
    : [];
  const hotel = hotelCandidates[0];
  const returnTerminalCandidates = plan.returnTransport?.departureTerminal
    ? await deps.searchPlaces(plan.returnTransport.departureTerminal, plan.destination, 3)
    : [];
  const returnTerminal = returnTerminalCandidates[0];
  const shortList: CandidateSlot[] = [];

  plan.dailyPlans.forEach((day, dayIndex) => {
    if (allowed.size && !allowed.has(dayIndex + 1)) return;
    const dayActivities = activities(day);
    const slots = dayActivities.map((anchor, index) => {
      const next = dayActivities[index + 1];
      const isLastDay = dayIndex === plan.dailyPlans.length - 1;
      const end = next
        ? { lng: next.lng as number, lat: next.lat as number }
        : isLastDay && returnTerminal
          ? { lng: returnTerminal.lng, lat: returnTerminal.lat }
        : hotel
          ? { lng: hotel.lng, lat: hotel.lat }
          : undefined;
      const anchorPoint = { lng: anchor.lng as number, lat: anchor.lat as number };
      const placePoint = { lng: place.lng, lat: place.lat };
      const straightDetour = end
        ? haversine(anchorPoint, placePoint) +
          haversine(placePoint, end) -
          haversine(anchorPoint, end)
        : haversine(anchorPoint, placePoint);
      return { dayIndex, anchor, next, straightDetour };
    });
    shortList.push(...slots.sort((a, b) => a.straightDetour - b.straightDetour).slice(0, 2));
  });

  const evaluated: ActivityOption[] = [];
  const diagnostics: InsertionOptionsResult["diagnostics"] = [];
  for (const slot of shortList) {
    const day = plan.dailyPlans[slot.dayIndex];
    const anchorPoint = {
      name: slot.anchor.matchedName || slot.anchor.placeName || slot.anchor.title,
      lng: slot.anchor.lng as number,
      lat: slot.anchor.lat as number,
    };
    const candidatePoint = { name: place.name, lng: place.lng, lat: place.lat };
    const isLastDay = slot.dayIndex === plan.dailyPlans.length - 1;
    const endPoint = slot.next
      ? {
          name: slot.next.matchedName || slot.next.placeName || slot.next.title,
          lng: slot.next.lng as number,
          lat: slot.next.lat as number,
        }
      : isLastDay && returnTerminal
        ? { name: returnTerminal.name, lng: returnTerminal.lng, lat: returnTerminal.lat }
      : hotel
        ? { name: hotel.name, lng: hotel.lng, lat: hotel.lat }
        : undefined;
    const toCandidate = await deps.buildLeg(anchorPoint, candidatePoint, plan.destination, plan.publicTransportTaxiThreshold || 60);
    const fromCandidate = endPoint
      ? await deps.buildLeg(candidatePoint, endPoint, plan.destination, plan.publicTransportTaxiThreshold || 60)
      : null;
    const oldTravel = existingTravelMinutes(day.blocks, slot.anchor.id, slot.next?.id);
    const addedTravel = Math.max(
      0,
      toCandidate.durationMinutes + (fromCandidate?.durationMinutes || 0) - oldTravel
    );
    const lastEnd = activities(day)
      .map((activity) => hmToMinutes(activity.endTime) || 0)
      .reduce((max, value) => Math.max(max, value), 0);
    const projectedEnd = lastEnd + visitMinutes + addedTravel;
    const anchorEnd = hmToMinutes(slot.anchor.endTime) || lastEnd;
    const start = anchorEnd + toCandidate.durationMinutes;
    const visitEnd = start + visitMinutes;
    if (!visitFitsBusinessHours(place.businessHours, start, visitEnd)) {
      diagnostics.push({
        day: slot.dayIndex + 1,
        anchorBlockId: slot.anchor.id,
        reasonCode: "visit-crosses-closing",
        estimatedStartTime: minutesToHm(start),
        estimatedEndTime: minutesToHm(visitEnd),
        businessHours: place.businessHours,
      });
      continue;
    }
    const deadline = dayDeadline(plan, slot.dayIndex);
    if (projectedEnd > deadline) {
      diagnostics.push({
        day: slot.dayIndex + 1,
        anchorBlockId: slot.anchor.id,
        reasonCode: isLastDay && plan.returnTransport ? "insufficient-return-buffer" : "no-feasible-insertion-slot",
        latestReturnArrivalTime: isLastDay && plan.returnTransport ? minutesToHm(deadline) : undefined,
        projectedReturnArrivalTime: isLastDay && plan.returnTransport ? minutesToHm(projectedEnd) : undefined,
      });
      continue;
    }
    diagnostics.push({
      day: slot.dayIndex + 1,
      anchorBlockId: slot.anchor.id,
      estimatedStartTime: minutesToHm(start),
      estimatedEndTime: minutesToHm(visitEnd),
      projectedReturnArrivalTime: isLastDay && plan.returnTransport ? minutesToHm(projectedEnd) : undefined,
    });
    evaluated.push({
      id: `agent-slot-${place.mapPOIId || place.handle}-${slot.dayIndex}-${slot.anchor.id}`,
      name: place.name,
      address: place.address,
      category: categoryFromType(place.type),
      note: `地图实体由“${place.matchedFrom}”检索并核对；确认后才写入行程。`,
      lng: place.lng,
      lat: place.lat,
      origin: "assistant-recommended",
      proposedDayIndex: slot.dayIndex,
      proposedAnchorBlockId: slot.anchor.id,
      proposedAnchorTitle: slot.anchor.title,
      estimatedStartTime: minutesToHm(start),
      estimatedEndTime: minutesToHm(visitEnd),
      estimatedAddedTravelMinutes: addedTravel,
      projectedDayEndTime: minutesToHm(projectedEnd),
      agentReason: `安排在 Day ${slot.dayIndex + 1} 的“${slot.anchor.title}”后，预计新增约 ${addedTravel} 分钟交通；所有既有活动保持原相对顺序。`,
      businessHours: place.businessHours,
    });
  }

  const options = evaluated
    .sort((a, b) =>
      (a.estimatedAddedTravelMinutes || 0) - (b.estimatedAddedTravelMinutes || 0)
    )
    .slice(0, 3);
  if (options.length) return { options, diagnostics };
  const prioritized = diagnostics.find((item) => item.reasonCode === "visit-crosses-closing")
    || diagnostics.find((item) => item.reasonCode === "insufficient-return-buffer")
    || diagnostics.find((item) => item.reasonCode);
  return {
    options,
    diagnostics,
    rejection: {
      reasonCode: prioritized?.reasonCode || "no-feasible-insertion-slot",
      facts: prioritized || { allowedDayNumbers, visitMinutes },
    },
  };
}

/**
 * 开放式“某活动后附近逛逛”工具。锚点必须来自当前行程，候选必须来自高德；
 * 返回方案卡而不是让模型编造附近地点或用长文复述路线。
 */
export async function recommendNearbyInsertionOptions(
  plan: TripPlan,
  dayNumber: number,
  anchorBlockId: string,
  keyword: string,
  visitMinutes = 60,
  radiusMeters = 4000,
  onDiagnostic?: RecommendationDiagnosticsSink
): Promise<ActivityOption[]> {
  const dayIndex = dayNumber - 1;
  const day = plan.dailyPlans[dayIndex];
  if (!day) return [];
  const dayActivities = activities(day);
  const anchorIndex = dayActivities.findIndex((activity) => activity.id === anchorBlockId);
  const anchor = dayActivities[anchorIndex];
  if (!anchor) return [];
  const next = dayActivities[anchorIndex + 1];
  const hotelCandidates = !next && plan.selectedHotel?.name
    ? await searchPlaces(plan.selectedHotel.name, plan.destination, 3)
    : [];
  const hotel = hotelCandidates[0];
  const anchorPoint = {
    name: anchor.matchedName || anchor.placeName || anchor.title,
    lng: anchor.lng as number,
    lat: anchor.lat as number,
  };
  const endPoint = next
    ? {
        name: next.matchedName || next.placeName || next.title,
        lng: next.lng as number,
        lat: next.lat as number,
      }
    : hotel
      ? { name: hotel.name, lng: hotel.lng, lat: hotel.lat }
      : undefined;
  const usedNames = new Set(
    plan.dailyPlans.flatMap((item) =>
      item.blocks
        .filter((block) => block.type === "activity")
        .map((block) => placeKey(block.placeName || block.matchedName || block.title))
    )
  );
  const searchResults = await searchAround(
    keyword,
    { lng: anchorPoint.lng, lat: anchorPoint.lat },
    Math.max(1000, Math.min(8000, radiusMeters)),
    12
  );
  onDiagnostic?.({ stage: "search", reason: `地图周边检索返回 ${searchResults.length} 个结果` });
  const rawNearby = searchResults
    .filter((place) => !usedNames.has(placeKey(place.name)))
    .filter((place) => !/公司|学校|酒店|宾馆|公交站|地铁站|停车场|出入口|售票处|服务区/.test(`${place.name}${place.type || ""}`));
  for (const place of searchResults) {
    if (!rawNearby.includes(place)) {
      onDiagnostic?.({ stage: "filter", name: place.name, mapPOIId: place.id, reason: "重复既有行程地点或非推荐类别" });
    }
  }
  // 周边检索的列表结果不稳定地缺少营业时间。候选进入 Agent 之前必须逐个补查详情；
  // 详情拿不到或无法确认预计到达时仍开放，就不是一个可推荐的具体地点。
  const nearby = await Promise.all(
    rawNearby.slice(0, 8).map(async (place) => {
      if (place.businessHours) {
        onDiagnostic?.({ stage: "detail", name: place.name, mapPOIId: place.id, businessHours: place.businessHours, reason: "列表已含营业时间" });
        return place;
      }
      try {
        const businessHours = await getPlaceBusinessHours(place.id);
        onDiagnostic?.({ stage: "detail", name: place.name, mapPOIId: place.id, businessHours, reason: businessHours ? "详情补到营业时间" : "详情未返回营业时间" });
        return { ...place, businessHours };
      } catch {
        onDiagnostic?.({ stage: "detail", name: place.name, mapPOIId: place.id, reason: "详情查询失败" });
        return place;
      }
    })
  );
  const oldTravel = existingTravelMinutes(day.blocks, anchor.id, next?.id);
  const lastEnd = dayActivities
    .map((activity) => hmToMinutes(activity.endTime) || 0)
    .reduce((max, value) => Math.max(max, value), 0);
  const anchorEnd = hmToMinutes(anchor.endTime) || lastEnd;
  const options: ActivityOption[] = [];

  for (const place of nearby) {
    const candidatePoint = { name: place.name, lng: place.lng, lat: place.lat };
    const toCandidate = await buildLeg(
      anchorPoint,
      candidatePoint,
      plan.destination,
      plan.publicTransportTaxiThreshold || 60
    );
    const fromCandidate = endPoint
      ? await buildLeg(
          candidatePoint,
          endPoint,
          plan.destination,
          plan.publicTransportTaxiThreshold || 60
        )
      : null;
    const addedTravel = Math.max(
      0,
      toCandidate.durationMinutes + (fromCandidate?.durationMinutes || 0) - oldTravel
    );
    const projectedEnd = lastEnd + visitMinutes + addedTravel;
    if (projectedEnd > dayDeadline(plan, dayIndex)) {
      onDiagnostic?.({ stage: "filter", name: place.name, mapPOIId: place.id, reason: "超过当日截止时间", projectedDayEndTime: minutesToHm(projectedEnd), addedTravelMinutes: addedTravel });
      continue;
    }
    const start = anchorEnd + toCandidate.durationMinutes;
    const expectedStartTime = minutesToHm(start);
    const openingStatus = businessHoursStatus(place.businessHours, expectedStartTime);
    // 不以“未明确关闭”冒充“已核对开放”。无论白天或夜间，具体地点都需要能覆盖预计到达时刻。
    if (openingStatus !== "open") {
      onDiagnostic?.({ stage: "filter", name: place.name, mapPOIId: place.id, reason: openingStatus === "closed" ? "预计到达时已闭馆" : "营业时间不可核对", businessHours: place.businessHours, expectedStartTime, addedTravelMinutes: addedTravel });
      continue;
    }
    onDiagnostic?.({ stage: "route", name: place.name, mapPOIId: place.id, reason: "通过路线、日截止和营业时间筛选", businessHours: place.businessHours, expectedStartTime, addedTravelMinutes: addedTravel, projectedDayEndTime: minutesToHm(projectedEnd) });
    options.push({
      id: `agent-nearby-${place.id || `${place.lng}-${place.lat}`}-${dayIndex}-${anchor.id}`,
      name: place.name,
      address: place.address,
      category: categoryFromType(place.type),
      note: "高德附近搜索结果；确认后才写入行程。",
      lng: place.lng,
      lat: place.lat,
      origin: "assistant-recommended",
      costPerPerson: place.costPerPerson,
      proposedDayIndex: dayIndex,
      proposedAnchorBlockId: anchor.id,
      proposedAnchorTitle: anchor.title,
      estimatedStartTime: expectedStartTime,
      estimatedEndTime: minutesToHm(start + visitMinutes),
      estimatedAddedTravelMinutes: addedTravel,
      projectedDayEndTime: minutesToHm(projectedEnd),
      agentReason: `在“${anchor.title}”后前往，预计新增约 ${addedTravel} 分钟交通；既有活动保持不变。`,
      businessHours: place.businessHours,
      openingStatus,
    });
  }

  const result = options
    .sort((a, b) =>
      (a.estimatedAddedTravelMinutes || 0) - (b.estimatedAddedTravelMinutes || 0)
    )
    .slice(0, 3);
  onDiagnostic?.({ stage: "result", reason: `最终可行候选 ${result.length} 个` });
  return result;
}

/**
 * 复合请求的只读规划工具：先在临时行程中移除目标活动，再为腾出的衔接空档找候选。
 * 它只返回提案；真正的删除仍须等用户确认候选后，由事务层与新增一并执行。
 */
export async function recommendAfterRemovingActivity(
  plan: TripPlan,
  dayNumber: number,
  removeBlockId: string,
  keyword: string,
  visitMinutes = 60,
  radiusMeters = 4000,
  anchorBlockId?: string,
  onDiagnostic?: RecommendationDiagnosticsSink
): Promise<ActivityOption[]> {
  const dayIndex = dayNumber - 1;
  const day = plan.dailyPlans[dayIndex];
  if (!day) return [];
  const removeIndex = day.blocks.findIndex(
    (block) => block.type === "activity" && block.id === removeBlockId
  );
  if (removeIndex < 0) return [];
  const explicitAnchor = anchorBlockId
    ? day.blocks.find(
        (block): block is ActivityBlock =>
          block.type === "activity" &&
          block.id === anchorBlockId &&
          block.id !== removeBlockId &&
          Number.isFinite(block.lng) &&
          Number.isFinite(block.lat)
      )
    : undefined;
  const anchor = explicitAnchor || day.blocks
    .slice(0, removeIndex)
    .reverse()
    .find((block): block is ActivityBlock => block.type === "activity" && Number.isFinite(block.lng) && Number.isFinite(block.lat));
  if (!anchor) return [];
  const virtualPlan: TripPlan = {
    ...plan,
    dailyPlans: plan.dailyPlans.map((item, index) =>
      index === dayIndex
        ? { ...item, blocks: item.blocks.filter((block) => block.id !== removeBlockId) }
        : item
    ),
  };
  return recommendNearbyInsertionOptions(
    virtualPlan,
    dayNumber,
    anchor.id,
    keyword,
    visitMinutes,
    radiusMeters,
    onDiagnostic
  );
}

/** 用确定性时间数据回答“这一天紧不紧、某景点时间够不够”，避免模型重排整张 Markdown 表格。 */
export function analyzeAgentDay(plan: TripPlan, dayNumber: number): AgentDayAnalysis | null {
  const day = plan.dailyPlans[dayNumber - 1];
  if (!day) return null;
  const dayActivities = day.blocks.filter(
    (block): block is ActivityBlock => block.type === "activity"
  );
  if (!dayActivities.length) {
    return {
      day: dayNumber,
      activityCount: 0,
      activityMinutes: 0,
      transportMinutes: 0,
      scheduledSpanMinutes: 0,
      unallocatedMinutes: 0,
      longestGapMinutes: 0,
      summary: `Day ${dayNumber} 暂无活动。`,
    };
  }
  const starts = dayActivities.map((item) => hmToMinutes(item.startTime)).filter((value): value is number => value !== null);
  const ends = dayActivities.map((item) => hmToMinutes(item.endTime)).filter((value): value is number => value !== null);
  const first = starts.length ? Math.min(...starts) : 0;
  const last = ends.length ? Math.max(...ends) : first;
  const activityMinutes = dayActivities.reduce((sum, item) => sum + activityDurationMinutes(item), 0);
  const transportMinutes = day.blocks
    .filter((block) => block.type === "transport")
    .reduce((sum, block) => sum + durationTextMinutes(block.duration), 0);
  const gaps = dayActivities.slice(0, -1).map((item, index) => {
    const end = hmToMinutes(item.endTime) || 0;
    const nextStart = hmToMinutes(dayActivities[index + 1].startTime) || end;
    return Math.max(0, nextStart - end);
  });
  const span = Math.max(0, last - first);
  const unallocated = Math.max(0, span - activityMinutes - transportMinutes);
  const longestGap = gaps.length ? Math.max(...gaps) : 0;
  return {
    day: dayNumber,
    firstStart: minutesToHm(first),
    lastEnd: minutesToHm(last),
    activityCount: dayActivities.length,
    activityMinutes,
    transportMinutes,
    scheduledSpanMinutes: span,
    unallocatedMinutes: unallocated,
    longestGapMinutes: longestGap,
    summary: `Day ${dayNumber} 共 ${dayActivities.length} 个活动，活动约 ${activityMinutes} 分钟、交通约 ${transportMinutes} 分钟，行程从 ${minutesToHm(first)} 到 ${minutesToHm(last)}，可见空档约 ${unallocated} 分钟。`,
  };
}

/** 对比两个既有活动之间的高德推荐方式和可选打车/公交方案。 */
export async function compareAgentTransport(
  plan: TripPlan,
  fromBlockId: string,
  toBlockId: string
) {
  const allActivities = plan.dailyPlans.flatMap((day) =>
    day.blocks.filter((block): block is ActivityBlock => block.type === "activity")
  );
  const from = allActivities.find((item) => item.id === fromBlockId);
  const to = allActivities.find((item) => item.id === toBlockId);
  if (!from?.lng || !from.lat || !to?.lng || !to.lat) return null;
  const leg = await buildLeg(
    { name: from.matchedName || from.placeName || from.title, lng: from.lng, lat: from.lat },
    { name: to.matchedName || to.placeName || to.title, lng: to.lng, lat: to.lat },
    plan.destination,
    plan.publicTransportTaxiThreshold || 60
  );
  return {
    from: from.title,
    to: to.title,
    recommended: {
      mode: leg.mode,
      durationMinutes: leg.durationMinutes,
      distanceMeters: leg.distanceMeters,
      description: leg.description,
      estimatedCost: leg.estimatedCost,
      estimatedCostHigh: leg.estimatedCostHigh,
    },
    alternatives: leg.alternatives || [],
  };
}

/** 返回用户确实保存但尚未进入行程的地点，不根据模型猜测补名单。 */
export function listAgentUnscheduledPlaces(plan: TripPlan) {
  const scheduledIds = new Set(
    plan.dailyPlans.flatMap((day) =>
      day.blocks
        .filter((block) => block.type === "activity" && block.sourcePOIId)
        .map((block) => block.type === "activity" ? block.sourcePOIId as string : "")
    )
  );
  const scheduledNames = new Set(
    plan.dailyPlans.flatMap((day) =>
      day.blocks
        .filter((block) => block.type === "activity")
        .map((block) => block.type === "activity" ? placeKey(block.placeName || block.matchedName || block.title) : "")
    )
  );
  return (plan.sourcePOIs || [])
    .filter((poi) => !scheduledIds.has(poi.id) && !scheduledNames.has(placeKey(poi.matchedName || poi.name)))
    .map((poi) => ({ id: poi.id, name: poi.name, matchedName: poi.matchedName, category: poi.category }))
    .slice(0, 30);
}
