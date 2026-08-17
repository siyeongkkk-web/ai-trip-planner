// 高德地图 Web 服务 API 封装 —— 全部是"硬事实"：坐标、距离、真实交通耗时。
// 只在服务端调用（使用 AMAP_KEY）。
import { haversine, Pt } from "./planner";
import { RouteLeg, TransitMode } from "./types";
import { fetchWithTimeout } from "./fetch-timeout";

const BASE = "https://restapi.amap.com/v3";

function key(): string {
  const k = process.env.AMAP_KEY;
  if (!k) throw new Error("未配置 AMAP_KEY");
  return k;
}

// ===== 请求节流 + 限流重试 =====
// 个人 key 有每秒请求上限（QPS）。所有请求经此排队，按最小间隔放行，
// 遇到高德的限流错误（status 0 + CUQPS）自动退避重试，避免把限流当成"定位失败"。
const MIN_INTERVAL = 320; // ms，约 3 QPS
let gate: Promise<void> = Promise.resolve();

async function acquireSlot(): Promise<void> {
  const prev = gate;
  let release!: () => void;
  gate = new Promise<void>((r) => (release = r));
  await prev;
  setTimeout(release, MIN_INTERVAL);
}

interface AmapResp {
  status?: string;
  info?: string;
  pois?: unknown[];
  route?: unknown;
  [k: string]: unknown;
}

export interface WeatherForecast {
  date: string;
  dayWeather: string;
  nightWeather: string;
  dayTemp?: string;
  nightTemp?: string;
}

export interface WeatherSnapshot {
  city: string;
  adcode: string;
  reportTime?: string;
  forecasts: WeatherForecast[];
}

export interface TrafficSnapshot {
  /** 仅描述 POI 周边矩形范围的路况，不能推断整段行程一定拥堵。 */
  description?: string;
  congestedRoadCount: number;
  blockedRoadCount: number;
}

async function amapGet(url: string): Promise<AmapResp | null> {
  let networkFailures = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    await acquireSlot();
    try {
      const data: AmapResp = await (
        await fetchWithTimeout(url, {}, 6_000, "高德地图")
      ).json();
      if (data.status === "0" && /CUQPS|QPS|LIMIT/i.test(data.info || "")) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue; // 限流，退避后重试
      }
      return data;
    } catch {
      networkFailures += 1;
      if (networkFailures >= 2) return null;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return null;
}

export interface GeocodeResult {
  poiId?: string;
  matchedName: string;
  lng: number;
  lat: number;
  address?: string;
  type?: string;
  costPerPerson?: number;
}

interface RawPoi {
  id?: string;
  name?: string;
  location?: string;
  address?: unknown;
  type?: string;
  biz_ext?: { cost?: unknown; opentime?: unknown };
  distance?: unknown;
}

function normalizeName(value: string): string {
  return value
    .replace(/[（）()·\s\-—_]/g, "")
    .replace(/北京市|上海市|天津市|重庆市/g, "")
    .toLowerCase();
}

/**
 * 用户保存的名称与地图实体必须能互相包含；完全无关的首条搜索结果不能算“核对成功”。
 * 例如“郎园station”可以匹配“首创·郎园Station”，但不会匹配到同城的另一家商户。
 */
export function isPOIEntityNameMatch(query: string, matchedName: string): boolean {
  const normalizedQuery = normalizeName(query);
  const normalizedMatch = normalizeName(matchedName);
  return Boolean(
    normalizedQuery &&
      normalizedMatch &&
      (normalizedQuery === normalizedMatch ||
        normalizedQuery.includes(normalizedMatch) ||
        normalizedMatch.includes(normalizedQuery))
  );
}

function poiScore(query: string, poi: RawPoi): number {
  const q = normalizeName(query);
  const name = normalizeName(poi.name || "");
  const type = poi.type || "";
  let score = name === q ? 100 : name.includes(q) || q.includes(name) ? 55 : 0;
  if (/机场/.test(query)) {
    if (/飞机场/.test(type)) score += 45;
    if (/公交车站|停车场|公司|酒店|边检/.test(`${type}${poi.name || ""}`)) score -= 60;
  }
  if (/酒店|宾馆/.test(query)) {
    if (/住宿服务/.test(type)) score += 35;
    if (/公交车站|地名地址/.test(type)) score -= 30;
  }
  if (/街|景区|公园|博物馆|广场/.test(query)) {
    if (/风景名胜|特色商业街|科教文化服务/.test(type)) score += 25;
    if (/道路名|路口名/.test(type)) score -= 10;
  }
  return score;
}

