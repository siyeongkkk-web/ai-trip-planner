import { ActivityBlock, Block, PlanHealthIssue, PlanHealthReport, TripPlan } from "./types";
import { listAgentUnscheduledPlaces } from "./trip-agent-tools";

function toMinutes(value?: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function isActivity(block: Block): block is ActivityBlock {
  return block.type === "activity";
}

function isMeal(activity: ActivityBlock) {
  return /早餐|午餐|晚餐|用餐|餐厅|饭店|饭馆|咖啡|美食/.test(
    `${activity.title} ${activity.category}`
  );
}

function hasMapIdentity(activity: ActivityBlock) {
  if (activity.activityKind === "flexible") return true;
  return Boolean(
    activity.matchedName &&
      Number.isFinite(activity.lng) &&
      Number.isFinite(activity.lat)
  );
}

function dayOverlapIssue(plan: TripPlan, dayIndex: number): PlanHealthIssue | null {
  const timedBlocks = plan.dailyPlans[dayIndex].blocks
    .map((block) => ({ block, start: toMinutes(block.type === "activity" ? block.startTime : undefined), end: toMinutes(block.type === "activity" ? block.endTime : undefined) }))
    .filter((item): item is { block: ActivityBlock; start: number; end: number } =>
      item.block.type === "activity" && item.start !== null && item.end !== null
    )
    .sort((a, b) => a.start - b.start);
  const overlap = timedBlocks.find((item, index) => index > 0 && item.start < timedBlocks[index - 1].end);
  if (!overlap) return null;
  return {
    id: `time-overlap-${dayIndex}`,
    severity: "risk",
    title: `Day ${dayIndex + 1} 存在活动时间重叠`,
    detail: `“${overlap.block.title}”与前一项活动的时间发生重叠；请先查看当天安排，再决定是否调整。`,
    dayIndex,
    action: "open-day",
    actionLabel: "查看当天",
  };
}

/**
 * 质检 Agent 的确定性编排层：复用已保存地点、地图实体和现有行程数据，
 * 只输出待确认清单，不在此处做任何网络写入或计划改动。
 */
export function buildPlanHealthReport(plan: TripPlan): PlanHealthReport {
  const issues: PlanHealthIssue[] = [];
  const unscheduled = listAgentUnscheduledPlaces(plan);
  if (unscheduled.length) {
    issues.push({
      id: "unscheduled-saved-places",
      severity: "attention",
      title: `${unscheduled.length} 个已保存地点暂未纳入`,
      detail: `包括 ${unscheduled.slice(0, 3).map((place) => place.name).join("、")}${unscheduled.length > 3 ? "等" : ""}。它们仍保留在原清单中，并非被 Agent 猜测出的地点。`,
      action: "open-saved-places",
      actionLabel: "查看已保存地点",
    });
  }

  plan.dailyPlans.forEach((day, dayIndex) => {
    const activities = day.blocks.filter(isActivity);
    const unverified = activities.filter((activity) => !hasMapIdentity(activity));
    if (unverified.length) {
      issues.push({
        id: `map-identity-${dayIndex}`,
        severity: "risk",
        title: `Day ${dayIndex + 1} 有 ${unverified.length} 个地点未具备完整地图实体`,
        detail: `“${unverified.slice(0, 2).map((activity) => activity.title).join("、")}${unverified.length > 2 ? "等" : ""}”缺少可核对的地图名称或坐标；不应把它们当作已验证路线事实。`,
        dayIndex,
        action: "open-day",
        actionLabel: "查看当天",
      });
    }

    const overlap = dayOverlapIssue(plan, dayIndex);
    if (overlap) issues.push(overlap);

    // 这是提醒而不是断言：首末日可能受大交通影响，不能把少于两餐直接判为错误。
    const mealCount = activities.filter(isMeal).length;
    if (activities.length >= 2 && mealCount < 2) {
      const anchor = activities.at(-1);
      issues.push({
        id: `meal-coverage-${dayIndex}`,
        severity: "attention",
        title: `Day ${dayIndex + 1} 餐饮安排可能不足`,
        detail: `当天识别到 ${mealCount} 项餐饮活动。若你希望补餐，行程 Agent 可以基于当天最后一个已核对地点搜索附近候选；确认前不会改动行程。`,
        dayIndex,
        action: "open-assistant",
        actionLabel: "查找附近候选",
        suggestedPrompt: anchor
          ? `请为第${dayIndex + 1}天在“${anchor.title}”后附近找一家适合用餐的地点。先给我地图已核对的候选方案，确认前不要修改行程。`
          : undefined,
      });
    }
  });

  const riskCount = issues.filter((issue) => issue.severity === "risk").length;
  return {
    status: issues.length ? "needs-attention" : "ready",
    summary: issues.length
      ? `已检查现有行程：发现 ${issues.length} 项待确认${riskCount ? `，其中 ${riskCount} 项需要优先核对` : ""}。`
      : "已检查现有行程：当前没有发现需要处理的地点、时间或已保存地点问题。",
    checkedAt: new Date().toISOString(),
    issues,
  };
}
