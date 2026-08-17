import { NextRequest, NextResponse } from "next/server";
import { geocodePOI, searchAround, searchPlaces } from "@/lib/amap";
import { resolveCtripHotelUrl } from "@/lib/ctrip-resolver";
import { HotelCandidate, TripPlan } from "@/lib/types";

const PREF_KEYWORDS: Record<string, string> = {
  美食: "美食街",
  文化古迹: "文物古迹",
  自然风光: "公园",
  购物: "购物中心",
  亲子: "亲子景点",
  摄影打卡: "旅游景点",
  慢节奏: "公园",
};

function hotelKeyword(plan: TripPlan): string {
  if (plan.hotelPreferences?.includes("高端")) return "五星级酒店";
  if (plan.hotelPreferences?.includes("经济")) return "经济型酒店";
  if (plan.hotelPreferences?.includes("连锁")) return "连锁酒店";
  if (plan.hotelPreferences?.includes("特色")) return "特色酒店";
  return "酒店";
}

function preferenceNotes(plan: TripPlan): string[] {
  const preferences = plan.hotelPreferences || [];
  const notes: string[] = [];
  if (preferences.includes("经济")) notes.push("优先经济型");
  if (preferences.includes("高端")) notes.push("优先高星级");
  if (preferences.includes("舒适")) notes.push("优先中高端品牌");
  if (preferences.includes("安静")) notes.push("请在携程复核隔音与临街点评");
  if (preferences.includes("卫生优先")) notes.push("请在携程复核近期卫生评分与差评");
  if (preferences.includes("安全优先")) notes.push("请在携程复核门禁、前台与夜间周边点评");
  if (preferences.includes("交通便利")) notes.push("优先到达点或景点锚点周边");
  if (preferences.includes("连锁")) notes.push("优先连锁品牌");
  if (preferences.includes("特色")) notes.push("优先设计感或在地特色");
  return notes;
}

async function hotelsAround(
  query: string,
  center: { lng: number; lat: number },
  radius: number
) {
  const preferred = await searchAround(query, center, radius, 8);
  return preferred.length ? preferred : searchAround("酒店", center, radius, 8);
}

export async function POST(req: NextRequest) {
  try {
    const plan = (await req.json()) as TripPlan;
    const arrivalName = plan.outboundTransport?.arrivalTerminal;
    if (!plan.destination || !arrivalName) {
      return NextResponse.json({ error: "请先确认到达车站或机场。" }, { status: 400 });
    }
    const arrival = await geocodePOI(arrivalName, plan.destination);
    if (!arrival) {
      return NextResponse.json({ error: "没有找到已确认到达点。" }, { status: 422 });
    }

    const candidates: HotelCandidate[] = [];
    const query = hotelKeyword(plan);
    const notes = preferenceNotes(plan);
    const arrivalHotels = await hotelsAround(
      query,
      { lng: arrival.lng, lat: arrival.lat },
      6000
    );
    for (const hotel of arrivalHotels.slice(0, 4)) {
      candidates.push({
        id: hotel.id || `arrival-${hotel.lng}-${hotel.lat}`,
        name: hotel.name,
        address: hotel.address,
        lng: hotel.lng,
        lat: hotel.lat,
        group: "arrival",
        reason: `靠近${arrival.matchedName}，适合晚到或早班交通`,
        anchorName: arrival.matchedName,
        preferenceNotes: notes,
      });
    }

    const keyword =
      plan.preferences.map((preference) => PREF_KEYWORDS[preference]).find(Boolean) ||
      "旅游景点";
    const anchors = await searchPlaces(keyword, plan.destination, 8);
    const anchor = anchors.find((place) => !/酒店|宾馆|公司|公交站/.test(place.name));
    if (anchor) {
      const preferredHotels = await hotelsAround(
        query,
        { lng: anchor.lng, lat: anchor.lat },
        2500
      );
      for (const hotel of preferredHotels.slice(0, 4)) {
        if (candidates.some((item) => item.name === hotel.name)) continue;
        candidates.push({
          id: hotel.id || `preference-${hotel.lng}-${hotel.lat}`,
          name: hotel.name,
          address: hotel.address,
          lng: hotel.lng,
          lat: hotel.lat,
          group: "preference",
          reason: `靠近${anchor.name}，更贴合“${plan.preferences[0] || "热门景点"}”偏好`,
          anchorName: anchor.name,
          preferenceNotes: notes,
        });
      }
    }

    // 控制并发，避免同一时刻对携程发起过多检索而触发临时限制。
    const resolved: HotelCandidate[] = [];
    const queue = [...candidates];
    const worker = async () => {
      while (queue.length) {
        const candidate = queue.shift();
        if (!candidate) return;
        const ctripUrl = await resolveCtripHotelUrl(candidate.name, {
          city: plan.destination,
          address: candidate.address,
        });
        resolved.push({ ...candidate, ctripUrl: ctripUrl || undefined });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    // 酒店候选来自高德的真实 POI；携程直达页只是额外核对信息，
    // 不能因后者暂时不可用而把全部候选从用户面前移除。
    return NextResponse.json({ candidates: resolved });
  } catch (error) {
    console.error("Hotel options error:", error);
    return NextResponse.json({ error: "酒店候选加载失败，请稍后重试。" }, { status: 500 });
  }
}
