import { buildLeg, geocodePOI, geocodePOIStrict, isPOIEntityNameMatch, searchAround } from "./amap";
import { cleanPlaceName } from "./place-utils";
import { ActivityBlock, Block, DayPlan, TransportBlock, TripPlan } from "./types";
import { haversine } from "./planner";

const CATEGORIES = new Set([
  "美食",
  "文化古迹",
  "自然风光",
  "购物",
  "亲子",
  "摄影打卡",
  "休闲",
  "住宿",
]);

function categoryFor(value: unknown, title: string): string {
  const raw = typeof value === "string" ? value : "";
  if (CATEGORIES.has(raw)) return raw;
  if (/餐|饭|烤鸭|小吃|咖啡|茶/.test(title)) return "美食";
  if (/酒店|入住/.test(title)) return "住宿";
  return "休闲";
}

function safeText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function safeHighlights(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item && !/[¥￥]\s*\d|(?:\d+(?:\.\d+)?)\s*元|\/只|\/人/.test(item))
    .slice(0, 3);
}

function normalizeActivity(raw: Record<string, unknown>, index: number): ActivityBlock {
  const title = safeText(raw.title, "待确认活动");
  const placeName =
    safeText(raw.placeName, "") || cleanPlaceName(title) || undefined;
  const isConfirmedHotel = categoryFor(raw.category, title) === "住宿" && /入住|办理/.test(title);
  return {
    type: "activity",
    id: safeText(raw.id, `a-safe-${index}`),
    startTime: safeText(raw.startTime, "--:--"),
    endTime: safeText(raw.endTime, "--:--"),
    title,
    placeName,
    category: categoryFor(raw.category, title),
    cost: isConfirmedHotel ? "已计入已确认酒店费用" : "价格待核实",
    duration: safeText(raw.duration, "时长待确认"),
    durationMinutes:
      typeof raw.durationMinutes === "number" && raw.durationMinutes > 0
        ? raw.durationMinutes
        : undefined,
    tip: safeText(raw.tip, "出行前请在官方渠道核实开放与预约信息"),
    highlights: safeHighlights(raw.highlights),
    costSource: isConfirmedHotel ? "confirmed-hotel" : "unverified",
  };
}

function normalizeTransport(raw: Record<string, unknown>, index: number): TransportBlock {
  return {
    type: "transport",
    id: safeText(raw.id, `t-safe-${index}`),
    mode: "taxi",
    duration: "待地图计算",
    cost: "待地图计算",
    description: "待地图计算",
    fromPlace: safeText(raw.fromPlace, "") || undefined,
    toPlace: safeText(raw.toPlace, "") || undefined,
    routeSource: "unverified",
  };
}

export function normalizeDailyPlans(value: unknown): DayPlan[] {
  if (!Array.isArray(value)) return [];
  return value.map((rawDay, dayIndex) => {
    const day =
      rawDay && typeof rawDay === "object" ? (rawDay as Record<string, unknown>) : {};
    const rawBlocks = Array.isArray(day.blocks) ? day.blocks : [];
    const blocks = rawBlocks.reduce<Block[]>((result, raw, blockIndex) => {
      if (!raw || typeof raw !== "object") return result;
      const record = raw as Record<string, unknown>;
      if (record.type === "transport") result.push(normalizeTransport(record, blockIndex));
      if (record.type === "activity") result.push(normalizeActivity(record, blockIndex));
      return result;
    }, []);
    return {
      dayLabel: safeText(day.dayLabel, `Day ${dayIndex + 1}`),
      blocks,
    };
  });
}

