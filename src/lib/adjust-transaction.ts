import {
  ActivityBlock,
  AdjustAction,
  AdjustReasonCode,
  DayPlan,
  TripPlan,
} from "./types";

export interface AdjustmentValidationInput {
  before: TripPlan;
  after: TripPlan;
  dayIndex: number;
  action: AdjustAction;
  targetBlockId: string;
  appliedBlockId: string;
  anchorBlockId?: string;
  selectedName?: string;
  authorizedRemovedBlockIds?: string[];
}

export interface AdjustmentValidationResult {
  ok: boolean;
  reasonCode?: AdjustReasonCode;
  message?: string;
  changedBlockIds: string[];
  unchangedBlockIds: string[];
}

/** 只有当前仍生效的请求身份可以提交结果；迟到响应必须丢弃。 */
export function isLatestAdjustmentResponse(
  responseRequestId: string | number,
  currentRequestId: string | number
): boolean {
  return responseRequestId === currentRequestId;
}

/** 候选预览只能提交到它生成时对应的同一份 revision。 */
export function isCurrentAdjustmentPreview(
  previewBaseRevision: number | undefined,
  currentRevision: number
): boolean {
  return Number.isInteger(previewBaseRevision) && previewBaseRevision === currentRevision;
}

function activities(day?: DayPlan): ActivityBlock[] {
  return (
    day?.blocks.filter((block): block is ActivityBlock => block.type === "activity") || []
  );
}

function comparableIdentity(block: ActivityBlock) {
  return {
    placeName: block.placeName || "",
    matchedName: block.matchedName || "",
    category: block.category || "",
    origin: block.origin || "",
    sourcePOIId: block.sourcePOIId || "",
  };
}

function sameIdentity(before: ActivityBlock, after: ActivityBlock) {
  return JSON.stringify(comparableIdentity(before)) === JSON.stringify(comparableIdentity(after));
}

function nameKey(value?: string) {
  return String(value || "")
    .replace(/[（）()·\s\-—_]/g, "")
    .toLowerCase();
}

function durationMinutes(block: ActivityBlock) {
  if (block.durationMinutes && block.durationMinutes > 0) return block.durationMinutes;
  const start = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(block.startTime);
  const end = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(block.endTime);
  if (!start || !end) return 0;
  return Number(end[1]) * 60 + Number(end[2]) - Number(start[1]) * 60 - Number(start[2]);
}

function sameOrder(beforeIds: string[], afterIds: string[]) {
  const allowed = new Set(beforeIds);
  return beforeIds.join("|") === afterIds.filter((id) => allowed.has(id)).join("|");
}

/**
 * 调整事务的唯一验收入口：先验证用户要求确实发生，再验证所有未授权活动没有变化。
 * 任一条件不满足，调用方必须丢弃整份 after，不能保存部分结果。
 */
