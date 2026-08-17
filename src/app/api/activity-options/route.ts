import { NextRequest, NextResponse } from "next/server";
import { geocodePOIStrict, isPOIEntityNameMatch, searchAround, searchPlaces } from "@/lib/amap";
import { ActivityBlock, ActivityOption, TripPlan } from "@/lib/types";

function usedPlaceNames(plan: TripPlan): Set<string> {
  return new Set(
    plan.dailyPlans.flatMap((day) =>
      day.blocks
        .filter((block): block is ActivityBlock => block.type === "activity")
        .map((block) => block.matchedName || block.placeName || block.title)
    )
  );
}

function placeKey(name: string): string {
  return name.replace(/[（）()·\s\-—_]/g, "").toLowerCase();
}

function queryMatchScore(placeName: string, query?: string): number {
  const name = placeKey(placeName);
  const requested = placeKey(query || "");
  if (!requested) return 0;
  if (name === requested) return 3;
  if (name.includes(requested) || requested.includes(name)) return 2;
  return 0;
}

function categoryForExplicitAdd(query: string, fallback: string, placeType?: string): string {
  if (/餐饮服务|咖啡厅|甜品店|糕饼店/.test(placeType || "")) return "美食";
  if (/餐厅|饭馆|饭店|咖啡|甜品|小吃|酒吧|烤肉|烤鸭|火锅|面馆|菜馆|饭庄|酒家|餐馆/.test(query)) return "美食";
  if (/商场|市集|购物|买|逛街|街区|胡同/.test(query)) return "购物";
  if (/公园|湖|山|自然|骑行|夜骑/.test(query)) return "自然风光";
  if (/博物馆|展览|寺|故宫|历史|文化/.test(query)) return "文化古迹";
  return fallback === "美食" ? "休闲" : fallback;
}

function mapOption(
  place: { id?: string; name: string; address?: string; lng: number; lat: number; costPerPerson?: number },
  origin: ActivityOption["origin"],
  category?: string,
  note?: string,
  sourcePOIId?: string
): ActivityOption {
  return {
    id: `${origin}-${place.id || `${place.lng}-${place.lat}`}`,
    name: place.name,
    address: place.address,
    lng: place.lng,
    lat: place.lat,
    category,
    note,
    origin,
    sourcePOIId,
    costPerPerson: place.costPerPerson,
  };
}

