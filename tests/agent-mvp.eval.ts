import assert from "node:assert/strict";
import test from "node:test";

import {
  isCurrentAdjustmentPreview,
  isLatestAdjustmentResponse,
  validateAdjustmentTransaction,
} from "../src/lib/adjust-transaction";
import { createTripAgentTrace, runTripPlanningAgent, TripAgentDependencies } from "../src/lib/trip-agent-harness";
import { businessHoursStatus } from "../src/lib/trip-agent-tools";
import { buildTravelUpdateReport } from "../src/lib/travel-update";
import { ActivityOption, TripPlan } from "../src/lib/types";
import { renameCandidateAndInvalidateVerification } from "../src/lib/poi-source";

function toolCall(id: string, name: string, args: Record<string, unknown>) {
  return {
    role: "assistant" as const,
    content: null,
    tool_calls: [{
      id,
      type: "function" as const,
      function: { name, arguments: JSON.stringify(args) },
    }],
  };
}

function scriptedModel(messages: ReturnType<typeof toolCall>[]) {
  let index = 0;
  return async () => {
    const message = messages[index++];
    if (!message) return { role: "assistant" as const, content: "已完成分析。" };
    return message;
  };
}

function planFixture(): TripPlan {
  return {
    id: "eval-plan",
    revision: 3,
    destination: "北京",
    departureCity: "上海",
    days: 2,
    preferences: ["人文"],
    createdAt: "2026-08-09T00:00:00.000Z",
    dailyPlans: [
      {
        dayLabel: "Day 1",
        blocks: [
          {
            type: "activity",
            id: "a-museum",
            startTime: "09:00",
            endTime: "11:00",
            title: "游览旧博物馆",
            placeName: "旧博物馆",
            matchedName: "旧博物馆",
            category: "景点",
            cost: "0元",
            duration: "2小时",
            durationMinutes: 120,
            tip: "",
            lng: 116.39,
            lat: 39.90,
            origin: "post",
            sourcePOIId: "saved-a",
          },
          {
            type: "activity",
            id: "b-dinner",
            startTime: "18:00",
            endTime: "19:00",
            title: "晚餐：京味餐厅",
            placeName: "京味餐厅",
            matchedName: "京味餐厅",
            category: "美食",
            cost: "100元",
            duration: "1小时",
            durationMinutes: 60,
            tip: "",
            lng: 116.40,
            lat: 39.91,
            origin: "assistant-recommended",
          },
        ],
      },
      {
        dayLabel: "Day 2",
        blocks: [{
          type: "activity",
          id: "c-palace",
          startTime: "09:00",
          endTime: "12:00",
          title: "游览故宫",
          placeName: "故宫博物院",
          matchedName: "故宫博物院",
          category: "景点",
          cost: "60元",
          duration: "3小时",
          durationMinutes: 180,
          tip: "",
          lng: 116.397,
          lat: 39.916,
          origin: "post",
          sourcePOIId: "saved-c",
        }],
      },
    ],
  };
}

const parkOption: ActivityOption = {
  id: "park-option",
  name: "龙潭公园",
  address: "北京市东城区",
  category: "景点",
  lng: 116.44,
  lat: 39.88,
  origin: "assistant-recommended",
  proposedDayIndex: 0,
  proposedAnchorBlockId: "b-dinner",
  proposedAnchorTitle: "晚餐：京味餐厅",
  estimatedStartTime: "19:20",
  estimatedEndTime: "20:20",
  estimatedAddedTravelMinutes: 20,
  businessHours: "06:00-21:30",
  openingStatus: "open",
};

test("E01 复合目标保留到确认：删除旧活动与新增候选一次提案", async () => {
  const result = await runTripPlanningAgent({
    apiKey: "eval-key",
    plan: planFixture(),
    userMessage: "删掉旧博物馆，然后晚餐后推荐一个公园",
    history: [],
    activeDayIndex: 0,
    dependencies: {
      callModel: scriptedModel([
        toolCall("t1", "understand_trip_request", {
          goal: "remove-and-add",
          target_block_id: "a-museum",
          anchor_block_id: "b-dinner",
          needs_candidate: true,
          summary: "删除旧博物馆，并在晚餐后新增公园",
        }),
        toolCall("t2", "recommend_after_removing_activity", {
          day: 1,
          remove_block_id: "a-museum",
          anchor_block_id: "b-dinner",
          keyword: "公园",
          visit_minutes: 60,
          radius_meters: 4000,
        }),
      ]),
      recommendAfterRemoving: async () => [parkOption],
    },
  });

  assert.equal(result.action, "add");
  assert.equal(result.options?.[0].id, "park-option");
  assert.deepEqual(result.plannedOperations, [
    { type: "remove", dayIndex: 0, blockId: "a-museum" },
  ]);
  assert.match(result.reply, /确认前不会修改行程/);
});

