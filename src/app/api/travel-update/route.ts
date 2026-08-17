import { NextRequest, NextResponse } from "next/server";
import { buildTravelUpdateReport } from "@/lib/travel-update";
import { TripPlan } from "@/lib/types";

/** 外部数据只读检查：不保存、不重排，也不调用 adjust-plan。 */
export async function POST(request: NextRequest) {
  try {
    const { plan, dayIndex = 0 } = (await request.json()) as { plan?: TripPlan; dayIndex?: number };
    if (!plan?.dailyPlans?.length || !Number.isInteger(dayIndex)) {
      return NextResponse.json({ error: "缺少可检查的行程或日期。" }, { status: 400 });
    }
    return NextResponse.json(await buildTravelUpdateReport(plan, dayIndex));
  } catch (error) {
    console.error("Travel update check error:", error);
    return NextResponse.json({ error: "出行更新检查失败，当前行程没有变化。" }, { status: 500 });
  }
}
