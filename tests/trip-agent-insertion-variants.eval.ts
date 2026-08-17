import assert from "node:assert/strict";
import test from "node:test";

import { findBestInsertionOptionsWithDiagnostics } from "../src/lib/trip-agent-tools";
import { createTripAgentTrace, runTripPlanningAgent } from "../src/lib/trip-agent-harness";
import type { RouteLeg, TripPlan } from "../src/lib/types";

function planFixture(returnDepartTime?: string): TripPlan {
  return {
    id: "insertion-variant-plan",
    revision: 9,
    destination: "澄江市",
    departureCity: "上海",
    days: 1,
    preferences: [],
    createdAt: "2026-08-13T00:00:00.000Z",
    returnTransport: returnDepartTime ? {
      mode: "train",
      serviceNumber: "D2099",
      departureTerminal: "澄江南站",
      arrivalTerminal: "上海虹桥站",
      departTime: returnDepartTime,
      arriveTime: "22:00",
      source: "user-confirmed",
      confirmedAt: "2026-08-13T00:00:00.000Z",
    } : undefined,
    dailyPlans: [{
      dayLabel: "Day 1",
      blocks: [{
        type: "activity",
        id: "anchor-library",
        startTime: "14:00",
        endTime: "15:30",
        title: "云桥书院",
        placeName: "云桥书院",
        matchedName: "云桥书院",
        category: "文化",
        cost: "0元",
        duration: "90分钟",
        durationMinutes: 90,
        tip: "",
        lng: 120.1,
        lat: 30.1,
      }],
    }],
  };
}

function leg(fromName: string, toName: string, durationMinutes: number): RouteLeg {
  return {
    fromName,
    toName,
    mode: "taxi",
    distanceMeters: durationMinutes * 500,
    durationMinutes,
    description: `固定路线 ${durationMinutes} 分钟`,
  };
}

const terminal = { id: "terminal-1", name: "澄江南站", address: "站前路", lng: 120.4, lat: 30.4 };
const place = {
  handle: "place-night-gallery",
  name: "星河摄影馆",
  matchedFrom: "星河摄影馆",
  lng: 120.2,
  lat: 30.2,
  businessHours: "09:00-16:30",
};

const fixedDependencies = {
  searchPlaces: async (query: string) => query.includes("站") ? [terminal] : [],
  buildLeg: async (from: { name: string }, to: { name: string }) =>
    leg(from.name, to.name, to.name.includes("站") ? 45 : 20),
};

function toolCall(id: string, name: string, args: Record<string, unknown>) {
  return {
    role: "assistant" as const,
    content: null,
    tool_calls: [{ id, type: "function" as const, function: { name, arguments: JSON.stringify(args) } }],
  };
}

function scriptedModel(messages: ReturnType<typeof toolCall>[]) {
  let index = 0;
  return async () => messages[index++] || { role: "assistant" as const, content: "当前行程不变。" };
}

test("Development变体A：到达时开放但完整参观跨过闭馆时间", async () => {
  const result = await findBestInsertionOptionsWithDiagnostics(
    planFixture(), place, 70, [1], fixedDependencies
  );

  assert.deepEqual(result.options, []);
  assert.equal(result.rejection?.reasonCode, "visit-crosses-closing");
  assert.equal(result.rejection?.facts.estimatedStartTime, "15:50");
  assert.equal(result.rejection?.facts.estimatedEndTime, "17:00");
});

test("Development变体A对照：闭馆延后时同一路线可以插入", async () => {
  const result = await findBestInsertionOptionsWithDiagnostics(
    planFixture(), { ...place, businessHours: "09:00-18:30" }, 70, [1], fixedDependencies
  );

  assert.equal(result.options.length, 1);
  assert.equal(result.rejection, undefined);
});

