import { NextRequest, NextResponse } from "next/server";
import {
  rebuildPlanItinerary,
  restaurantCuisineKey,
} from "@/lib/plan-safety";
import { validateAdjustmentTransaction } from "@/lib/adjust-transaction";
import {
  ActivityBlock,
  ActivityOption,
  AdjustOperationResult,
  AdjustReasonCode,
  AdjustRequest,
  AdjustResponse,
  TripPlan,
} from "@/lib/types";

function rejectedResponse(
  request: Pick<AdjustRequest, "action" | "dayIndex" | "blockId" | "anchorBlockId">,
  operationId: string,
  baseRevision: number,
  reasonCode: AdjustReasonCode,
  message: string,
  status = 409,
  resolutionOptions: string[] = []
) {
  const operationResult: AdjustOperationResult = {
    operationId,
    status: "rejected",
    action: request.action,
    dayIndex: request.dayIndex,
    targetBlockId: request.blockId,
    anchorBlockId: request.anchorBlockId,
    changedBlockIds: [],
    unchangedBlockIds: [],
    message,
    reasonCode,
    resolutionOptions,
    baseRevision,
    nextRevision: baseRevision,
  };
  return NextResponse.json<AdjustResponse>({ operationResult }, { status });
}

function scheduleResolutionOptions(plan: TripPlan, dayIndex: number) {
  const options = ["缩短新增地点的停留时间", "缩短前一个活动", "改到其他一天"];
  const lastDay = dayIndex === plan.dailyPlans.length - 1;
  if (lastDay && plan.returnTransport) {
    options.push("重新选择更晚的返程车次或航班后再安排");
  }
  return options;
}

async function activityFromOption(
  option: ActivityOption,
  target: ActivityBlock,
  mode: "replace" | "add"
): Promise<ActivityBlock | null> {
  if (!option.name.trim() || !Number.isFinite(option.lng) || !Number.isFinite(option.lat)) return null;
  const category = option.category || target.category || "休闲";
  const meal = mode === "replace" ? /早餐|午餐|晚餐/.exec(target.title)?.[0] : undefined;
  const base: ActivityBlock =
    mode === "replace"
      ? target
      : {
          type: "activity",
          id: `pending-add-${crypto.randomUUID()}`,
          startTime: "--:--",
          endTime: "--:--",
          title: "",
          category,
          cost: "价格待核实",
          duration: "1小时",
          durationMinutes: 60,
          tip: "开放、预约与价格请在官方渠道复核",
        };
  return {
    ...base,
    // 这个候选本身来自刚刚的高德查询，必须保留它的名称和坐标，不能再按名称二次匹配到另一家分店。
    title: option.activityKind === "flexible"
      ? `自由活动：${option.flexibleArea || option.name}`
      : category === "美食" ? `${meal || "用餐"}：${option.name}` : `游览${option.name}`,
    category,
    placeName: option.activityKind === "flexible" ? undefined : option.name,
    matchedName: option.activityKind === "flexible" ? undefined : option.name,
    address: option.activityKind === "flexible" ? undefined : option.address,
    lng: option.lng,
    lat: option.lat,
    cost: option.costPerPerson ? `高德参考人均 ¥${Math.round(option.costPerPerson)}` : "价格待核实",
    costSource: option.costPerPerson ? "amap-reference" : "unverified",
    tip: option.note || (option.address ? `地址：${option.address}；开放、预约与价格请在官方渠道复核` : "开放、预约与价格请在官方渠道复核"),
    origin: option.origin,
    sourcePOIId: option.sourcePOIId,
    userSelected: true,
    activityKind: option.activityKind,
    flexibleArea: option.flexibleArea,
  };
}