/** 地理编码 / 实体链接：景点名 → 地图真实 POI 坐标 */
export async function geocodePOI(
  name: string,
  city: string
): Promise<GeocodeResult | null> {
  const url = `${BASE}/place/text?keywords=${encodeURIComponent(
    name
  )}&city=${encodeURIComponent(city)}&citylimit=true&offset=10&extensions=all&key=${key()}`;
  const data = await amapGet(url);
  if (data?.status === "1" && Array.isArray(data.pois) && data.pois.length) {
    const candidates = data.pois as RawPoi[];
    const p = [...candidates].sort((a, b) => poiScore(name, b) - poiScore(name, a))[0];
    const [lng, lat] = String(p.location).split(",").map(Number);
    if (!isFinite(lng) || !isFinite(lat)) return null;
    const address =
      typeof p.address === "string" && p.address ? p.address : undefined;
    return {
      poiId: p.id,
      matchedName: p.name || name,
      lng,
      lat,
      address,
      type: p.type,
      costPerPerson:
        Number.isFinite(Number(p.biz_ext?.cost)) && Number(p.biz_ext?.cost) > 0
          ? Number(p.biz_ext?.cost)
          : undefined,
    };
  }
  return null;
}

/** 用于帖子地点等强身份约束场景；宁可返回未找到，也不能用无关 POI 顶替。 */
export async function geocodePOIStrict(
  name: string,
  city: string
): Promise<GeocodeResult | null> {
  const result = await geocodePOI(name, city);
  return result && isPOIEntityNameMatch(name, result.matchedName) ? result : null;
}

function firstPath(data: AmapResp | null): { distance: number; duration: number } | null {
  const path = (data?.route as { paths?: { distance: string; duration: string }[] } | undefined)
    ?.paths?.[0];
  if (path) return { distance: Number(path.distance), duration: Number(path.duration) };
  return null;
}

export interface AroundPlace {
  id?: string;
  name: string;
  lng: number;
  lat: number;
  address?: string;
  distanceMeters?: number;
  costPerPerson?: number;
  type?: string;
  /** 高德返回的营业时间原文。没有返回不代表全天开放。 */
  businessHours?: string;
}

/**
 * 周边检索的列表接口经常不带营业时间；在将地点推荐给用户前，再用 POI 详情补查。
 * 查询失败或详情没有返回时返回 undefined，调用方必须把它当作“未核对”。
 */
export async function getPlaceBusinessHours(poiId?: string): Promise<string | undefined> {
  if (!poiId) return undefined;
  const url = `${BASE}/place/detail?id=${encodeURIComponent(poiId)}&extensions=all&key=${key()}`;
  const data = await amapGet(url);
  const poi = Array.isArray(data?.pois) ? (data?.pois[0] as RawPoi | undefined) : undefined;
  return typeof poi?.biz_ext?.opentime === "string" && poi.biz_ext.opentime.trim()
    ? poi.biz_ext.opentime.trim()
    : undefined;
}

/** 周边搜索：在某坐标附近搜真实 POI（餐厅、酒店等）。硬活，避免 AI 编造店名。 */
export async function searchAround(
  keyword: string,
  center: Pt,
  radius = 1500,
  limit = 5
): Promise<AroundPlace[]> {
  const url = `${BASE}/place/around?location=${center.lng},${center.lat}&keywords=${encodeURIComponent(
    keyword
  )}&radius=${radius}&offset=${limit}&page=1&sortrule=distance&extensions=all&key=${key()}`;
  const data = await amapGet(url);
  if (data?.status === "1" && Array.isArray(data.pois)) {
    return (data.pois as RawPoi[])
      .map((p) => {
        const [lng, lat] = String(p.location).split(",").map(Number);
        const rawCost = Number(p.biz_ext?.cost);
        return {
          id: p.id,
          name: p.name || keyword,
          lng,
          lat,
          address: typeof p.address === "string" && p.address ? p.address : undefined,
          distanceMeters: Number.isFinite(Number(p.distance)) ? Number(p.distance) : undefined,
          costPerPerson: Number.isFinite(rawCost) && rawCost > 0 ? rawCost : undefined,
          type: p.type,
          businessHours:
            typeof p.biz_ext?.opentime === "string" && p.biz_ext.opentime.trim()
              ? p.biz_ext.opentime.trim()
              : undefined,
        };
      })
      .filter((p) => isFinite(p.lng) && isFinite(p.lat));
  }
  return [];
}