test("Development变体B：最后一天真实计算到站时间和60分钟火车缓冲", async () => {
  const result = await findBestInsertionOptionsWithDiagnostics(
    planFixture("18:00"), { ...place, businessHours: "09:00-22:00" }, 30, [1], fixedDependencies
  );

  assert.deepEqual(result.options, []);
  assert.equal(result.rejection?.reasonCode, "insufficient-return-buffer");
  assert.equal(result.rejection?.facts.latestReturnArrivalTime, "17:00");
  assert.equal(result.rejection?.facts.projectedReturnArrivalTime, "17:05");
});

test("Development变体B对照：车次延后时同一地点可以插入", async () => {
  const result = await findBestInsertionOptionsWithDiagnostics(
    planFixture("19:00"), { ...place, businessHours: "09:00-22:00" }, 30, [1], fixedDependencies
  );

  assert.equal(result.options.length, 1);
  assert.equal(result.options[0].projectedDayEndTime, "17:05");
});

test("Development变体C：真实闭馆拒绝原因进入Agent Trace", async () => {
  const plan = planFixture();
  const trace = createTripAgentTrace({ plan, history: [], userMessage: "把星河摄影馆排进今天", activeDayIndex: 0, candidateContext: [] });
  await runTripPlanningAgent({
    apiKey: "fixed-no-network",
    plan,
    userMessage: "把星河摄影馆排进今天",
    history: [],
    activeDayIndex: 0,
    trace,
    dependencies: {
      callModel: scriptedModel([
        toolCall("task", "understand_trip_request", { goal: "add", target_block_id: "", anchor_block_id: "", needs_candidate: true, summary: "安排摄影馆并检查完整参观时段" }),
        toolCall("resolve", "resolve_place", { query: "星河摄影馆", aliases: [] }),
        toolCall("slot", "find_best_insertion_slots", { place_handle: place.handle, visit_minutes: 70, allowed_days: [1] }),
      ]),
      resolvePlaces: async () => [place],
      findInsertionOptions: (inputPlan, inputPlace, minutes, days) =>
        findBestInsertionOptionsWithDiagnostics(inputPlan, inputPlace, minutes, days, fixedDependencies),
    },
  });
  const observation = trace.spans.find((span) => span.name === "find_best_insertion_slots")?.output as {
    rejection: { reasonCode: string };
  };
  assert.equal(observation.rejection.reasonCode, "visit-crosses-closing");
});

test("Development变体D：真实返程缓冲原因进入Agent Trace", async () => {
  const plan = planFixture("18:00");
  const trace = createTripAgentTrace({ plan, history: [], userMessage: "最后一天加星河摄影馆", activeDayIndex: 0, candidateContext: [] });
  await runTripPlanningAgent({
    apiKey: "fixed-no-network",
    plan,
    userMessage: "最后一天加星河摄影馆",
    history: [],
    activeDayIndex: 0,
    trace,
    dependencies: {
      callModel: scriptedModel([
        toolCall("task", "understand_trip_request", { goal: "add", target_block_id: "", anchor_block_id: "", needs_candidate: true, summary: "最后一天安排摄影馆并保留火车缓冲" }),
        toolCall("resolve", "resolve_place", { query: "星河摄影馆", aliases: [] }),
        toolCall("slot", "find_best_insertion_slots", { place_handle: place.handle, visit_minutes: 30, allowed_days: [1] }),
      ]),
      resolvePlaces: async () => [{ ...place, businessHours: "09:00-22:00" }],
      findInsertionOptions: (inputPlan, inputPlace, minutes, days) =>
        findBestInsertionOptionsWithDiagnostics(inputPlan, inputPlace, minutes, days, fixedDependencies),
    },
  });
  const observation = trace.spans.find((span) => span.name === "find_best_insertion_slots")?.output as {
    rejection: { reasonCode: string; facts: { latestReturnArrivalTime: string } };
  };
  assert.equal(observation.rejection.reasonCode, "insufficient-return-buffer");
  assert.equal(observation.rejection.facts.latestReturnArrivalTime, "17:00");
});