export function validateAdjustmentTransaction({
  before,
  after,
  dayIndex,
  action,
  targetBlockId,
  appliedBlockId,
  anchorBlockId,
  selectedName,
  authorizedRemovedBlockIds = [],
}: AdjustmentValidationInput): AdjustmentValidationResult {
  for (let index = 0; index < before.dailyPlans.length; index += 1) {
    if (index === dayIndex) continue;
    if (JSON.stringify(before.dailyPlans[index]) !== JSON.stringify(after.dailyPlans[index])) {
      return {
        ok: false,
        reasonCode: "identity-changed",
        message: `第 ${index + 1} 天不在本次调整范围内，但发生了变化。`,
        changedBlockIds: [],
        unchangedBlockIds: [],
      };
    }
  }

  const beforeActivities = activities(before.dailyPlans[dayIndex]);
  const afterActivities = activities(after.dailyPlans[dayIndex]);
  const beforeById = new Map(beforeActivities.map((block) => [block.id, block]));
  const afterById = new Map(afterActivities.map((block) => [block.id, block]));
  const mutableIds = new Set([
    action === "remove" || action === "replace" || action === "extend"
      ? [targetBlockId]
      : [],
    ...authorizedRemovedBlockIds,
  ].flat());
  const unchangedBlockIds: string[] = [];

  for (const block of beforeActivities) {
    if (mutableIds.has(block.id)) continue;
    const rebuilt = afterById.get(block.id);
    if (!rebuilt) {
      return {
        ok: false,
        reasonCode: "schedule-conflict",
        message: `当天时间不足以同时保留既有活动“${block.title}”和本次调整。`,
        changedBlockIds: [],
        unchangedBlockIds,
      };
    }
    if (!sameIdentity(block, rebuilt)) {
      return {
        ok: false,
        reasonCode: "identity-changed",
        message: `既有活动“${block.title}”被换成了其他地点。`,
        changedBlockIds: [],
        unchangedBlockIds,
      };
    }
    unchangedBlockIds.push(block.id);
  }

  const expectedNewIds = action === "add" ? new Set([appliedBlockId]) : new Set<string>();
  const beforeIds = new Set(beforeActivities.map((block) => block.id));
  const unexpectedNew = afterActivities.find(
    (block) => !beforeIds.has(block.id) && !expectedNewIds.has(block.id)
  );
  if (unexpectedNew) {
    return {
      ok: false,
      reasonCode: "identity-changed",
      message: `重排时意外新增了“${unexpectedNew.title}”。`,
      changedBlockIds: [],
      unchangedBlockIds,
    };
  }

  const targetBefore = beforeById.get(targetBlockId);
  const targetAfter = afterById.get(targetBlockId);
  if (!targetBefore) {
    return {
      ok: false,
      reasonCode: "target-not-found",
      message: "找不到要调整的原活动。",
      changedBlockIds: [],
      unchangedBlockIds,
    };
  }

  if (action === "remove" && targetAfter) {
    return {
      ok: false,
      reasonCode: "result-mismatch",
      message: `“${targetBefore.title}”仍在行程中。`,
      changedBlockIds: [],
      unchangedBlockIds,
    };
  }

  for (const removedId of authorizedRemovedBlockIds) {
    if (afterById.has(removedId)) {
      return {
        ok: false,
        reasonCode: "result-mismatch",
        message: "应一并删除的原活动仍在行程中。",
        changedBlockIds: [],
        unchangedBlockIds,
      };
    }
  }

  if (action === "replace") {
    if (!targetAfter || !selectedName) {
      return {
        ok: false,
        reasonCode: "result-mismatch",
        message: "选中的替换地点没有写入目标活动。",
        changedBlockIds: [],
        unchangedBlockIds,
      };
    }
    const appliedName = targetAfter.placeName || targetAfter.matchedName || targetAfter.title;
    if (nameKey(appliedName) !== nameKey(selectedName)) {
      return {
        ok: false,
        reasonCode: "result-mismatch",
        message: `实际写入的是“${appliedName}”，不是你确认的“${selectedName}”。`,
        changedBlockIds: [],
        unchangedBlockIds,
      };
    }
  }

  if (action === "extend") {
    if (!targetAfter || !sameIdentity(targetBefore, targetAfter)) {
      return {
        ok: false,
        reasonCode: "identity-changed",
        message: "延长停留时间时，目标地点被意外改变。",
        changedBlockIds: [],
        unchangedBlockIds,
      };
    }
    if (durationMinutes(targetAfter) <= durationMinutes(targetBefore)) {
      return {
        ok: false,
        reasonCode: "result-mismatch",
        message: "目标活动的停留时间没有真正延长。",
        changedBlockIds: [],
        unchangedBlockIds,
      };
    }
  }

  if (action === "move" && targetAfter && !sameIdentity(targetBefore, targetAfter)) {
    return {
      ok: false,
      reasonCode: "identity-changed",
      message: "移动活动时，目标地点被意外改变。",
      changedBlockIds: [],
      unchangedBlockIds,
    };
  }

  if (action === "add" || action === "move") {
    const insertedId = action === "add" ? appliedBlockId : targetBlockId;
    const insertedIndex = afterActivities.findIndex((block) => block.id === insertedId);
    const anchorIndex = afterActivities.findIndex((block) => block.id === anchorBlockId);
    if (insertedIndex < 0 || anchorIndex < 0 || insertedIndex !== anchorIndex + 1) {
      return {
        ok: false,
        reasonCode: "schedule-conflict",
        message: "目标地点没有排在你指定的活动之后。",
        changedBlockIds: [],
        unchangedBlockIds,
      };
    }
  }

  const removedIds = new Set([
    ...(action === "remove" ? [targetBlockId] : []),
    ...authorizedRemovedBlockIds,
  ]);
  const originalOrder = beforeActivities
    .filter((block) => !removedIds.has(block.id))
    .filter((block) => action !== "move" || block.id !== targetBlockId)
    .map((block) => block.id);
  const rebuiltOrder = afterActivities
    .filter((block) => action !== "move" || block.id !== targetBlockId)
    .map((block) => block.id);
  if (!sameOrder(originalOrder, rebuiltOrder)) {
    return {
      ok: false,
      reasonCode: "identity-changed",
      message: "重排改变了未授权活动的相对顺序。",
      changedBlockIds: [],
      unchangedBlockIds,
    };
  }

  return {
    ok: true,
    changedBlockIds: [action === "add" ? appliedBlockId : targetBlockId, ...authorizedRemovedBlockIds],
    unchangedBlockIds,
  };
}
