import { NextRequest, NextResponse } from "next/server";
import {
  geocodePOI,
  buildLeg,
  searchAround,
  regeoArea,
  distanceToNearest,
  AroundPlace,
} from "@/lib/amap";
import {
  clusterIntoDaysWeighted,
  orderByNearestNeighbor,
  centroid,
  haversine,
  estimateVisitMinutes,
  estimateTicketCost,
  mealCost,
  hotelNightCost,
  legCost,
  hmToMin,
  minToHm,
  Pt,
} from "@/lib/planner";
import { buildDurationPrompt, DURATION_SYSTEM_PROMPT } from "@/lib/prompts";
import {
  PlanRouteInput,
  GeoPOI,
  HotelTier,
  HotelPref,
  HotelRec,
  HotelExample,
  ScheduledStop,
  ScheduledDay,
  EnrichedPlan,
  BudgetItem,
  DroppedPOI,
} from "@/lib/types";

const DAY_START = "09:00";
const DAY_VISIT_BUDGET = 450; // 单日可游玩分钟预算（约 7.5 小时，余下给交通/吃饭）
const PACE_FACTOR: Record<string, number> = { 赶: 0.72, 适中: 1, 悠闲: 1.3 };

// 用 LLM 估每个景点的真实游玩时长 + 重要度（软判断），失败则回退到类别启发式
async function estimateDurations(
  city: string,
  pois: { name: string; category?: string }[]
): Promise<Map<string, { minutes: number; priority: number }>> {
  const out = new Map<string, { minutes: number; priority: number }>();
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (apiKey && apiKey !== "your-api-key-here") {
    try {
      const res = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "deepseek-chat",
          max_tokens: 2048,
          temperature: 0.2,
          messages: [
            { role: "system", content: DURATION_SYSTEM_PROMPT },
            { role: "user", content: buildDurationPrompt(city, pois) },
          ],
        }),
      });
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || "";
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        const parsed = JSON.parse(m[0]) as {
          results?: { name: string; minutes: number; priority: number }[];
        };
        for (const r of parsed.results || []) {
          if (r?.name) {
            out.set(r.name, {
              minutes: Math.max(30, Math.round(Number(r.minutes) || 0)),
              priority: Math.min(5, Math.max(1, Math.round(Number(r.priority) || 3))),
            });
          }
        }
      }
    } catch {
      /* 回退到启发式 */
    }
  }
  // 补齐 LLM 没给的
  for (const p of pois) {
    if (!out.has(p.name)) {
      out.set(p.name, { minutes: estimateVisitMinutes(p.category), priority: 3 });
    }
  }
  return out;
}

