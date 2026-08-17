import { NextRequest, NextResponse } from "next/server";
import { rebuildPlanItinerary } from "@/lib/plan-safety";
import { TripPlan } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const { plan, blockId, mode } = (await request.json()) as {
      plan?: TripPlan;
      blockId?: string;
      mode?: "subway" | "taxi";
    };
    if (!plan || !blockId || (mode !== "subway" && mode !== "taxi")) {
      return NextResponse.json({ error: "缺少要确认的交通方案。" }, { status: 400 });
    }
    const target = plan.dailyPlans
      .flatMap((day) => day.blocks)
      .find((block) => block.type === "transport" && block.id === blockId);
    if (
      !target ||
      target.type !== "transport" ||
      !target.alternatives?.some((item) => item.mode === mode)
    ) {
      return NextResponse.json({ error: "这段路线没有可确认的替代方案。" }, { status: 400 });
    }
    const updated: TripPlan = {
      ...plan,
      transportModeOverrides: {
        ...plan.transportModeOverrides,
        [blockId]: mode,
        [`${target.fromPlace || ""}→${target.toPlace || ""}`]: mode,
      },
      engineVersion: 7,
    };
    updated.dailyPlans = await rebuildPlanItinerary(updated);
    updated.totalBudget = undefined;
    updated.transportAdvice = undefined;
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Confirm transport error:", error);
    return NextResponse.json({ error: "确认交通方案时出错，请重试。" }, { status: 500 });
  }
}