/** 城市内关键词搜索，供酒店推荐锚点使用。返回的都是高德真实 POI。 */
export async function searchPlaces(
  keyword: string,
  city: string,
  limit = 5
): Promise<AroundPlace[]> {
  const url = `${BASE}/place/text?keywords=${encodeURIComponent(
    keyword
  )}&city=${encodeURIComponent(city)}&citylimit=true&offset=${limit}&extensions=all&key=${key()}`;
  const data = await amapGet(url);
  if (data?.status !== "1" || !Array.isArray(data.pois)) return [];
  return (data.pois as RawPoi[])
    .map((p) => {
      const [lng, lat] = String(p.location).split(",").map(Number);
      return {
        id: p.id,
        name: p.name || keyword,
        lng,
        lat,
        address: typeof p.address === "string" && p.address ? p.address : undefined,
        type: p.type,
        businessHours:
          typeof p.biz_ext?.opentime === "string" && p.biz_ext.opentime.trim()
            ? p.biz_ext.opentime.trim()
            : undefined,
      };
    })
    .filter((p) => Number.isFinite(p.lng) && Number.isFinite(p.lat));
}

/** 到最近某类 POI（如"地铁站""公交站"）的直线距离（米），搜不到返回 null */
export async function distanceToNearest(
  keyword: string,
  center: Pt,
  radius = 1500
): Promise<number | null> {
  const found = await searchAround(keyword, center, radius, 1);
  if (found.length) return Math.round(haversine(center, found[0]));
  return null;
}

/** 逆地理编码：坐标 → 区域名（用于"推荐住在 XX 区域"） */
export async function regeoArea(center: Pt): Promise<string | null> {
  const url = `${BASE}/geocode/regeo?location=${center.lng},${center.lat}&key=${key()}`;
  const data = await amapGet(url);
  const comp = (data?.regeocode as { addressComponent?: { district?: unknown; township?: unknown } } | undefined)
    ?.addressComponent;
  const district = typeof comp?.district === "string" ? comp.district : "";
  const township = typeof comp?.township === "string" ? comp.township : "";
  const area = [district, township].filter(Boolean).join(" ");
  return area || null;
}

/** 城市名 → 行政区划 adcode；天气接口必须使用 adcode，失败时不猜测。 */
async function getCityAdcode(city: string): Promise<{ name: string; adcode: string } | null> {
  const url = `${BASE}/config/district?keywords=${encodeURIComponent(
    city
  )}&subdistrict=0&extensions=base&key=${key()}`;
  const data = await amapGet(url);
  const district = (data?.districts as { name?: unknown; adcode?: unknown }[] | undefined)?.[0];
  if (!district || typeof district.adcode !== "string" || !district.adcode) return null;
  return { name: typeof district.name === "string" ? district.name : city, adcode: district.adcode };
}

/** 获取高德可返回日期内的天气预报；缺少日期不等于天气晴朗。 */
export async function getCityWeather(city: string): Promise<WeatherSnapshot | null> {
  const district = await getCityAdcode(city);
  if (!district) return null;
  const url = `${BASE}/weather/weatherInfo?city=${encodeURIComponent(
    district.adcode
  )}&extensions=all&key=${key()}`;
  const data = await amapGet(url);
  const forecast = (data?.forecasts as {
    city?: unknown;
    reporttime?: unknown;
    casts?: { date?: unknown; dayweather?: unknown; nightweather?: unknown; daytemp?: unknown; nighttemp?: unknown }[];
  }[] | undefined)?.[0];
  if (data?.status !== "1" || !forecast || !Array.isArray(forecast.casts)) return null;
  const forecasts = forecast.casts
    .filter((cast) => typeof cast.date === "string" && cast.date)
    .map((cast) => ({
      date: cast.date as string,
      dayWeather: typeof cast.dayweather === "string" ? cast.dayweather : "未知",
      nightWeather: typeof cast.nightweather === "string" ? cast.nightweather : "未知",
      dayTemp: typeof cast.daytemp === "string" ? cast.daytemp : undefined,
      nightTemp: typeof cast.nighttemp === "string" ? cast.nighttemp : undefined,
    }));
  return {
    city: typeof forecast.city === "string" && forecast.city ? forecast.city : district.name,
    adcode: district.adcode,
    reportTime: typeof forecast.reporttime === "string" ? forecast.reporttime : undefined,
    forecasts,
  };
}

