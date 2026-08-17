import { NextRequest, NextResponse } from "next/server";
import { rebuildPlanItinerary } from "@/lib/plan-safety";
import { TripPlan } from "@/lib/types";

export async function POST(req: NextRequest) {
  try {
    const plan = (await req.json()) as TripPlan;
    if (!plan.selectedHotel || !plan.outboundTransport || !plan.returnTransport) {
      return NextResponse.json({ error: "缺少已确认交通或酒店。" }, { status: 400 });
    }
    const repaired: TripPlan = {
      ...plan,
      engineVersion: 7,
      dailyPlans: await rebuildPlanItinerary(plan),
      totalBudget: undefined,
      transportAdvice: undefined,
    };
    return NextResponse.json(repaired);
  } catch (error) {
    console.error("Repair plan error:", error);
    return NextResponse.json({ error: "旧行程自动修复失败。" }, { status: 500 });
  }
}
