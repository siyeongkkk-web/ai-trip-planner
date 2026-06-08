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
  highlights?: string[];
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
  dailyBudget?: string;
}

export interface TripPlan {
  id: string;
  destination: string;
  departureCity: string;
  days: number;
  preferences: string[];
  createdAt: string;
  dailyPlans: DayPlan[];
  hotel?: HotelRecommendation;
  totalBudget?: string;
  transportAdvice?: string;
}

export interface HotelRecommendation {
  area: string;
  reason: string;
  budgetRange: string;
  examples: string[];
}

export interface TripInput {
  destination: string;
  departureCity: string;
  days: number;
  preferences: string[];
  arrivalTime?: string;
  departureTime?: string;
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
