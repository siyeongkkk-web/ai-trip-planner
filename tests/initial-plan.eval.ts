import assert from "node:assert/strict";
import test from "node:test";
import { buildGeneratePrompt } from "../src/lib/prompts";
import { TripInput } from "../src/lib/types";

const baseInput: TripInput = {
  destination: "北京",
  departureCity: "上海",
  days: 3,
  preferences: ["历史文化", "少走回头路"],
  publicTransportTaxiThreshold: 60,
  startDate: "2026-09-01",
  endDate: "2026-09-03",
  travelers: 2,
  outboundTransport: {
    mode: "train",
    serviceNumber: "G1",
    departureTerminal: "上海虹桥站",
    arrivalTerminal: "北京南站",
    departTime: "07:00",
    arriveTime: "11:36",
    source: "user-confirmed",
    confirmedAt: "2026-08-12T00:00:00.000Z",
  },
  returnTransport: {
    mode: "train",
    serviceNumber: "G2",
    departureTerminal: "北京南站",
    arrivalTerminal: "上海虹桥站",
    departTime: "18:00",
    arriveTime: "22:30",
    source: "user-confirmed",
    confirmedAt: "2026-08-12T00:00:00.000Z",
  },
  selectedHotel: {
    name: "测试酒店",
    totalPrice: 1200,
    source: "user-confirmed",
    confirmedAt: "2026-08-12T00:00:00.000Z",
  },
};

test("未指定规划策略时使用综合规划，不默认为轻松优先", () => {
  const prompt = buildGeneratePrompt(baseInput);

  assert.match(prompt, /综合规划要求/);
  assert.match(prompt, /以用户已填写的旅行偏好为主要决策依据/);
  assert.doesNotMatch(prompt, /方案倾向：轻松优先/);
});

test("旧行程显式指定的策略仍保持兼容", () => {
  const prompt = buildGeneratePrompt({ ...baseInput, planningStrategy: "relaxed" });

  assert.match(prompt, /方案倾向：轻松优先/);
  assert.doesNotMatch(prompt, /综合规划要求/);
});