export async function POST(req: NextRequest) {
  if (!process.env.AMAP_KEY) {
    return NextResponse.json({ error: "未配置高德 AMAP_KEY。" }, { status: 500 });
  }

  try {
    const input: PlanRouteInput = await req.json();
    if (!input.city || !input.pois?.length || !input.days) {
      return NextResponse.json({ error: "缺少城市、天数或景点。" }, { status: 400 });
    }
    const tier: HotelTier = input.hotelTier || "舒适";
    const prefs: HotelPref[] = input.hotelPrefs?.length ? input.hotelPrefs : ["景点近"];
    const mustSet = new Set(input.mustInclude || []);
    const paceFactor = PACE_FACTOR[input.pace || "适中"] ?? 1;
    const LUNCH = hmToMin(input.lunchTime || "12:00");
    const DINNER = hmToMin(input.dinnerTime || "18:30");

    // 0) 分流：美食单独做"餐厅池"，其余才是要逐个游玩的景点
    const sightInput = input.pois.filter((p) => p.category !== "美食");
    const foodInput = input.pois.filter((p) => p.category === "美食");

    // 1) 地理编码（景点 + 餐厅池 + 酒店）
    const geo = await Promise.all(
      sightInput.map(async (p) => {
        const g = await geocodePOI(p.name, input.city);
        return g
          ? {
              ok: true as const,
              poi: {
                id: p.id,
                name: p.name,
                matchedName: g.matchedName,
                lng: g.lng,
                lat: g.lat,
                address: g.address,
                category: p.category,
                note: p.note,
              } as GeoPOI,
            }
          : { ok: false as const, id: p.id, name: p.name, category: p.category };
      })
    );
    const sightPois = geo.filter((r) => r.ok).map((r) => r.poi);
    const failedPOIs = geo.filter((r) => !r.ok).map((r) => r.name);
    if (sightPois.length === 0) {
      return NextResponse.json(
        { error: "景点都没能在地图上定位到，请检查名称或城市。" },
        { status: 422 }
      );
    }

    const foodPool: GeoPOI[] = (
      await Promise.all(
        foodInput.map(async (p) => {
          const g = await geocodePOI(p.name, input.city);
          return g
            ? ({
                id: p.id,
                name: p.name,
                matchedName: g.matchedName,
                lng: g.lng,
                lat: g.lat,
                address: g.address,
                category: "美食",
                note: p.note,
              } as GeoPOI)
            : null;
        })
      )
    ).filter((x): x is GeoPOI => x !== null);
    const usedFood = new Set<string>();

    let hotel: (Pt & { name: string }) | undefined;
    if (input.hotelName?.trim()) {
      const h = await geocodePOI(input.hotelName.trim(), input.city);
      if (h) hotel = { lng: h.lng, lat: h.lat, name: h.matchedName };
    }

    // 2) LLM 估真实游玩时长 + 重要度
    const durMap = await estimateDurations(
      input.city,
      sightPois.map((p) => ({ name: p.name, category: p.category }))
    );
    const meta = new Map(
      sightPois.map((p) => {
        const d = durMap.get(p.name) || { minutes: estimateVisitMinutes(p.category), priority: 3 };
        // 用「节奏」缩放滞留时间：赶=压缩、悠闲=拉长——把"时长不合理"交给用户一键调
        const minutes = Math.max(20, Math.round(d.minutes * paceFactor));
        return [p.id, { minutes, priority: p.id && mustSet.has(p.id) ? 6 : d.priority }];
      })
    );
    // 远途景点（离景点群中心 >22km，如八达岭长城）路上耗时极大，强制独占一天：
    // 把它的"有效容量"顶满一天，这样聚类不会再把市区景点塞进同一天。
    const coordById = new Map(sightPois.map((p) => [p.id, { lng: p.lng, lat: p.lat }]));
    const allCenter = centroid(sightPois.map((p) => ({ lng: p.lng, lat: p.lat })));
    const EXCURSION_M = 22000;
    const eff = (id: string) => {
      const m = meta.get(id)!.minutes;
      const far = haversine(coordById.get(id)!, allCenter) > EXCURSION_M;
      return far ? DAY_VISIT_BUDGET : Math.min(m, DAY_VISIT_BUDGET);
    };

    // 3) 可行性裁剪：装不下就按重要度删，必去的强制保留
    const dropped: DroppedPOI[] = [];
    const totalBudget = input.days * DAY_VISIT_BUDGET;
    const must = sightPois.filter((p) => mustSet.has(p.id));
    const rest = sightPois
      .filter((p) => !mustSet.has(p.id))
      .sort((a, b) => meta.get(b.id)!.priority - meta.get(a.id)!.priority);
    let used = must.reduce((s, p) => s + eff(p.id), 0);
    const kept: GeoPOI[] = [...must];
    for (const p of rest) {
      if (used + eff(p.id) <= totalBudget) {
        kept.push(p);
        used += eff(p.id);
      } else {
        dropped.push({
          id: p.id,
          name: p.name,
          category: p.category,
          reason: `${input.days}天按合理游玩时长装不下，已暂时移除`,
          swappable: true,
        });
      }
    }

    // 4) 时间容量聚类分天
    const clusters = clusterIntoDaysWeighted(
      kept.map((p) => ({ lng: p.lng, lat: p.lat })),
      kept.map((p) => eff(p.id)),
      input.days,
      DAY_VISIT_BUDGET
    );

    let ticketSum = 0;
    let mealSum = 0;
    let transitSum = 0;
    const scheduledDays: ScheduledDay[] = [];

    for (let d = 0; d < clusters.length; d++) {
      let dayPois = clusters[d].map((i) => kept[i]);

      // 单日超载兜底：仍超预算就把当天最不重要的删掉
      let dayLoad = dayPois.reduce((s, p) => s + meta.get(p.id)!.minutes, 0);
      while (dayLoad > DAY_VISIT_BUDGET && dayPois.length > 1) {
        const victim = dayPois.reduce((a, b) =>
          meta.get(a.id)!.priority <= meta.get(b.id)!.priority ? a : b
        );
        dayPois = dayPois.filter((p) => p.id !== victim.id);
        dayLoad -= meta.get(victim.id)!.minutes;
        dropped.push({
          id: victim.id,
          name: victim.name,
          category: victim.category,
          reason: "当天时间排满，已移除",
          swappable: true,
        });
      }

      if (dayPois.length === 0) {
        scheduledDays.push({ dayLabel: `Day ${d + 1}`, items: [], dayCostEstimate: 0 });
        continue;
      }

      const order = orderByNearestNeighbor(
        dayPois.map((p) => ({ lng: p.lng, lat: p.lat })),
        hotel
      );
      const stops = order.map((i) => dayPois[i]);

      const items: ScheduledStop[] = [];
      let clock = hmToMin(DAY_START);
      let dayCost = 0;
      let prev: Pt & { name: string } = hotel
        ? { ...hotel }
        : { lng: stops[0].lng, lat: stops[0].lat, name: stops[0].matchedName };
      let lunchDone = false;
      let dinnerDone = false;
      const usedAround = new Set<string>(); // 当天用过的就近餐厅名，避免一天吃同一家两次

      const insertMeal = async (label: "午餐" | "晚餐") => {
        // 优先从用户勾选的美食池里就近选；没有再用高德周边搜
        let pick: { name: string; lng: number; lat: number; address?: string } | undefined;
        const NEAR = 3000; // 美食池里的餐厅离当前位置 <3km 才用，否则就近搜（别为吃饭长途奔波）
        const avail = foodPool.filter((f) => !usedFood.has(f.id));
        let poolPick: GeoPOI | undefined;
        if (avail.length) {
          const cand = avail.reduce((a, b) => (haversine(prev, a) <= haversine(prev, b) ? a : b));
          if (haversine(prev, cand) <= NEAR) poolPick = cand;
        }
        if (poolPick) {
          usedFood.add(poolPick.id);
          pick = { name: poolPick.matchedName, lng: poolPick.lng, lat: poolPick.lat, address: poolPick.address };
        } else {
          const found: AroundPlace[] = await searchAround("美食", prev, 1500, 5);
          const fresh = found.find((f) => !usedAround.has(f.name)) || found[0];
          if (fresh) {
            usedAround.add(fresh.name);
            pick = fresh;
          }
        }
        const dest = pick ? { name: pick.name, lng: pick.lng, lat: pick.lat } : prev;
        const legIn = await buildLeg(prev, dest, input.city);
        clock += legIn.durationMinutes;
        transitSum += legCost(legIn.mode, legIn.distanceMeters);
        const cost = mealCost(tier);
        items.push({
          kind: "meal",
          name: pick ? pick.name : `${label}（就近用餐）`,
          category: label,
          address: pick?.address,
          arrive: minToHm(clock),
          depart: minToHm(clock + 60),
          durationMin: 60,
          costEstimate: cost,
          legIn,
        });
        mealSum += cost;
        dayCost += cost + legCost(legIn.mode, legIn.distanceMeters);
        clock += 60;
        if (pick) prev = { lng: pick.lng, lat: pick.lat, name: pick.name };
      };

      let hotelToFirst;
      if (hotel) hotelToFirst = await buildLeg({ ...hotel }, stops[0], input.city);

      for (let i = 0; i < stops.length; i++) {
        const stop = stops[i];
        const stopCoord = { lng: stop.lng, lat: stop.lat, name: stop.matchedName };
        const travel = i === 0 ? hotelToFirst : await buildLeg(prev, stop, input.city);
        if (travel) {
          clock += travel.durationMinutes;
          transitSum += legCost(travel.mode, travel.distanceMeters);
          dayCost += legCost(travel.mode, travel.distanceMeters);
        }
        // 情况A：到达时已过饭点（如长途后到达）→ 先在此就近吃；过窗太久则作废，不半夜补
        if (!lunchDone && clock >= LUNCH) {
          if (clock <= LUNCH + 180) await insertMeal("午餐");
          lunchDone = true;
        }
        if (!dinnerDone && clock >= DINNER) {
          if (clock <= DINNER + 180) await insertMeal("晚餐");
          dinnerDone = true;
        }

        const ticket = estimateTicketCost(stop.category);
        const emitSeg = (arrive: number, dur: number, first: boolean) => {
          items.push({
            kind: "poi",
            name: stop.name,
            matchedName: stop.matchedName,
            category: stop.category,
            note: first ? stop.note : undefined,
            address: first ? stop.address : undefined,
            arrive: minToHm(arrive),
            depart: minToHm(arrive + dur),
            durationMin: dur,
            costEstimate: first ? ticket : 0,
            legIn: first ? travel : undefined,
          });
          if (first) {
            ticketSum += ticket;
            dayCost += ticket;
          }
        };

        // 情况B：游玩时段横跨饭点 → 拆成两段，中间在景点附近吃一顿（修"整天单点没饭"）
        let segStart = clock;
        let remaining = meta.get(stop.id)!.minutes;
        let first = true;
        prev = stopCoord; // 让这顿就近从美食池里挑
        const mealsIn: ["午餐" | "晚餐", number][] = [];
        if (!lunchDone && LUNCH > segStart && LUNCH < segStart + remaining) mealsIn.push(["午餐", LUNCH]);
        if (!dinnerDone && DINNER > segStart && DINNER < segStart + remaining) mealsIn.push(["晚餐", DINNER]);
        mealsIn.sort((a, b) => a[1] - b[1]);
        for (const [label, mt] of mealsIn) {
          const before = mt - segStart;
          emitSeg(segStart, before, first);
          first = false;
          clock = mt;
          await insertMeal(label);
          if (label === "午餐") lunchDone = true;
          else dinnerDone = true;
          prev = stopCoord; // 吃完回到景点继续逛
          segStart = clock;
          remaining -= before;
        }
        emitSeg(segStart, remaining, first);
        clock = segStart + remaining;
        prev = stopCoord;
      }

      // 收尾补餐：饭点正好落在当天最后一个景点游玩期间时，别把这顿漏了
      if (!lunchDone && clock >= LUNCH && clock <= LUNCH + 180) await insertMeal("午餐");
      if (!dinnerDone && clock >= DINNER && clock <= DINNER + 180) await insertMeal("晚餐");

      let lastToHotel;
      if (hotel) {
        lastToHotel = await buildLeg(prev, { ...hotel }, input.city);
        transitSum += legCost(lastToHotel.mode, lastToHotel.distanceMeters);
        dayCost += legCost(lastToHotel.mode, lastToHotel.distanceMeters);
      }

      scheduledDays.push({
        dayLabel: `Day ${d + 1}`,
        items,
        hotelToFirst,
        lastToHotel,
        dayCostEstimate: Math.round(dayCost),
      });
    }

    // 没排上的美食（勾选的餐厅多于用餐次数）也列出来，让用户心里有数
    for (const f of foodPool) {
      if (!usedFood.has(f.id)) {
        dropped.push({
          id: f.id,
          name: f.name,
          category: "美食",
          reason: "用餐次数有限，这家没排上",
          swappable: false,
        });
      }
    }

    // 5) 酒店推荐（按位置偏好排序，搜真实酒店）
    const center = centroid(kept.map((p) => ({ lng: p.lng, lat: p.lat })));
    const area = (await regeoArea(center)) || input.city;
    const rawHotels = await searchAround("酒店", center, 3000, 8);
    const ranked = rawHotels
      .map((h) => ({ h, distCenter: haversine(center, h) }))
      .sort((a, b) => a.distCenter - b.distCenter)
      .slice(0, 5);

    const examples: HotelExample[] = [];
    for (const { h, distCenter } of ranked) {
      const tags: string[] = [];
      let score = 0;
      if (prefs.includes("景点近")) {
        score += Math.max(0, 3000 - distCenter);
        tags.push(`近景点群≈${(distCenter / 1000).toFixed(1)}km`);
      }
      if (prefs.includes("闹中取静")) {
        score += distCenter; // 离中心略远更安静
        tags.push("离喧嚣略远");
      }
      if (prefs.includes("地铁近")) {
        const dm = await distanceToNearest("地铁站", h, 1500);
        if (dm !== null) {
          score += Math.max(0, 1500 - dm);
          tags.push(`地铁≈${dm}m`);
        }
      }
      if (prefs.includes("公交近")) {
        const db = await distanceToNearest("公交站", h, 800);
        if (db !== null) {
          score += Math.max(0, 800 - db);
          tags.push(`公交≈${db}m`);
        }
      }
      examples.push({ name: h.name, address: h.address, tags });
      void score; // 已按"近景点"预排序；标注命中偏好即可（避免再做全量重排的额外调用）
    }
    const hotelRec: HotelRec = {
      area,
      prefs,
      reason: `按你的偏好（${prefs.join("、")}）在「${area}」一带挑选`,
      examples: examples.slice(0, 3),
    };

    // 6) 预算
    const nights = Math.max(1, input.days - 1);
    const hotelTotal = hotelNightCost(tier) * nights;
    const breakdown: BudgetItem[] = [
      { label: "景点门票", amount: Math.round(ticketSum) },
      { label: "餐饮", amount: Math.round(mealSum) },
      { label: "市内交通", amount: Math.round(transitSum) },
      { label: `住宿（${nights}晚·${tier}）`, amount: hotelTotal },
    ];
    const perPerson = breakdown.reduce((s, b) => s + b.amount, 0);

    const plan: EnrichedPlan = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      city: input.city,
      days: input.days,
      hotelName: hotel?.name || input.hotelName?.trim() || undefined,
      scheduledDays,
      hotelRec,
      budget: { perPerson, breakdown },
      failedPOIs,
      droppedPOIs: dropped,
    };

    return NextResponse.json(plan);
  } catch (err) {
    console.error("Plan route error:", err);
    return NextResponse.json({ error: "规划路线时出错，请重试。" }, { status: 500 });
  }
}