/** 获取一个已核对坐标附近的交通态势；只把明确的拥堵/阻塞道路作为风险信号。 */
export async function getTrafficAround(center: Pt): Promise<TrafficSnapshot | null> {
  const delta = 0.018;
  const rectangle = [
    (center.lng - delta).toFixed(6),
    (center.lat - delta).toFixed(6),
    (center.lng + delta).toFixed(6),
    (center.lat + delta).toFixed(6),
  ].join(",");
  const url = `${BASE}/traffic/status/rectangle?rectangle=${rectangle}&level=5&extensions=all&key=${key()}`;
  const data = await amapGet(url);
  const traffic = data?.trafficinfo as {
    description?: unknown;
    roads?: { status?: unknown }[];
  } | undefined;
  if (data?.status !== "1" || !traffic) return null;
  const roads = Array.isArray(traffic.roads) ? traffic.roads : [];
  return {
    description: typeof traffic.description === "string" ? traffic.description : undefined,
    congestedRoadCount: roads.filter((road) => road.status === "2").length,
    blockedRoadCount: roads.filter((road) => road.status === "3").length,
  };
}

async function walking(o: Pt, d: Pt) {
  const url = `${BASE}/direction/walking?origin=${o.lng},${o.lat}&destination=${d.lng},${d.lat}&key=${key()}`;
  return firstPath(await amapGet(url));
}

async function transit(
  o: Pt,
  d: Pt,
  city: string,
  fromName = "",
  toName = "",
  allowSnap = true
): Promise<{
  distance: number;
  duration: number;
  walkingDistance: number;
  cost?: number;
  origin: Pt;
  destination: Pt;
} | null> {
  const url = `${BASE}/direction/transit/integrated?origin=${o.lng},${o.lat}&destination=${d.lng},${d.lat}&city=${encodeURIComponent(
    city
  )}&key=${key()}`;
  const data = await amapGet(url);
  const route = data?.route as
    | {
        distance?: string;
        transits?: {
          duration: string;
          distance?: string;
          walking_distance?: string;
          cost?: string;
          segments?: {
            bus?: {
              buslines?: {
                name?: string;
                departure_stop?: { name?: string; location?: string };
                arrival_stop?: { name?: string; location?: string };
              }[];
            };
          }[];
        }[];
      }
    | undefined;
  const t = route?.transits?.[0];
  if (t && Number(t.duration) > 0) {
    if (allowSnap && /机场/.test(`${fromName}${toName}`)) {
      const lines = (t.segments || []).flatMap((segment) => segment.bus?.buslines || []);
      const airportLine = lines.find((line) => /机场线|机场快线|机场专线/.test(line.name || ""));
      const parsePoint = (value?: string): Pt | null => {
        const [lng, lat] = String(value || "").split(",").map(Number);
        return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null;
      };
      const snappedOrigin =
        /机场/.test(fromName) && Number(t.walking_distance || 0) > 1800
          ? parsePoint(airportLine?.departure_stop?.location)
          : null;
      const snappedDestination =
        /机场/.test(toName) && Number(t.walking_distance || 0) > 1800
          ? parsePoint(airportLine?.arrival_stop?.location)
          : null;
      if (snappedOrigin || snappedDestination) {
        const retried = await transit(
          snappedOrigin || o,
          snappedDestination || d,
          city,
          fromName,
          toName,
          false
        );
        if (retried && retried.duration < Number(t.duration)) return retried;
      }
    }
    return {
      distance: Number(route?.distance || t.distance || 0),
      duration: Number(t.duration),
      walkingDistance: Number(t.walking_distance || 0),
      cost:
        Number.isFinite(Number(t.cost)) && Number(t.cost) > 0 ? Number(t.cost) : undefined,
      origin: o,
      destination: d,
    };
  }
  return null;
}

async function driving(o: Pt, d: Pt) {
  const url = `${BASE}/direction/driving?origin=${o.lng},${o.lat}&destination=${d.lng},${d.lat}&key=${key()}`;
  return firstPath(await amapGet(url));
}

function fmtDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}公里` : `${Math.round(m)}米`;
}

/**
 * 高德驾驶路线不返回网约车报价。这里按距离给出透明的粗略区间，
 * 只用于帮助比较方案；拥堵、车型、夜间和平台动态价都会使实际价格变化。
 */
function estimateTaxiFare(distanceMeters: number): { low: number; high: number } {
  const kilometers = Math.max(1, distanceMeters / 1000);
  const base = 14;
  const low = Math.max(base, base + Math.max(0, kilometers - 3) * 2.2);
  const high = Math.max(base + 2, low * 1.3);
  return { low: Math.round(low), high: Math.round(high) };
}

function isLargeScenicPlace(name: string): boolean {
  return /公园|景区|长城|故宫|天坛|颐和园|圆明园|动物园|植物园/.test(name);
}

async function snapScenicAccess(
  point: { name: string } & Pt,
  toward: Pt
): Promise<{ name: string } & Pt> {
  if (!isLargeScenicPlace(point.name)) return point;
  const core = normalizeName(point.name)
    .replace(/公园|景区|博物院|博物馆/g, "")
    .slice(0, 4);
  const candidates = await searchAround("出入口", point, 1800, 20);
  const entrances = candidates
    .filter(
      (candidate) =>
        /出入口|门|入口|出口/.test(`${candidate.type || ""}${candidate.name}`) &&
        (candidate.distanceMeters || 0) <= 1500 &&
        (!core || normalizeName(candidate.name).includes(core))
    )
    .sort((a, b) => haversine(a, toward) - haversine(b, toward));
  const best = entrances[0];
  return best ? { name: point.name, lng: best.lng, lat: best.lat } : point;
}

/**
 * 算一段路：根据直线距离选模式（近→步行；远→公交地铁；公交不可达→打车），
 * 再用真实 API 拿距离/耗时。这就是"AI 不碰、交给地图 API"的硬活。
 */
export async function buildLeg(
  from: { name: string } & Pt,
  to: { name: string } & Pt,
  city: string,
  taxiThresholdMinutes = 60
): Promise<RouteLeg> {
  const originalTo = to;
  from = await snapScenicAccess(from, originalTo);
  to = await snapScenicAccess(to, from);
  const straight = haversine(from, to);
  let mode: TransitMode;
  let distanceMeters: number;
  let durationMinutes: number;
  let description: string;
  let estimatedCost: number | undefined;
  let estimatedCostHigh: number | undefined;
  let alternatives: RouteLeg["alternatives"];

  if (straight < 1000) {
    const w = await walking(from, to);
    distanceMeters = w?.distance ?? Math.round(straight);
    durationMinutes = Math.max(1, Math.round((w?.duration ?? straight / 80) / 60));
    mode = "walking";
    description = `步行约${fmtDist(distanceMeters)}，约${durationMinutes}分钟`;
  } else {
    const [t, dr] = await Promise.all([
      transit(from, to, city, from.name, to.name),
      driving(from, to),
    ]);
    const transitMinutes = t ? Math.max(1, Math.round(t.duration / 60)) : null;
    const taxiMinutes = dr
      ? Math.max(1, Math.round(dr.duration / 60))
      : Math.max(1, Math.round(straight / 300 / 60));
    const transitFrom = t ? { ...from, ...t.origin } : from;
    const transitTo = t ? { ...to, ...t.destination } : to;
    if (t && dr) {
      const taxiFare = estimateTaxiFare(dr.distance);
      alternatives = [
        {
          mode: "subway",
          durationMinutes: transitMinutes || 1,
          distanceMeters: t.distance,
          description: `公交/地铁约${transitMinutes}分钟（含步行${fmtDist(
            t.walkingDistance
          )}）`,
          estimatedCost: t.cost,
          fromLng: transitFrom.lng,
          fromLat: transitFrom.lat,
          toLng: transitTo.lng,
          toLat: transitTo.lat,
        },
        {
          mode: "taxi",
          durationMinutes: taxiMinutes,
          distanceMeters: dr.distance,
          description: `打车约${fmtDist(dr.distance)}，约${taxiMinutes}分钟`,
          estimatedCost: taxiFare.low,
          estimatedCostHigh: taxiFare.high,
          fromLng: from.lng,
          fromLat: from.lat,
          toLng: to.lng,
          toLat: to.lat,
        },
      ];
    }
    const preferTaxi =
      Boolean(t && dr) &&
      (transitMinutes || 0) >= taxiThresholdMinutes &&
      taxiMinutes + 10 < (transitMinutes || 0);
    if (t && !preferTaxi) {
      mode = "transit";
      distanceMeters = t.distance;
      durationMinutes = transitMinutes || 1;
      description = `公交/地铁约${durationMinutes}分钟（含步行${fmtDist(t.walkingDistance)}）`;
      estimatedCost = t.cost;
      from = transitFrom;
      to = transitTo;
    } else {
      mode = "taxi";
      distanceMeters = dr?.distance ?? Math.round(straight);
      durationMinutes = taxiMinutes;
      description = `打车约${fmtDist(distanceMeters)}，约${durationMinutes}分钟`;
      const taxiFare = estimateTaxiFare(distanceMeters);
      estimatedCost = taxiFare.low;
      estimatedCostHigh = taxiFare.high;
    }
  }

  return {
    fromName: from.name,
    toName: to.name,
    mode,
    distanceMeters,
    durationMinutes,
    description,
    estimatedCost,
    estimatedCostHigh,
    fromLng: from.lng,
    fromLat: from.lat,
    toLng: to.lng,
    toLat: to.lat,
    alternatives,
  };
}
