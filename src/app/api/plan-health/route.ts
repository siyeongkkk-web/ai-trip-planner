import { NextRequest, NextResponse } from "next/server";
import { buildPlanHealthReport } from "@/lib/plan-health";
import { TripPlan } from "@/lib/types";

/** 只读质检入口：不调用写入接口，也不会保存、调整或重排行程。 */
export async function POST(request: NextRequest) {
  try {
    const { plan } = (await request.json()) as { plan?: TripPlan };
    if (!plan?.dailyPlans?.length) {
      return NextResponse.json({ error: "缺少可检查的行程。" }, { status: 400 });
    }
    return NextResponse.json(buildPlanHealthReport(plan));
  } catch (error) {
    console.error("Plan health check error:", error);
    return NextResponse.json({ error: "行程检查失败，当前行程没有变化。" }, { status: 500 });
  }
}