test("Trace 记录完整模型、工具 observation 与初始上下文，不改变候选行为", async () => {
  const plan = planFixture();
  const trace = createTripAgentTrace({
    plan,
    history: [],
    userMessage: "这个公园晚上八点开放吗？",
    activeDayIndex: 0,
    candidateContext: [parkOption],
  });
  const result = await runTripPlanningAgent({
    apiKey: "eval-key",
    plan,
    userMessage: "这个公园晚上八点开放吗？",
    history: [],
    activeDayIndex: 0,
    candidateContext: [parkOption],
    trace,
    dependencies: {
      callModel: scriptedModel([
        toolCall("t1", "understand_trip_request", {
          goal: "answer", target_block_id: "", anchor_block_id: "", needs_candidate: false, summary: "查询候选营业时间",
        }),
        toolCall("t2", "check_place_business_hours", { option_id: "park-option", at_time: "20:00" }),
      ]),
    },
  });

  assert.equal(result.action, undefined);
  assert.equal(trace.initial.userMessage, "这个公园晚上八点开放吗？");
  assert.equal(trace.completeMessagesTranscript.at(-1)?.role, "assistant");
  assert.deepEqual(trace.spans.map((span) => `${span.spanType}:${span.name}`), [
    "model:chat.completions", "tool:understand_trip_request",
    "model:chat.completions", "tool:check_place_business_hours",
    "model:chat.completions",
  ]);
  assert.match(JSON.stringify(trace.spans.at(-2)?.output), /openingStatus|营业时间/);
});

test("E02 候选缺少营业时间时保持 unknown，不猜测开放", async () => {
  const unknownOption = { ...parkOption, businessHours: undefined, openingStatus: "unknown" as const };
  const result = await runTripPlanningAgent({
    apiKey: "eval-key",
    plan: planFixture(),
    userMessage: "这个公园晚上八点开放吗？",
    history: [],
    activeDayIndex: 0,
    candidateContext: [unknownOption],
    dependencies: {
      callModel: scriptedModel([
        toolCall("t1", "understand_trip_request", {
          goal: "answer",
          target_block_id: "",
          anchor_block_id: "",
          needs_candidate: false,
          summary: "核对上一轮公园候选晚上八点是否开放",
        }),
        toolCall("t2", "check_place_business_hours", {
          option_id: "park-option",
          at_time: "20:00",
        }),
      ]),
    },
  });

  assert.match(result.agentSteps.join("\n"), /核对候选营业时间：park-option/);
  assert.equal(result.action, undefined);
});

test("E03 未先地图解析就使用地点 handle 时，不产生可确认动作", async () => {
  const result = await runTripPlanningAgent({
    apiKey: "eval-key",
    plan: planFixture(),
    userMessage: "把天坛加进行程",
    history: [],
    activeDayIndex: 0,
    dependencies: {
      callModel: scriptedModel([
        toolCall("t1", "understand_trip_request", {
          goal: "add",
          target_block_id: "",
          anchor_block_id: "",
          needs_candidate: true,
          summary: "新增天坛",
        }),
        toolCall("t2", "find_best_insertion_slots", {
          place_handle: "invented-handle",
          visit_minutes: 90,
          allowed_days: [],
        }),
      ]),
    },
  });

  assert.equal(result.action, undefined);
  assert.equal(result.options, undefined);
  assert.match(result.reply, /没有找到.*可确认候选/);
});

test("E04 散步看夜景可建模为 flexible，不伪装成地图 POI", async () => {
  const result = await runTripPlanningAgent({
    apiKey: "eval-key",
    plan: planFixture(),
    userMessage: "晚餐后就在附近散步看夜景，不用安排具体景点",
    history: [],
    activeDayIndex: 0,
    dependencies: {
      callModel: scriptedModel([
        toolCall("t1", "understand_trip_request", {
          goal: "add",
          target_block_id: "",
          anchor_block_id: "b-dinner",
          needs_candidate: true,
          summary: "晚餐后增加不对应具体POI的周边散步",
        }),
        toolCall("t2", "propose_flexible_activity", {
          day: 1,
          anchor_block_id: "b-dinner",
          area: "长安街沿线",
          visit_minutes: 45,
        }),
      ]),
    },
  });

  assert.equal(result.options?.[0].activityKind, "flexible");
  assert.equal(result.options?.[0].flexibleArea, "长安街沿线");
  assert.equal(result.options?.[0].sourcePOIId, undefined);
});