export async function POST(request: NextRequest) {
  try {
    const { plan, dayIndex, blockId, preferredSourcePoiIds = [], addQuery, recommendOnly = false, excludeNames = [] } =
      (await request.json()) as {
        plan?: TripPlan;
        dayIndex?: number;
        blockId?: string;
        preferredSourcePoiIds?: string[];
        addQuery?: string;
        recommendOnly?: boolean;
        excludeNames?: string[];
      };
    if (!plan || dayIndex === undefined || !blockId) {
      return NextResponse.json({ error: "缺少行程或要调整的活动。" }, { status: 400 });
    }
    const day = plan.dailyPlans[dayIndex];
    const target = day?.blocks.find(
      (block): block is ActivityBlock => block.type === "activity" && block.id === blockId
    );
    if (!target) return NextResponse.json({ error: "找不到要调整的活动。" }, { status: 400 });

    const used = usedPlaceNames(plan);
    const excluded = new Set(excludeNames.map(placeKey));
    const options: ActivityOption[] = [];
    const normalizedAddQuery = addQuery?.replace(/(?:夜骑|夜景|打卡|游览|参观|逛逛|走走|看看)$/, "").trim();
    // 用户明确说出地点时先查这个地点；不能让未纳入的帖子地点占满前三个候选。
    const sourcePool = recommendOnly || normalizedAddQuery ? [] : [...(plan.sourcePOIs || [])]
      .filter((poi) => !used.has(poi.name) && !excluded.has(placeKey(poi.name)))
      .sort((a, b) => Number(preferredSourcePoiIds.includes(b.id)) - Number(preferredSourcePoiIds.includes(a.id)));
    const foodTarget = target.category === "美食";

    for (const poi of sourcePool) {
      if (foodTarget && !/美食|咖啡/.test(poi.category || "")) continue;
      const geo =
        poi.matchedName && poi.lng && poi.lat && isPOIEntityNameMatch(poi.name, poi.matchedName)
          ? { poiId: poi.mapPOIId, matchedName: poi.matchedName, address: poi.address, lng: poi.lng, lat: poi.lat }
          : await geocodePOIStrict(poi.name, plan.destination);
      if (!geo || used.has(geo.matchedName)) continue;
      options.push(
        mapOption(
          { id: geo.poiId, name: geo.matchedName, address: geo.address, lng: geo.lng, lat: geo.lat },
          "post",
          poi.category || target.category,
          poi.note,
          poi.id
        )
      );
      if (options.length >= 3) break;
    }

    const keyword = normalizedAddQuery
      ? normalizedAddQuery
      : foodTarget
        ? "餐厅"
        : target.category === "购物"
          ? "特色商业街"
          : target.category === "自然风光"
            ? "公园"
            : "旅游景点";
    if (recommendOnly || normalizedAddQuery) {
      const center = target.lng && target.lat ? { lng: target.lng, lat: target.lat } : undefined;
      const nearby = center ? await searchAround(keyword, center, 5000, 12) : [];
      const citywide = options.length < 3 ? await searchPlaces(keyword, plan.destination, 12) : [];
      const mapCandidates = [...nearby, ...citywide].sort(
        (a, b) => queryMatchScore(b.name, normalizedAddQuery) - queryMatchScore(a.name, normalizedAddQuery)
      );
      const requiresNamedMatch = Boolean(
        normalizedAddQuery && !/^(?:餐厅|饭店|饭馆|餐馆|咖啡馆|景点|旅游景点|公园|商场|街区|特色街区|特色商业街|胡同)$/.test(normalizedAddQuery)
      );
      const exactNamedMatches = requiresNamedMatch
        ? mapCandidates.filter((place) => queryMatchScore(place.name, normalizedAddQuery) === 3)
        : [];
      const explicitMatches = requiresNamedMatch
        ? exactNamedMatches.length > 0
          ? exactNamedMatches
          : mapCandidates.filter((place) => queryMatchScore(place.name, normalizedAddQuery) > 0)
        : mapCandidates;
      for (const place of explicitMatches) {
        if (
          options.length >= 3 ||
          used.has(place.name) ||
          excluded.has(placeKey(place.name)) ||
          options.some((item) => placeKey(item.name) === placeKey(place.name))
        ) continue;
        if (/公司|小学|中学|大学|酒店|宾馆|公交站|地铁站|停车场|出入口|售票处|服务区/.test(place.name)) continue;
        options.push(
          mapOption(
            place,
            "assistant-recommended",
            normalizedAddQuery
              ? categoryForExplicitAdd(addQuery || normalizedAddQuery, target.category, place.type)
              : foodTarget
                ? "美食"
                : target.category
          )
        );
      }
      if (requiresNamedMatch && normalizedAddQuery && options.length === 0) {
        const exact = await geocodePOIStrict(normalizedAddQuery, plan.destination);
        if (
          exact &&
          !used.has(exact.matchedName) &&
          !excluded.has(placeKey(exact.matchedName)) &&
          !/公司|公交站|地铁站|停车场|出入口|售票处|服务区/.test(exact.matchedName)
        ) {
          options.push(
            mapOption(
              {
                id: exact.poiId,
                name: exact.matchedName,
                address: exact.address,
                lng: exact.lng,
                lat: exact.lat,
                costPerPerson: exact.costPerPerson,
              },
              "assistant-recommended",
              categoryForExplicitAdd(addQuery || normalizedAddQuery, target.category)
            )
          );
        }
      }
    }

    return NextResponse.json({ options });
  } catch (error) {
    console.error("Activity options error:", error);
    return NextResponse.json({ error: "暂时无法找到可核对的替换地点。" }, { status: 500 });
  }
}