export async function POST(req: NextRequest) {
  const operationId = crypto.randomUUID();
  let adjustReq: AdjustRequest | undefined;
  try {
    adjustReq = (await req.json()) as AdjustRequest;
    const { plan, dayIndex, blockId, action } = adjustReq;
    const baseRevision = plan.revision || 0;
    const day = plan.dailyPlans[dayIndex];
    if (!day) {
      return rejectedResponse(
        adjustReq,
        operationId,
        baseRevision,
        "target-not-found",
        "找不到要调整的日期，当前行程保持不变。",
        400
      );
    }

    const target = day.blocks.find(
      (block): block is ActivityBlock => block.type === "activity" && block.id === blockId
    );
    if (!target) {
      return rejectedResponse(
        adjustReq,
        operationId,
        baseRevision,
        "target-not-found",
        "找不到要调整的活动，当前行程保持不变。",
        400
      );
    }

    const activities = day.blocks.filter(
      (block): block is ActivityBlock => block.type === "activity"
    );
    const targetIndex = activities.findIndex((activity) => activity.id === blockId);
    const nextActivities = [...activities];
    let changedBlockId = blockId;
    let requiredAfterBlockId: string | undefined;

    const excludedRestaurantNames = [...(plan.excludedRestaurantNames || [])];
    const excludedCuisineKeys = [...(plan.excludedCuisineKeys || [])];
    const preRemoveBlockIds = [...new Set(adjustReq.preRemoveBlockIds || [])];
    if (action !== "add" && preRemoveBlockIds.length) {
      return rejectedResponse(
        adjustReq,
        operationId,
        baseRevision,
        "invalid-request",
        "复合调整目前只能作为“先删除旧活动，再新增已确认候选”执行；当前行程没有改变。",
        400
      );
    }
    if (preRemoveBlockIds.includes(blockId)) {
      return rejectedResponse(
        adjustReq,
        operationId,
        baseRevision,
        "invalid-request",
        "不能同时删除新增方案的锚点活动，当前行程没有改变。",
        400
      );
    }
    if (preRemoveBlockIds.some((id) => !activities.some((activity) => activity.id === id))) {
      return rejectedResponse(
        adjustReq,
        operationId,
        baseRevision,
        "target-not-found",
        "要一并删除的原活动已不存在，当前行程没有改变。",
        400
      );
    }

    if (action === "remove") {
      nextActivities.splice(targetIndex, 1);
    } else if (action === "extend") {
      const currentMinutes =
        target.durationMinutes ||
        Math.max(
          30,
          ((Number(target.endTime.slice(0, 2)) * 60 +
            Number(target.endTime.slice(3, 5)) -
            Number(target.startTime.slice(0, 2)) * 60 -
            Number(target.startTime.slice(3, 5))) || 60)
        );
      const extra = Math.max(15, Math.min(180, adjustReq.extraMinutes || 60));
      nextActivities[targetIndex] = {
        ...target,
        durationMinutes: currentMinutes + extra,
        duration: `${currentMinutes + extra}分钟`,
      };
    } else if (action === "replace") {
      const oldName = target.matchedName || target.placeName || target.title;
      const replacement = adjustReq.option
        ? await activityFromOption(adjustReq.option, target, "replace")
        : null;
      if (!replacement) {
        return rejectedResponse(
          adjustReq,
          operationId,
          baseRevision,
          "invalid-request",
          "请先从候选地点中选择一个，当前行程没有改变。",
          400
        );
      }
      if (target.category === "美食") {
        if (!excludedRestaurantNames.includes(oldName)) excludedRestaurantNames.push(oldName);
        const cuisineKey = restaurantCuisineKey(oldName);
        if (cuisineKey && !excludedCuisineKeys.includes(cuisineKey)) excludedCuisineKeys.push(cuisineKey);
      }
      nextActivities[targetIndex] = {
        ...replacement,
        id: target.id,
        durationMinutes: target.durationMinutes,
        startTime: target.startTime,
        endTime: target.endTime,
      };
    } else if (action === "add") {
      const addition = adjustReq.option
        ? await activityFromOption(adjustReq.option, target, "add")
        : null;
      if (!addition) {
        return rejectedResponse(
          adjustReq,
          operationId,
          baseRevision,
          "invalid-request",
          "请先选择一个可核对的新增地点，当前行程没有改变。",
          400
        );
      }
      // 复合提案在内存副本上先删除旧活动、再插入用户确认的候选；任何验证失败都不保存。
      if (preRemoveBlockIds.length) {
        for (let index = nextActivities.length - 1; index >= 0; index -= 1) {
          if (preRemoveBlockIds.includes(nextActivities[index].id)) nextActivities.splice(index, 1);
        }
      }
      const anchorIndex = nextActivities.findIndex((activity) => activity.id === target.id);
      if (anchorIndex < 0) {
        return rejectedResponse(
          adjustReq,
          operationId,
          baseRevision,
          "anchor-not-found",
          "新增地点的锚点已不在行程中，当前行程没有改变。",
          400
        );
      }
      changedBlockId = `added-${crypto.randomUUID()}`;
      requiredAfterBlockId = target.id;
      nextActivities.splice(anchorIndex + 1, 0, {
        ...addition,
        id: changedBlockId,
        durationMinutes: addition.durationMinutes || 60,
        duration: addition.duration || "60分钟",
        placementAfterBlockId: target.id,
      });
    } else if (action === "move") {
      const anchorBlockId = adjustReq.anchorBlockId;
      const anchorIndex = nextActivities.findIndex((activity) => activity.id === anchorBlockId);
      if (!anchorBlockId || anchorIndex < 0 || anchorBlockId === target.id) {
        return rejectedResponse(
          adjustReq,
          operationId,
          baseRevision,
          "anchor-not-found",
          "找不到要排在其后的活动，当前行程没有改变。",
          400
        );
      }
      const [moved] = nextActivities.splice(targetIndex, 1);
      const updatedAnchorIndex = nextActivities.findIndex((activity) => activity.id === anchorBlockId);
      requiredAfterBlockId = anchorBlockId;
      nextActivities.splice(updatedAnchorIndex + 1, 0, {
        ...moved,
        placementAfterBlockId: anchorBlockId,
      });
    } else {
      return rejectedResponse(
        adjustReq,
        operationId,
        baseRevision,
        "invalid-request",
        "不支持这项调整，当前行程没有改变。",
        400
      );
    }

    const nextPlan: TripPlan = {
      ...plan,
      dailyPlans: plan.dailyPlans.map((existing, index) =>
        index === dayIndex
          ? { ...existing, blocks: nextActivities, dailyBudget: undefined }
          : existing
      ),
      totalBudget: undefined,
      transportAdvice: undefined,
      excludedRestaurantNames,
      excludedCuisineKeys,
      engineVersion: 7,
    };
    nextPlan.dailyPlans = process.env.AMAP_KEY
      ? await rebuildPlanItinerary(nextPlan, {
          dayIndexes: [dayIndex],
          preserveExistingActivities: true,
        })
      : nextPlan.dailyPlans;

    const validation = validateAdjustmentTransaction({
      before: plan,
      after: nextPlan,
      dayIndex,
      action,
      targetBlockId: blockId,
      appliedBlockId: changedBlockId,
      anchorBlockId: requiredAfterBlockId,
      selectedName: adjustReq.option?.name,
      authorizedRemovedBlockIds: preRemoveBlockIds,
    });
    if (!validation.ok) {
      const reasonCode = validation.reasonCode || "result-mismatch";
      const requestedChange =
        action === "add"
          ? `新增“${adjustReq.option?.name || "该地点"}”`
          : action === "replace"
            ? `替换为“${adjustReq.option?.name || "该地点"}”`
            : `调整“${target.title}”`;
      const failureMessage =
        reasonCode === "identity-changed"
          ? `${requestedChange}未执行：系统检测到重排会改动其他既有活动。${validation.message || ""}整份修改已回滚，原行程保持不变。`
          : `${requestedChange}未执行：${validation.message || "目标调整没有完整生效。"}整份修改已回滚，原行程保持不变。`;
      return rejectedResponse(
        adjustReq,
        operationId,
        baseRevision,
        reasonCode,
        failureMessage,
        409,
        reasonCode === "schedule-conflict"
          ? scheduleResolutionOptions(plan, dayIndex)
          : reasonCode === "identity-changed"
            ? ["保持当前行程", "重试同一地点"]
            : ["保持当前行程", "重新选择候选地点"]
      );
    }

    const nextRevision = baseRevision + 1;
    nextPlan.revision = nextRevision;
    const anchorTitle = requiredAfterBlockId
      ? activities.find((activity) => activity.id === requiredAfterBlockId)?.title
      : undefined;
    const removedTitles = activities
      .filter((activity) => preRemoveBlockIds.includes(activity.id))
      .map((activity) => `“${activity.title}”`);
    const successMessage =
      action === "remove"
        ? `已删除“${target.title}”，其余既有活动保持不变。`
        : action === "extend"
          ? `已延长“${target.title}”的停留时间，并只重算第 ${dayIndex + 1} 天的后续时间与路线。`
          : action === "replace"
            ? `已将“${target.title}”替换为“${adjustReq.option?.name}”，其余既有活动保持不变。`
            : action === "add"
              ? `${removedTitles.length ? `已删除${removedTitles.join("、")}，并` : "已"}在“${anchorTitle || target.title}”后新增“${adjustReq.option?.name}”，其余未授权既有活动保持不变。`
              : `已将“${target.title}”移动到“${anchorTitle}”之后，其余既有活动保持不变。`;
    const operationResult: AdjustOperationResult = {
      operationId,
      status: "applied",
      action,
      dayIndex,
      targetBlockId: blockId,
      anchorBlockId: requiredAfterBlockId,
      appliedBlockId: changedBlockId,
      changedBlockIds: validation.changedBlockIds,
      unchangedBlockIds: validation.unchangedBlockIds,
      message: successMessage,
      baseRevision,
      nextRevision,
    };
    return NextResponse.json<AdjustResponse>({ plan: nextPlan, operationResult });
  } catch (error) {
    console.error("Adjust plan error:", error);
    if (adjustReq) {
      return rejectedResponse(
        adjustReq,
        operationId,
        adjustReq.plan?.revision || 0,
        "result-mismatch",
        "调整过程中出现错误，整份修改没有保存，原行程保持不变。",
        500,
        ["保持当前行程", "稍后重新发起调整"]
      );
    }
    return NextResponse.json(
      { error: "调整行程时出错，请重试。" },
      { status: 500 }
    );
  }
}