test("E05 地图无匹配时不编造实体，行程保持无动作", async () => {
  const result = await runTripPlanningAgent({
    apiKey: "eval-key",
    plan: planFixture(),
    userMessage: "新增一个地图上不存在的测试地点",
    history: [],
    activeDayIndex: 0,
    dependencies: {
      callModel: scriptedModel([
        toolCall("t1", "understand_trip_request", {
          goal: "add",
          target_block_id: "",
          anchor_block_id: "",
          needs_candidate: true,
          summary: "新增指定地点",
        }),
        toolCall("t2", "resolve_place", {
          query: "地图上不存在的测试地点",
          aliases: [],
        }),
      ]),
      resolvePlaces: async () => [],
    },
  });

  assert.equal(result.action, undefined);
  assert.equal(result.options, undefined);
  assert.match(result.reply, /当前行程没有变化/);
});

test("E06 预计到达时间不在营业时段内时判定 closed", () => {
  assert.equal(businessHoursStatus("09:00-18:00", "20:00"), "closed");
  assert.equal(businessHoursStatus(undefined, "20:00"), "unknown");
});

test("E07 新增导致既有活动消失时，事务验收判定冲突", () => {
  const before = planFixture();
  const after = structuredClone(before);
  after.dailyPlans[0].blocks = [
    after.dailyPlans[0].blocks[1],
    {
      type: "activity",
      id: "new-park",
      startTime: "19:20",
      endTime: "20:20",
      title: "游览龙潭公园",
      placeName: "龙潭公园",
      matchedName: "龙潭公园",
      category: "景点",
      cost: "0元",
      duration: "60分钟",
      durationMinutes: 60,
      tip: "",
      lng: 116.44,
      lat: 39.88,
      origin: "assistant-recommended",
    },
  ];
  const validation = validateAdjustmentTransaction({
    before,
    after,
    dayIndex: 0,
    action: "add",
    targetBlockId: "b-dinner",
    appliedBlockId: "new-park",
    anchorBlockId: "b-dinner",
    selectedName: "龙潭公园",
  });

  assert.equal(validation.ok, false);
  assert.equal(validation.reasonCode, "schedule-conflict");
  assert.deepEqual(validation.changedBlockIds, []);
});

test("E08 请求已取消时 Agent 在调用模型前停止", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runTripPlanningAgent({
      apiKey: "eval-key",
      plan: planFixture(),
      userMessage: "继续调整",
      history: [],
      activeDayIndex: 0,
      signal: controller.signal,
      dependencies: {
        callModel: async () => {
          throw new Error("取消后不应调用模型");
        },
      },
    }),
    (error: unknown) => error instanceof DOMException && error.name === "AbortError"
  );
});

test("E09 降雨只生成待确认风险，不改写原行程", async () => {
  const plan = planFixture();
  plan.startDate = "2026-08-09";
  const before = structuredClone(plan);
  const report = await buildTravelUpdateReport(plan, 0, {
    getWeather: async () => ({
      city: "北京",
      adcode: "110000",
      reportTime: "2026-08-09 08:00",
      forecasts: [{
        date: "2026-08-09",
        dayWeather: "中雨",
        nightWeather: "小雨",
      }],
    }),
    getTraffic: async () => null,
  });

  assert.equal(report.status, "needs-attention");
  assert.match(report.issues[0].suggestedPrompt, /不要直接修改行程/);
  assert.deepEqual(plan, before);
});

test("E10 其他日期被意外改动时，事务验收拒绝整份结果", () => {
  const before = planFixture();
  const after = structuredClone(before);
  after.dailyPlans[0].blocks.push({
    type: "activity",
    id: "new-park",
    startTime: "19:20",
    endTime: "20:20",
    title: "游览龙潭公园",
    placeName: "龙潭公园",
    matchedName: "龙潭公园",
    category: "景点",
    cost: "0元",
    duration: "60分钟",
    durationMinutes: 60,
    tip: "",
    lng: 116.44,
    lat: 39.88,
    origin: "assistant-recommended",
  });
  after.dailyPlans[1].blocks = [];

  const validation = validateAdjustmentTransaction({
    before,
    after,
    dayIndex: 0,
    action: "add",
    targetBlockId: "b-dinner",
    appliedBlockId: "new-park",
    anchorBlockId: "b-dinner",
    selectedName: "龙潭公园",
  });

  assert.equal(validation.ok, false);
  assert.equal(validation.reasonCode, "identity-changed");
  assert.deepEqual(validation.changedBlockIds, []);
});