export async function enrichDailyPlansWithAmap(
  days: DayPlan[],
  city: string
): Promise<DayPlan[]> {
  return Promise.all(
    days.map(async (day) => {
      const blocks = await Promise.all(
        day.blocks.map(async (block): Promise<Block> => {
          if (block.type === "activity") {
            if (!block.placeName) return block;
            try {
              const geo = await geocodePOI(block.placeName, city);
              return geo
              ? {
                    ...block,
                    matchedName: geo.matchedName,
                    address: geo.address || block.address,
                    lng: geo.lng,
                    lat: geo.lat,
                    cost:
                      block.category !== "住宿" && geo.costPerPerson
                        ? block.category === "美食"
                          ? `高德参考人均 ¥${Math.round(geo.costPerPerson)}`
                          : `高德参考票价 ¥${Math.round(geo.costPerPerson)}`
                        : block.cost,
                    costSource:
                      block.category !== "住宿" && geo.costPerPerson
                        ? "amap-reference"
                        : block.costSource,
                  }
                : block;
            } catch {
              return block;
            }
          }

          if (!block.fromPlace || !block.toPlace) {
            return {
              ...block,
              duration: "待确认",
              cost: "待确认",
              description: "缺少准确起点或终点，请在高德地图确认",
              routeSource: "unverified",
            };
          }

          try {
            const [from, to] = await Promise.all([
              geocodePOI(block.fromPlace, city),
              geocodePOI(block.toPlace, city),
            ]);
            if (!from || !to) throw new Error("geocode failed");
            const leg = await buildLeg(
              { name: from.matchedName, lng: from.lng, lat: from.lat },
              { name: to.matchedName, lng: to.lng, lat: to.lat },
              city
            );
            const mode: TransportBlock["mode"] =
              leg.mode === "walking" ? "walking" : leg.mode === "transit" ? "subway" : "taxi";
            return {
              ...block,
              mode,
              duration: `${leg.durationMinutes}分钟`,
              cost:
                leg.mode === "walking"
                  ? "¥0"
                  : leg.estimatedCost !== undefined
                    ? `¥${Math.round(leg.estimatedCost)}`
                    : "以高德实时结果为准",
              description: `${from.matchedName} → ${to.matchedName}：${leg.description}`,
              fromPlace: from.matchedName,
              toPlace: to.matchedName,
              fromLng: leg.fromLng ?? from.lng,
              fromLat: leg.fromLat ?? from.lat,
              toLng: leg.toLng ?? to.lng,
              toLat: leg.toLat ?? to.lat,
              routeSource: "amap",
              alternatives: leg.alternatives,
            };
          } catch {
            return {
              ...block,
              duration: "待确认",
              cost: "待确认",
              description: `${block.fromPlace} → ${block.toPlace}：请在高德地图确认`,
              routeSource: "unverified",
            };
          }
        })
      );
      return { ...day, blocks, dailyBudget: undefined };
    })
  );
}

