// 高德地图 Web 服务 API 封装 —— 全部是"硬事实"：坐标、距离、真实交通耗时。
// 只在服务端调用（使用 AMAP_KEY）。
import { haversine, Pt } from "./planner";
import { RouteLeg, TransitMode } from "./types";

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

async function amapGet(url: string): Promise<AmapResp | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    await acquireSlot();
    try {
      const data: AmapResp = await (await fetch(url)).json();
      if (data.status === "0" && /CUQPS|QPS|LIMIT/i.test(data.info || "")) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue; // 限流，退避后重试
      }
      return data;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return null;
}

export interface GeocodeResult {
  matchedName: string;
  lng: number;
  lat: number;
  address?: string;
}

/** 地理编码 / 实体链接：景点名 → 地图真实 POI 坐标 */
export async function geocodePOI(
  name: string,
  city: string
): Promise<GeocodeResult | null> {
  const url = `${BASE}/place/text?keywords=${encodeURIComponent(
    name
  )}&city=${encodeURIComponent(city)}&citylimit=true&offset=1&key=${key()}`;
  const data = await amapGet(url);
  if (data?.status === "1" && Array.isArray(data.pois) && data.pois.length) {
    const p = data.pois[0] as { name: string; location: string; address?: unknown };
    const [lng, lat] = String(p.location).split(",").map(Number);
    if (!isFinite(lng) || !isFinite(lat)) return null;
    const address =
      typeof p.address === "string" && p.address ? p.address : undefined;
    return { matchedName: p.name, lng, lat, address };
  }
  return null;
}

function firstPath(data: AmapResp | null): { distance: number; duration: number } | null {
  const path = (data?.route as { paths?: { distance: string; duration: string }[] } | undefined)
    ?.paths?.[0];
  if (path) return { distance: Number(path.distance), duration: Number(path.duration) };
  return null;
}

export interface AroundPlace {
  name: string;
  lng: number;
  lat: number;
  address?: string;
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
  )}&radius=${radius}&offset=${limit}&page=1&sortrule=distance&key=${key()}`;
  const data = await amapGet(url);
  if (data?.status === "1" && Array.isArray(data.pois)) {
    return (data.pois as { name: string; location: string; address?: unknown }[])
      .map((p) => {
        const [lng, lat] = String(p.location).split(",").map(Number);
        return {
          name: p.name,
          lng,
          lat,
          address: typeof p.address === "string" && p.address ? p.address : undefined,
        };
      })
      .filter((p) => isFinite(p.lng) && isFinite(p.lat));
  }
  return [];
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

async function walking(o: Pt, d: Pt) {
  const url = `${BASE}/direction/walking?origin=${o.lng},${o.lat}&destination=${d.lng},${d.lat}&key=${key()}`;
  return firstPath(await amapGet(url));
}

async function transit(
  o: Pt,
  d: Pt,
  city: string
): Promise<{ distance: number; duration: number; walkingDistance: number } | null> {
  const url = `${BASE}/direction/transit/integrated?origin=${o.lng},${o.lat}&destination=${d.lng},${d.lat}&city=${encodeURIComponent(
    city
  )}&key=${key()}`;
  const data = await amapGet(url);
  const route = data?.route as
    | { distance?: string; transits?: { duration: string; distance?: string; walking_distance?: string }[] }
    | undefined;
  const t = route?.transits?.[0];
  if (t && Number(t.duration) > 0) {
    return {
      distance: Number(route?.distance || t.distance || 0),
      duration: Number(t.duration),
      walkingDistance: Number(t.walking_distance || 0),
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
 * 算一段路：根据直线距离选模式（近→步行；远→公交地铁；公交不可达→打车），
 * 再用真实 API 拿距离/耗时。这就是"AI 不碰、交给地图 API"的硬活。
 */
export async function buildLeg(
  from: { name: string } & Pt,
  to: { name: string } & Pt,
  city: string
): Promise<RouteLeg> {
  const straight = haversine(from, to);
  let mode: TransitMode;
  let distanceMeters: number;
  let durationMinutes: number;
  let description: string;

  if (straight < 1000) {
    const w = await walking(from, to);
    distanceMeters = w?.distance ?? Math.round(straight);
    durationMinutes = Math.max(1, Math.round((w?.duration ?? straight / 80) / 60));
    mode = "walking";
    description = `步行约${fmtDist(distanceMeters)}，约${durationMinutes}分钟`;
  } else {
    const t = await transit(from, to, city);
    if (t) {
      mode = "transit";
      distanceMeters = t.distance;
      durationMinutes = Math.max(1, Math.round(t.duration / 60));
      description = `公交/地铁约${durationMinutes}分钟（含步行${fmtDist(t.walkingDistance)}）`;
    } else {
      const dr = await driving(from, to);
      mode = "taxi";
      distanceMeters = dr?.distance ?? Math.round(straight);
      durationMinutes = Math.max(1, Math.round((dr?.duration ?? straight / 300) / 60));
      description = `打车约${fmtDist(distanceMeters)}，约${durationMinutes}分钟`;
    }
  }

  return { fromName: from.name, toName: to.name, mode, distanceMeters, durationMinutes, description };
}