test("地点改名后清除旧地图核验，不复用旧实体", () => {
  const renamed = renameCandidateAndInvalidateVerification({
    id: "poi-saved-1",
    name: "海城美术馆",
    evidence: "海城美术馆",
    selected: true,
    mapVerification: {
      status: "matched",
      query: "海城美术馆",
      matchedName: "海城美术馆",
      poiId: "map-100",
      lng: 120.1,
      lat: 30.2,
      verifiedAt: "2026-08-13T00:00:00.000Z",
    },
  }, "海城艺术中心");

  assert.equal(renamed.name, "海城艺术中心");
  assert.equal(renamed.manual, true);
  assert.equal(renamed.mapVerification, undefined);
});

test("迟到的旧请求响应不能覆盖当前请求", () => {
  assert.equal(isLatestAdjustmentResponse("req-new", "req-new"), true);
  assert.equal(isLatestAdjustmentResponse("req-old", "req-new"), false);
});

test("旧revision候选预览不能提交到新版本行程", () => {
  assert.equal(isCurrentAdjustmentPreview(8, 8), true);
  assert.equal(isCurrentAdjustmentPreview(7, 8), false);
  assert.equal(isCurrentAdjustmentPreview(undefined, 8), false);
});

test("工具轮次耗尽时安全停止，不假装成功", async () => {
  const repeated = Array.from({ length: 5 }, (_, index) =>
    toolCall(`list-${index}`, "list_unscheduled_saved_places", {})
  );
  const result = await runTripPlanningAgent({
    apiKey: "eval-key",
    plan: planFixture(),
    userMessage: "帮我看看行程",
    history: [],
    activeDayIndex: 0,
    dependencies: {
      callModel: scriptedModel([
        toolCall("t1", "understand_trip_request", {
          goal: "answer",
          target_block_id: "",
          anchor_block_id: "",
          needs_candidate: false,
          summary: "查看行程",
        }),
        ...repeated,
      ]),
      listUnscheduledPlaces: () => [],
    } satisfies Partial<TripAgentDependencies>,
  });

  assert.equal(result.action, undefined);
  assert.match(result.reply, /工具调用上限/);
  assert.doesNotMatch(result.reply, /已新增|已删除|已更新|已安排/);
});

test("move准备动作进入最终结构化结果", async () => {
  const result = await runTripPlanningAgent({
    apiKey: "eval-key", plan: planFixture(), userMessage: "把博物馆移到晚餐后", history: [], activeDayIndex: 0,
    dependencies: { callModel: scriptedModel([
      toolCall("t1", "understand_trip_request", { goal: "move", target_block_id: "a-museum", anchor_block_id: "b-dinner", needs_candidate: false, summary: "移动活动" }),
      toolCall("t2", "prepare_activity_change", { action: "move", block_id: "a-museum", anchor_block_id: "b-dinner", search_query: "", extra_minutes: 0 }),
    ]) },
  });
  assert.equal(result.action, "move");
  assert.equal(result.blockId, "a-museum");
  assert.equal(result.anchorBlockId, "b-dinner");
});

test("extend撞到后续锁定活动时只返回结构化冲突", async () => {
  const plan = planFixture();
  const dinner = plan.dailyPlans[0].blocks.find((block) => block.id === "b-dinner");
  if (dinner?.type === "activity") dinner.startTime = "12:00";
  const trace = createTripAgentTrace({ plan, history: [], userMessage: "博物馆多逛八小时", activeDayIndex: 0, candidateContext: [] });
  const result = await runTripPlanningAgent({
    apiKey: "eval-key", plan, userMessage: "博物馆多逛八小时", history: [], activeDayIndex: 0, trace,
    dependencies: { callModel: scriptedModel([
      toolCall("t1", "understand_trip_request", { goal: "answer", target_block_id: "", anchor_block_id: "", needs_candidate: false, summary: "检查延长冲突" }),
      toolCall("t2", "prepare_activity_change", { action: "extend", block_id: "a-museum", anchor_block_id: "", search_query: "", extra_minutes: 480 }),
    ]) },
  });
  const observation = trace.spans.find((span) => span.name === "prepare_activity_change")?.output as Record<string, unknown>;
  assert.equal(observation.reasonCode, "locked-activity-conflict");
  assert.equal(observation.conflictWith, "b-dinner");
  assert.equal(result.action, undefined);
});