function timeToMinutes(value?: string): number | null {
  if (!value || !/^\d{1,2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function minutesToTime(value: number): string {
  const normalized = Math.round(value);
  if (normalized < 0 || normalized >= 24 * 60) {
    throw new Error(`行程时间超出当天范围：${normalized}`);
  }
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(
    normalized % 60
  ).padStart(2, "0")}`;
}

function activityMinutes(activity: ActivityBlock): number {
  let requested = activity.durationMinutes;
  if (!requested || requested <= 0) {
    const fromTimes =
      (timeToMinutes(activity.endTime) || 0) - (timeToMinutes(activity.startTime) || 0);
    if (fromTimes > 0 && fromTimes <= 600) requested = fromTimes;
  }
  if (!requested || requested <= 0) {
    const hours = activity.duration.match(/(\d+(?:\.\d+)?)\s*小时/);
    if (hours) requested = Math.max(15, Math.round(Number(hours[1]) * 60));
  }
  if (!requested || requested <= 0) {
    const minutes = activity.duration.match(/(\d+)\s*分钟/);
    if (minutes) requested = Math.max(15, Number(minutes[1]));
  }
  if (/早餐/.test(activity.title)) return 30;
  if (/午餐|晚餐/.test(activity.title)) return 60;
  if (activity.category === "住宿") return 60;
  requested = requested || 90;
  if (/长城/.test(`${activity.title}${activity.placeName || ""}`)) {
    return Math.min(180, Math.max(120, requested));
  }
  if (/环球影城|迪士尼|主题乐园/.test(`${activity.title}${activity.placeName || ""}`)) {
    return Math.min(600, Math.max(360, requested));
  }
  return Math.min(240, Math.max(30, requested));
}

function mealKind(activity: ActivityBlock): "早餐" | "午餐" | "晚餐" | null {
  if (/早餐/.test(activity.title)) return "早餐";
  if (/午餐/.test(activity.title)) return "午餐";
  if (/晚餐/.test(activity.title)) return "晚餐";
  return null;
}

function placeIdentityKey(name?: string): string {
  return String(name || "")
    .replace(/[（）()·\s\-—_]/g, "")
    .toLowerCase();
}

function sourcePOIForActivity(activity: ActivityBlock, sourcePOIs: TripPlan["sourcePOIs"]) {
  const activityKeys = [activity.placeName, activity.matchedName, cleanPlaceName(activity.title)]
    .map(placeIdentityKey)
    .filter(Boolean);
  return sourcePOIs?.find((poi) => {
    if (activity.sourcePOIId && poi.id === activity.sourcePOIId) return true;
    const allowedNames = [poi.name];
    if (poi.matchedName && isPOIEntityNameMatch(poi.name, poi.matchedName)) {
      allowedNames.push(poi.matchedName);
    }
    return allowedNames.map(placeIdentityKey).some((key) => activityKeys.includes(key));
  });
}

/** 帖子模式不能让模型把清单外景点混入。餐次由地图补全，用户刚确认的新增/替换地点也可保留。 */
function isAllowedPostModeActivity(activity: ActivityBlock, sourcePOIs: TripPlan["sourcePOIs"]): boolean {
  if (activity.category === "住宿" || mealKind(activity) || activity.userSelected) return true;
  return Boolean(sourcePOIForActivity(activity, sourcePOIs));
}

const GENERIC_RESTAURANTS =
  /麻辣香锅|肯德基|麦当劳|必胜客|星巴克|便利店|沙县|兰州拉面|黄焖鸡|快餐|食堂|美食城|餐饮店|小吃店/;

export function restaurantIdentityKey(name?: string): string {
  return String(name || "")
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/(?:旗舰|总|分|前门|王府井|天安门|故宫|国贸|西单|朝阳|海淀|东城|西城)*店$/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

export function restaurantCuisineKey(name?: string): string | undefined {
  const value = String(name || "");
  const patterns: Array<[string, RegExp]> = [
    ["烤鸭", /烤鸭|四季民福|大董|便宜坊|全聚德/],
    ["涮羊肉", /涮羊肉|涮肉|东来顺|聚宝源/],
    ["炸酱面", /炸酱面/],
    ["豆汁焦圈", /豆汁|焦圈/],
    ["炒肝", /炒肝/],
    ["卤煮", /卤煮/],
    ["包子", /包子|庆丰/],
    ["煎饼", /煎饼/],
    ["油条", /油条/],
    ["馄饨", /馄饨/],
    ["北京小吃", /护国寺小吃|老北京早点/],
    ["川菜", /川菜|四川|蜀|麻婆/],
    ["粤菜", /粤菜|广东|潮汕|顺德/],
    ["江浙菜", /江浙|淮扬|上海菜|苏帮菜|杭帮菜/],
    ["西北菜", /西北|新疆|陕菜|羊肉泡馍/],
    ["东北菜", /东北菜|铁锅炖|锅包肉/],
    ["云南菜", /云南菜|滇菜/],
    ["贵州菜", /贵州菜|黔菜/],
    ["国外风味", /西餐|意大利|法餐|日料|日本料理|韩餐|泰国菜|印度菜/],
  ];
  return patterns.find(([, pattern]) => pattern.test(value))?.[0];
}

function foodKeywords(plan: TripPlan, meal: "早餐" | "午餐" | "晚餐"): string[] {
  if (meal === "早餐") {
    return plan.destination.includes("北京")
      ? ["北京早餐", "豆汁焦圈", "护国寺小吃", "早餐"]
      : [`${plan.destination}特色早餐`, "早餐"];
  }
  const preferences = plan.foodPreferences?.length
    ? plan.foodPreferences
    : ["当地本土菜", "老字号/名店"];
  const keywords: string[] = [];
  for (const preference of preferences) {
    if (preference === "当地本土菜") keywords.push(`${plan.destination}本地菜`);
    if (preference === "老字号/名店") keywords.push(`${plan.destination}老字号`);
    if (preference === "稀有特色餐厅") keywords.push(`${plan.destination}特色餐厅`);
    if (preference === "北方口味") keywords.push("北方菜");
    if (preference === "南方口味") keywords.push("江浙菜", "粤菜");
    if (preference === "西南口味") keywords.push("川菜", "云南菜", "贵州菜");
    if (preference === "西北口味") keywords.push("西北菜", "新疆菜");
    if (preference === "东北口味") keywords.push("东北菜");
    if (preference === "国外风味") keywords.push("特色西餐", "异国料理");
  }
  if (plan.destination.includes("北京")) {
    keywords.push("北京菜", "老北京", "烤鸭", "涮羊肉", "炸酱面");
  }
  return [...new Set([...keywords, "中餐厅"])];
}

async function findConcreteRestaurant(
  plan: TripPlan,
  meal: "早餐" | "午餐" | "晚餐",
  around: { lng: number; lat: number },
  usedRestaurantNames: Set<string>,
  usedCuisineKeys: Set<string>
) {
  const radius = meal === "早餐" ? 1500 : 3000;
  for (const keyword of foodKeywords(plan, meal)) {
    const found = await searchAround(keyword, around, radius, 20);
    const restaurants = found
      .filter(
        (item) =>
          /餐饮服务/.test(item.type || "") &&
          !/酒店|宾馆/.test(item.name) &&
          !GENERIC_RESTAURANTS.test(item.name) &&
          !usedRestaurantNames.has(restaurantIdentityKey(item.name)) &&
          !(
            restaurantCuisineKey(item.name) &&
            usedCuisineKeys.has(restaurantCuisineKey(item.name) as string)
          ) &&
          (item.distanceMeters || 0) <= radius
      )
      .sort((a, b) => {
        const aNamed = /老字号|饭庄|酒家|楼|馆|坊|居|轩|烤鸭|涮肉|炸酱面/.test(a.name)
          ? 1
          : 0;
        const bNamed = /老字号|饭庄|酒家|楼|馆|坊|居|轩|烤鸭|涮肉|炸酱面/.test(b.name)
          ? 1
          : 0;
        return (
          (a.distanceMeters || 99999) -
          aNamed * 300 -
          ((b.distanceMeters || 99999) - bNamed * 300)
        );
      });
    if (restaurants[0]) return restaurants[0];
  }
  return null;
}

interface SourceRestaurant {
  id: string;
  name: string;
  lng: number;
  lat: number;
  address?: string;
  costPerPerson?: number;
}

async function resolveSourceRestaurantPool(plan: TripPlan): Promise<SourceRestaurant[]> {
  const sourceFood = (plan.sourcePOIs || [])
    .filter((poi) => poi.category === "美食" || poi.category === "咖啡")
    .slice(0, 30);
  const resolved: Array<SourceRestaurant | null> = await Promise.all(
    sourceFood.map(async (poi) => {
      const storedGeo =
        poi.matchedName &&
        poi.lng &&
        poi.lat &&
        isPOIEntityNameMatch(poi.name, poi.matchedName)
          ? {
              matchedName: poi.matchedName,
              lng: poi.lng,
              lat: poi.lat,
              address: poi.address,
              costPerPerson: undefined,
            }
          : null;
      const geo = storedGeo || (await geocodePOIStrict(poi.name, plan.destination));
      return geo
        ? {
            id: poi.id,
            name: geo.matchedName,
            lng: geo.lng,
            lat: geo.lat,
            address: geo.address,
            costPerPerson: geo.costPerPerson,
          }
        : null;
    })
  );
  return resolved.filter((item): item is SourceRestaurant => item !== null);
}

async function resolveMealActivity(
  plan: TripPlan,
  kind: "早餐" | "午餐" | "晚餐",
  around: { lng: number; lat: number },
  usedRestaurantNames: Set<string>,
  usedCuisineKeys: Set<string>,
  template?: ActivityBlock,
  sourceRestaurantPool: SourceRestaurant[] = [],
  allowRecommendation = true
): Promise<ActivityBlock | null> {
  // 调整行程时，任何已经排入的餐厅都是锁定实体，不只限于带 userSelected 的餐厅。
  // 重排只能更新时间和路线；坐标缺失时只核对同名实体，绝不能静默换成附近另一家。
  if (template) {
    const existingName = template.placeName || template.matchedName || cleanPlaceName(template.title);
    const existingGeo =
      template.matchedName && template.lng && template.lat
        ? {
            matchedName: template.matchedName,
            lng: template.lng,
            lat: template.lat,
            address: template.address,
          }
        : existingName
          ? await geocodePOIStrict(existingName, plan.destination)
          : null;
    if (!existingGeo) return null;
    const minutes = activityMinutes(template);
    return {
      ...template,
      title: `${kind}：${existingName || existingGeo.matchedName}`,
      placeName: existingName || existingGeo.matchedName,
      matchedName: existingGeo.matchedName,
      address: existingGeo.address || template.address,
      lng: existingGeo.lng,
      lat: existingGeo.lat,
      category: "美食",
      duration: minutes % 60 === 0 ? `${minutes / 60}小时` : `${minutes}分钟`,
      durationMinutes: minutes,
    };
  }
  if (!allowRecommendation) return null;
  const radius = kind === "早餐" ? 1500 : 3000;
  const sourceRestaurant = sourceRestaurantPool
    .filter(
      (restaurant) =>
        haversine(around, restaurant) <= radius &&
        !usedRestaurantNames.has(restaurantIdentityKey(restaurant.name))
    )
    .sort((a, b) => haversine(around, a) - haversine(around, b))[0];
  const restaurant =
    sourceRestaurant ||
    (await findConcreteRestaurant(plan, kind, around, usedRestaurantNames, usedCuisineKeys));
  if (!restaurant) return null;
  return {
    type: "activity",
    id: `meal-${kind}-${crypto.randomUUID()}`,
    startTime: "--:--",
    endTime: "--:--",
    title: `${kind}：${restaurant.name}`,
    placeName: restaurant.name,
    matchedName: restaurant.name,
    address: restaurant.address,
    lng: restaurant.lng,
    lat: restaurant.lat,
    category: "美食",
    cost: restaurant.costPerPerson
      ? `高德参考人均 ¥${Math.round(restaurant.costPerPerson)}`
      : "价格待核实",
    costSource: restaurant.costPerPerson ? "amap-reference" : "unverified",
    duration: kind === "早餐" ? "30分钟" : "1小时",
    durationMinutes: kind === "早餐" ? 30 : 60,
    tip: restaurant.address
      ? `地址：${restaurant.address}；营业与价格请在高德商家页复核`
      : "营业与价格请在高德商家页复核",
    highlights: [],
    origin: sourceRestaurant ? "post" : "assistant-recommended",
    sourcePOIId: sourceRestaurant?.id,
  };
}

async function resolveActivity(
  activity: ActivityBlock,
  city: string,
  sourcePOIs: TripPlan["sourcePOIs"] = [],
  preserveIdentity = false
): Promise<ActivityBlock | null> {
  // 调整模式面对的是已经在页面上展示、且完成过地图核对的实体。
  // 此时 sourcePOIs 只用于追溯证据，不能再次把地图实体名改写回帖子原名。
  if (preserveIdentity) {
    if (activity.lng && activity.lat && activity.matchedName) return activity;
    const lookupName =
      activity.matchedName || activity.placeName || cleanPlaceName(activity.title);
    if (!lookupName) return activity;
    const geo = await geocodePOIStrict(lookupName, city);
    if (!geo) return null;
    return {
      ...activity,
      placeName: activity.placeName || activity.matchedName || geo.matchedName,
      matchedName: activity.matchedName || geo.matchedName,
      address: activity.address || geo.address,
      lng: geo.lng,
      lat: geo.lat,
    };
  }
  const sourcePOI = sourcePOIForActivity(activity, sourcePOIs);
  if (sourcePOI) {
    const storedGeo =
      sourcePOI.matchedName &&
      sourcePOI.lng &&
      sourcePOI.lat &&
      isPOIEntityNameMatch(sourcePOI.name, sourcePOI.matchedName)
        ? {
            matchedName: sourcePOI.matchedName,
            lng: sourcePOI.lng,
            lat: sourcePOI.lat,
            address: sourcePOI.address,
            costPerPerson: undefined,
          }
        : null;
    const sourceGeo = storedGeo || (await geocodePOIStrict(sourcePOI.name, city));
    if (!sourceGeo) return null;
    return {
      ...activity,
      placeName: sourcePOI.name,
      matchedName: sourceGeo.matchedName,
      address: sourceGeo.address,
      lng: sourceGeo.lng,
      lat: sourceGeo.lat,
      origin: "post",
      sourcePOIId: sourcePOI.id,
    };
  }
  if (activity.lng && activity.lat && activity.matchedName) return activity;
  if (!activity.placeName) return activity;
  const geo = await geocodePOI(activity.placeName, city);
  return geo
    ? {
        ...activity,
        matchedName: geo.matchedName,
        address: geo.address,
        lng: geo.lng,
        lat: geo.lat,
        cost:
          activity.category !== "住宿" && geo.costPerPerson
            ? activity.category === "美食"
              ? `高德参考人均 ¥${Math.round(geo.costPerPerson)}`
              : `高德参考票价 ¥${Math.round(geo.costPerPerson)}`
            : activity.cost,
        costSource:
          activity.category !== "住宿" && geo.costPerPerson
            ? "amap-reference"
            : activity.costSource,
        origin:
          activity.origin ||
          (sourcePOIs?.some(
            (poi) => poi.name === activity.placeName || poi.name === geo.matchedName
          )
            ? "post"
            : undefined),
      }
    : activity;
}

function transportFromLeg(
  id: string,
  leg: Awaited<ReturnType<typeof buildLeg>>
): TransportBlock {
  const mode: TransportBlock["mode"] =
    leg.mode === "walking" ? "walking" : leg.mode === "transit" ? "subway" : "taxi";
  return {
    type: "transport",
    id,
    mode,
    duration: `${leg.durationMinutes}分钟`,
    cost:
      leg.mode === "walking"
        ? "¥0"
        : leg.estimatedCost !== undefined
          ? leg.mode === "taxi" && leg.estimatedCostHigh !== undefined
            ? `打车预估 ¥${Math.round(leg.estimatedCost)}–${Math.round(leg.estimatedCostHigh)}`
            : `¥${Math.round(leg.estimatedCost)}`
          : "以高德实时结果为准",
    description: `${leg.fromName} → ${leg.toName}：${leg.description}`,
    fromPlace: leg.fromName,
    toPlace: leg.toName,
    fromLng: leg.fromLng,
    fromLat: leg.fromLat,
    toLng: leg.toLng,
    toLat: leg.toLat,
    routeSource: "amap",
    estimatedCostHigh: leg.estimatedCostHigh,
    alternatives: leg.alternatives,
  };
}

function applyConfirmedTransportMode(
  leg: Awaited<ReturnType<typeof buildLeg>>,
  mode?: "subway" | "taxi"
) {
  if (!mode || !leg.alternatives?.length) return leg;
  const alternative = leg.alternatives.find((item) => item.mode === mode);
  if (!alternative) return leg;
  return {
    ...leg,
    mode: mode === "subway" ? ("transit" as const) : ("taxi" as const),
    durationMinutes: alternative.durationMinutes,
    distanceMeters: alternative.distanceMeters,
    description: alternative.description,
    estimatedCost: alternative.estimatedCost,
    estimatedCostHigh: alternative.estimatedCostHigh,
    fromLng: alternative.fromLng ?? leg.fromLng,
    fromLat: alternative.fromLat ?? leg.fromLat,
    toLng: alternative.toLng ?? leg.toLng,
    toLat: alternative.toLat ?? leg.toLat,
  };
}

function confirmedModeFor(
  plan: TripPlan,
  blockId: string,
  leg: Awaited<ReturnType<typeof buildLeg>>
): "subway" | "taxi" | undefined {
  return (
    plan.transportModeOverrides?.[blockId] ||
    plan.transportModeOverrides?.[`${leg.fromName}→${leg.toName}`]
  );
}

/**
 * 确定性重建时间轴：
 * - 模型只决定活动顺序；
 * - 餐厅由高德周边搜索补成明确店名；
 * - 每两个活动之间强制插入地图路线；
 * - 后一个活动时间由前一活动结束 + 真实路程顺推。
 */
export interface RebuildPlanOptions {
  /** 只重建受影响日期；其他日期保持逐字节不变。 */
  dayIndexes?: number[];
  /** 调整模式：保留全部既有活动，不过滤、不去重、不自动补新的餐食。 */
  preserveExistingActivities?: boolean;
}

export async function rebuildPlanItinerary(
  plan: TripPlan,
  options: RebuildPlanOptions = {}
): Promise<DayPlan[]> {
  const city = plan.destination;
  const hotelName = plan.selectedHotel?.name;
  if (!hotelName) return plan.dailyPlans;
  const hotel = await geocodePOI(hotelName, city);
  if (!hotel) return enrichDailyPlansWithAmap(plan.dailyPlans, city);

  const rebuilt: DayPlan[] = [];
  const usedRestaurantNames = new Set(
    (plan.excludedRestaurantNames || []).map(restaurantIdentityKey).filter(Boolean)
  );
  const usedCuisineKeys = new Set(plan.excludedCuisineKeys || []);
  const sourceRestaurantPool = await resolveSourceRestaurantPool(plan);
  const taxiThreshold = plan.publicTransportTaxiThreshold || 60;
  const selectedDays = options.dayIndexes ? new Set(options.dayIndexes) : null;
  for (let dayIndex = 0; dayIndex < plan.dailyPlans.length; dayIndex++) {
    const day = plan.dailyPlans[dayIndex];
    if (selectedDays && !selectedDays.has(dayIndex)) {
      rebuilt.push(day);
      continue;
    }
    let activities = day.blocks.filter(
      (block): block is ActivityBlock =>
        block.type === "activity" && block.title !== "待确认活动"
    );
    if (!options.preserveExistingActivities && plan.sourcePOIs?.length) {
      activities = activities.filter((activity) => isAllowedPostModeActivity(activity, plan.sourcePOIs));
    }
    activities.sort((a, b) => {
      const aTime = timeToMinutes(a.startTime) ?? 24 * 60;
      const bTime = timeToMinutes(b.startTime) ?? 24 * 60;
      return aTime - bTime;
    });
    if (!options.preserveExistingActivities) {
      const seen = new Set<string>();
      activities = activities.filter((activity) => {
        const key = `${activity.placeName || cleanPlaceName(activity.title) || activity.title}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    const anchoredAfter = new Map<string, ActivityBlock[]>();
    for (const activity of activities) {
      if (!activity.placementAfterBlockId || activity.placementAfterBlockId === activity.id) continue;
      const list = anchoredAfter.get(activity.placementAfterBlockId) || [];
      list.push(activity);
      anchoredAfter.set(activity.placementAfterBlockId, list);
    }
    // 带有顺序约束的活动不能再进入普通时间排序，否则餐食抽取和自动重排会再次丢掉“某活动之后”。
    activities = activities.filter((activity) => !activity.placementAfterBlockId);
    const mealTemplates = new Map<"早餐" | "午餐" | "晚餐", ActivityBlock>();
    if (!options.preserveExistingActivities) {
      for (const activity of activities) {
        const kind = mealKind(activity);
        if (kind && !mealTemplates.has(kind)) mealTemplates.set(kind, activity);
      }
      activities = activities.filter((activity) => !mealKind(activity));
    }

    if (
      !options.preserveExistingActivities &&
      dayIndex === 0 &&
      !activities.some((activity) => activity.category === "住宿")
    ) {
      activities.unshift({
        type: "activity",
        id: `checkin-${dayIndex}`,
        startTime: "--:--",
        endTime: "--:--",
        title: "办理酒店入住",
        placeName: hotelName,
        matchedName: hotel.matchedName,
        address: hotel.address,
        lng: hotel.lng,
        lat: hotel.lat,
        category: "住宿",
        cost: "已计入已确认酒店费用",
        costSource: "confirmed-hotel",
        duration: "1小时",
        durationMinutes: 60,
        tip: "入住时间以酒店订单为准",
        highlights: ["办理入住", "放置行李", "短暂休息"],
      });
    }

    const dayStart =
      dayIndex === 0
        ? plan.outboundTransport?.arriveTime || "12:00"
        : plan.breakfastHabit === "不吃"
          ? "08:00"
          : "07:30";
    let cursor = timeToMinutes(dayStart) || 8 * 60;
    let current = {
      name:
        dayIndex === 0
          ? plan.outboundTransport?.arrivalTerminal || hotel.matchedName
          : hotel.matchedName,
      lng: hotel.lng,
      lat: hotel.lat,
    };
    if (dayIndex === 0 && plan.outboundTransport?.arrivalTerminal) {
      const arrival = await geocodePOI(plan.outboundTransport.arrivalTerminal, city);
      if (arrival) current = { name: arrival.matchedName, lng: arrival.lng, lat: arrival.lat };
    }

    const isLastDay = dayIndex === plan.dailyPlans.length - 1;
    const endName = isLastDay
      ? plan.returnTransport?.departureTerminal || hotel.matchedName
      : hotel.matchedName;
    const endGeo = isLastDay
      ? await geocodePOI(endName, city)
      : { matchedName: hotel.matchedName, lng: hotel.lng, lat: hotel.lat };
    const returnDeparture = timeToMinutes(plan.returnTransport?.departTime);
    const returnBuffer =
      plan.returnTransport?.mode === "flight" ? 90 : 45;
    const hasConfirmedReturnDeadline = isLastDay && returnDeparture !== null;
    // 普通日期没有用户选择过“几点回酒店”，因此不再偷偷套用 21:30/22:30。
    // 23:59 只是自然日边界；只有末日已确认的车次/航班才是业务截止时间。
    const mustReachEndBy = hasConfirmedReturnDeadline
      ? returnDeparture - returnBuffer
      : 23 * 60 + 59;
    const latestActivityEnd = mustReachEndBy;
    const blocks: Block[] = [];
    let lunchDone = false;
    let dinnerDone = false;
    const appendedAnchoredIds = new Set<string>();
    const placementStack = new Set<string>();

    const canFinishAtEnd = async (
      point: { name: string; lng: number; lat: number },
      finishAt: number
    ) => {
      if (!endGeo) return finishAt <= latestActivityEnd;
      const calculatedHomeLeg = await buildLeg(
        point,
        { name: endGeo.matchedName, lng: endGeo.lng, lat: endGeo.lat },
        city,
        taxiThreshold
      );
      const homeLeg = applyConfirmedTransportMode(
        calculatedHomeLeg,
        confirmedModeFor(plan, `route-${dayIndex}-end`, calculatedHomeLeg)
      );
      return finishAt <= latestActivityEnd && finishAt + homeLeg.durationMinutes <= mustReachEndBy;
    };

    let appendAnchoredAfter: (anchorBlockId: string) => Promise<void> = async () => {};

    const appendActivity = async (
      activity: ActivityBlock,
      idSuffix: string
    ): Promise<boolean> => {
      if (!activity.lng || !activity.lat || !activity.matchedName) return false;
      const destination = {
        name: activity.matchedName,
        lng: activity.lng,
        lat: activity.lat,
      };
      const routeId = `route-${dayIndex}-${idSuffix}`;
      const calculatedLeg = await buildLeg(current, destination, city, taxiThreshold);
      const leg = applyConfirmedTransportMode(
        calculatedLeg,
        confirmedModeFor(plan, routeId, calculatedLeg)
      );
      const travelMinutes = leg.distanceMeters > 100 ? leg.durationMinutes : 0;
      const minutes = activityMinutes(activity);
      const finishAt = cursor + travelMinutes + minutes;
      if (!(await canFinishAtEnd(destination, finishAt))) return false;
      if (leg.distanceMeters > 100) {
        blocks.push(transportFromLeg(routeId, leg));
        cursor += leg.durationMinutes;
      }
      const startTime = minutesToTime(cursor);
      cursor += minutes;
      blocks.push({
        ...activity,
        startTime,
        endTime: minutesToTime(cursor),
        duration: minutes % 60 === 0 ? `${minutes / 60}小时` : `${minutes}分钟`,
        durationMinutes: minutes,
      });
      current = destination;
      await appendAnchoredAfter(activity.id);
      return true;
    };

    appendAnchoredAfter = async (anchorBlockId: string) => {
      if (placementStack.has(anchorBlockId)) return;
      placementStack.add(anchorBlockId);
      try {
        for (const raw of anchoredAfter.get(anchorBlockId) || []) {
          if (appendedAnchoredIds.has(raw.id)) continue;
          appendedAnchoredIds.add(raw.id);
          const anchored = await resolveActivity(
            raw,
            city,
            plan.sourcePOIs,
            options.preserveExistingActivities
          );
          if (!anchored?.lng || !anchored.lat || !anchored.matchedName) continue;
          await appendActivity(anchored, `anchored-${raw.id}`);
        }
      } finally {
        placementStack.delete(anchorBlockId);
      }
    };

    const appendMeal = async (kind: "早餐" | "午餐" | "晚餐") => {
      const template = mealTemplates.get(kind);
      if (options.preserveExistingActivities && !template) return false;
      const meal = await resolveMealActivity(
        plan,
        kind,
        current,
        usedRestaurantNames,
        usedCuisineKeys,
        template,
        sourceRestaurantPool,
        !options.preserveExistingActivities
      );
      if (!meal) return false;
      const added = await appendActivity(meal, `${kind}-${blocks.length}`);
      if (added) {
        usedRestaurantNames.add(restaurantIdentityKey(meal.placeName || meal.title));
        const cuisineKey = restaurantCuisineKey(meal.placeName || meal.title);
        if (cuisineKey) usedCuisineKeys.add(cuisineKey);
      }
      if (added && kind === "午餐") lunchDone = true;
      if (added && kind === "晚餐") dinnerDone = true;
      return added;
    };

    const wantsBreakfast =
      dayIndex > 0 &&
      (options.preserveExistingActivities
        ? mealTemplates.has("早餐")
        : plan.breakfastHabit === "每天吃" ||
          (!plan.breakfastHabit && mealTemplates.has("早餐")) ||
          (plan.breakfastHabit === "偶尔吃" && dayIndex % 2 === 1));
    if (wantsBreakfast) await appendMeal("早餐");

    for (let index = 0; index < activities.length; index++) {
      const raw = activities[index];
      const activity = await resolveActivity(
        raw,
        city,
        plan.sourcePOIs,
        options.preserveExistingActivities
      );
      if (!activity?.lng || !activity.lat || !activity.matchedName) continue;
      if (options.preserveExistingActivities) {
        const existingMeal = mealKind(activity);
        if (existingMeal === "早餐") cursor = Math.max(cursor, 7 * 60 + 30);
        if (existingMeal === "午餐") cursor = Math.max(cursor, 11 * 60 + 30);
        if (existingMeal === "晚餐") cursor = Math.max(cursor, 17 * 60 + 30);
      }
      const calculatedPreviewLeg = await buildLeg(
        current,
        { name: activity.matchedName, lng: activity.lng, lat: activity.lat },
        city,
        taxiThreshold
      );
      const previewLeg = applyConfirmedTransportMode(
        calculatedPreviewLeg,
        confirmedModeFor(plan, `route-${dayIndex}-${index}`, calculatedPreviewLeg)
      );
      const previewEnd =
        cursor +
        (previewLeg.distanceMeters > 100 ? previewLeg.durationMinutes : 0) +
        activityMinutes(activity);

      if (
        raw.category !== "住宿" &&
        !lunchDone &&
        cursor >= 11 * 60 &&
        previewEnd > 13 * 60 + 30
      ) {
        await appendMeal("午餐");
      }
      if (
        raw.category !== "住宿" &&
        !dinnerDone &&
        cursor >= 17 * 60 &&
        previewEnd > 20 * 60
      ) {
        await appendMeal("晚餐");
      }
      await appendActivity(activity, `${index}`);
      if (!lunchDone && cursor >= 12 * 60 + 30 && cursor <= 15 * 60) {
        await appendMeal("午餐");
      }
      if (!dinnerDone && cursor >= 18 * 60 + 30) await appendMeal("晚餐");
    }

    if (!lunchDone && cursor >= 11 * 60 && cursor <= 15 * 60) {
      await appendMeal("午餐");
    }
    if (!dinnerDone && cursor >= 16 * 60 && cursor <= 19 * 60 + 30) {
      cursor = Math.max(cursor, 17 * 60 + 30);
      await appendMeal("晚餐");
    }

    if (endGeo && current.name !== endGeo.matchedName) {
      const endRouteId = `route-${dayIndex}-end`;
      const calculatedEndLeg = await buildLeg(
        current,
        { name: endGeo.matchedName, lng: endGeo.lng, lat: endGeo.lat },
        city,
        taxiThreshold
      );
      const leg = applyConfirmedTransportMode(
        calculatedEndLeg,
        confirmedModeFor(plan, endRouteId, calculatedEndLeg)
      );
      const endBlock = transportFromLeg(endRouteId, leg);
      if (isLastDay && returnDeparture !== null) {
        endBlock.description = `${endBlock.description}；须在${minutesToTime(
          mustReachEndBy
        )}前到达，为${plan.returnTransport?.departTime}的${
          plan.returnTransport?.mode === "flight" ? "航班预留90分钟" : "车次预留45分钟"
        }`;
      }
      blocks.push(endBlock);
    }

    rebuilt.push({ dayLabel: day.dayLabel || `Day ${dayIndex + 1}`, blocks });
  }
  return rebuilt;
}
