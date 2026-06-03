export interface ActivityBlock {
  type: "activity";
  id: string;
  startTime: string;
  endTime: string;
  title: string;
  category: string;
  cost: string;
  duration: string;
  tip: string;
}

export interface TransportBlock {
  type: "transport";
  id: string;
  mode: "walking" | "subway" | "bus" | "taxi" | "train";
  duration: string;
  cost: string;
  description: string;
}

export type Block = ActivityBlock | TransportBlock;

export interface DayPlan {
  dayLabel: string;
  blocks: Block[];
}

export interface TripPlan {
  id: string;
  destination: string;
  days: number;
  preferences: string[];
  createdAt: string;
  dailyPlans: DayPlan[];
}

export interface TripInput {
  destination: string;
  days: number;
  preferences: string[];
}

export type AdjustAction = "remove" | "extend" | "replace";

export interface AdjustRequest {
  plan: TripPlan;
  dayIndex: number;
  blockId: string;
  action: AdjustAction;
  extraMinutes?: number;
}

export const PREFERENCE_OPTIONS = [
  { label: "美食", emoji: "🍜" },
  { label: "文化古迹", emoji: "🏛" },
  { label: "自然风光", emoji: "🌿" },
  { label: "购物", emoji: "🛍" },
  { label: "亲子", emoji: "👨‍👩‍👧" },
  { label: "摄影打卡", emoji: "📸" },
  { label: "慢节奏", emoji: "☕" },
] as const;

export const DAY_OPTIONS = [1, 3, 5, 7] as const;