test("瞬时只读工具超时由产品控制流自动补试一次并分别留痕", async () => {
  let attempts = 0;
  const trace = createTripAgentTrace({ plan: planFixture(), history: [], userMessage: "晚餐后找公园", activeDayIndex: 0, candidateContext: [] });
  const result = await runTripPlanningAgent({
    apiKey: "eval-key", plan: planFixture(), userMessage: "晚餐后找公园", history: [], activeDayIndex: 0, trace,
    dependencies: {
      callModel: scriptedModel([
        toolCall("t1", "understand_trip_request", { goal: "add", target_block_id: "", anchor_block_id: "", needs_candidate: true, summary: "找公园" }),
        toolCall("t2", "recommend_nearby_after_activity", { day: 1, anchor_block_id: "b-dinner", keyword: "公园", visit_minutes: 60, radius_meters: 4000 }),
      ]),
      recommendNearby: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("tool-timeout");
        return [parkOption];
      },
    },
  });
  assert.equal(attempts, 2);
  assert.equal(result.options?.[0].id, "park-option");
  assert.equal(result.toolCalls.filter((name) => name === "recommend_nearby_after_activity").length, 2);
  const attemptsInTrace = trace.spans.filter((span) => span.name === "recommend_nearby_after_activity");
  assert.equal(attemptsInTrace.length, 2);
  assert.equal((attemptsInTrace[0].output as Record<string, unknown>).reasonCode, "transient-tool-error");
});

test("瞬时只读工具连续失败只尝试两次后安全停止", async () => {
  let attempts = 0;
  const result = await runTripPlanningAgent({
    apiKey: "eval-key", plan: planFixture(), userMessage: "晚餐后找公园", history: [], activeDayIndex: 0,
    dependencies: {
      callModel: scriptedModel([
        toolCall("t1", "understand_trip_request", { goal: "add", target_block_id: "", anchor_block_id: "", needs_candidate: true, summary: "找公园" }),
        toolCall("t2", "recommend_nearby_after_activity", { day: 1, anchor_block_id: "b-dinner", keyword: "公园", visit_minutes: 60, radius_meters: 4000 }),
      ]),
      recommendNearby: async () => {
        attempts += 1;
        throw new Error("tool-timeout");
      },
    },
  });
  assert.equal(attempts, 2);
  assert.equal(result.options, undefined);
  assert.match(result.reply, /没有找到|没有变化/);
});

test("多候选模糊指代在模型调用和事实查询前强制结构化澄清", async () => {
  let modelCalls = 0;
  const secondOption = { ...parkOption, id: "moon-option", name: "月湾公园", businessHours: "09:00-20:30" };
  const trace = createTripAgentTrace({ plan: planFixture(), history: [], userMessage: "它晚上八点还开吗？", activeDayIndex: 0, candidateContext: [parkOption, secondOption] });
  const result = await runTripPlanningAgent({
    apiKey: "eval-key", plan: planFixture(), userMessage: "它晚上八点还开吗？", history: [], activeDayIndex: 0,
    candidateContext: [parkOption, secondOption], trace,
    dependencies: { callModel: async () => { modelCalls += 1; return { role: "assistant", content: "不应调用" }; } },
  });
  assert.equal(modelCalls, 0);
  assert.equal(result.clarification?.reasonCode, "ambiguous-candidate-referent");
  assert.deepEqual(result.clarification?.candidateIds, ["park-option", "moon-option"]);
  assert.doesNotMatch(result.reply, /21:30|20:30/);
  assert.equal(trace.spans[0]?.name, "clarify_candidate_referent");
});

test("放弃候选返回清除信号但不产生写入动作", async () => {
  const result = await runTripPlanningAgent({
    apiKey: "eval-key", plan: planFixture(), userMessage: "候选都不要了", history: [], activeDayIndex: 0, candidateContext: [parkOption],
    dependencies: { callModel: scriptedModel([
      toolCall("t1", "understand_trip_request", { goal: "answer", target_block_id: "", anchor_block_id: "", needs_candidate: false, summary: "放弃候选" }),
      toolCall("t2", "discard_candidate_context", {}),
    ]) },
  });
  assert.equal(result.candidateContextAction, "clear");
  assert.equal(result.candidateIntentCount, 0);
  assert.equal(result.action, undefined);
});
