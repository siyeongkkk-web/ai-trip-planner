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

// ===== 新架构：输入层（识别 + 选择）=====

export interface POICandidate {
  id: string;
  name: string; // 规范化后、便于在地图搜索的景点名
  aliasInPost?: string; // 帖子里原本的叫法（网红名/简称/描述性指代）
  category?: string; // 类型：景点 / 美食 / 咖啡 / 拍照点 / 购物 ...
  note?: string; // 帖子里提到的一句话亮点或原因
  selected: boolean; // 用户是否勾选要去
  manual?: boolean; // 是否用户手动新增（AI 漏掉的兜底）
}

export interface POICollection {
  id: string;
  createdAt: string;
  city?: string; // AI 猜的城市，可空
  sourceUrl?: string; // 小红书链接（可选，仅作记录）
  rawText: string; // 用户粘贴的帖子正文
  candidates: POICandidate[];
}

export interface ExtractInput {
  text: string;
  url?: string;
}

// ===== 新架构 · 规划层：地理编码 + 聚类 + 路线 =====

export interface GeoPOI {
  id: string;
  name: string; // 用户/AI 给的名字
  matchedName: string; // 高德实际匹配到的 POI 名（用于核对实体链接是否对）
  lng: number;
  lat: number;
  address?: string;
  category?: string;
  note?: string;
}

export type TransitMode = "walking" | "transit" | "taxi";

export interface RouteLeg {
  fromName: string;
  toName: string;
  mode: TransitMode;
  distanceMeters: number;
  durationMinutes: number;
  description: string; // 人话，如"地铁/公交约32分钟（含步行600米）"
}

export interface RoutedDay {
  dayLabel: string;
  stops: GeoPOI[];
  legs: RouteLeg[]; // legs[i] = stops[i] → stops[i+1]
  hotelToFirst?: RouteLeg; // 酒店 → 当天第一个景点
  lastToHotel?: RouteLeg; // 当天最后一个景点 → 酒店
}

export interface RoutedPlan {
  id: string;
  createdAt: string;
  city: string;
  days: number;
  hotelName?: string;
  routedDays: RoutedDay[];
  failedPOIs: string[]; // 没能在地图上定位到的点（实体链接失败）
}

export type HotelPref = "地铁近" | "公交近" | "景点近" | "闹中取静";

export type Pace = "赶" | "适中" | "悠闲";

export interface PlanRouteInput {
  city: string;
  days: number;
  hotelName?: string;
  hotelTier?: HotelTier; // 仅用于预算估算的消费档次
  hotelPrefs?: HotelPref[]; // 住宿位置偏好（多选，用于推荐排序）
  mustInclude?: string[]; // 用户标记"非去不可"的景点 id（从被删清单里置换回来）
  pace?: Pace; // 游玩节奏：缩放每个景点的滞留时间
  lunchTime?: string; // 自定义午餐时间，如 "12:00"
  dinnerTime?: string; // 自定义晚餐时间，如 "18:30"
  pois: { id: string; name: string; category?: string; note?: string }[];
}

// ===== 新架构 · 增值层：时间轴 + 正餐 + 酒店推荐 + 预算 =====

export type HotelTier = "经济" | "舒适" | "豪华";

export type ScheduledKind = "poi" | "meal";

export interface ScheduledStop {
  kind: ScheduledKind;
  name: string;
  matchedName?: string;
  category?: string; // poi 的类型；meal 固定为"午餐"/"晚餐"
  note?: string;
  address?: string;
  arrive: string; // "09:30"
  depart: string; // "11:00"
  durationMin: number;
  costEstimate: number; // 单人，元
  legIn?: RouteLeg; // 到达本点前的交通段（从上一点或酒店）
}

export interface ScheduledDay {
  dayLabel: string;
  items: ScheduledStop[]; // poi 和 meal 按时间顺序混排
  hotelToFirst?: RouteLeg;
  lastToHotel?: RouteLeg;
  dayCostEstimate: number; // 单人当天花费（不含住宿）
}

export interface HotelExample {
  name: string;
  address?: string;
  tags: string[]; // 命中的偏好标注，如"地铁约300米"、"近景点"
}

export interface HotelRec {
  area: string; // 推荐区域（来自 regeo）
  prefs: HotelPref[]; // 用户选的偏好
  reason: string;
  examples: HotelExample[]; // 高德搜到的真实酒店 + 命中标注
}

// 对话式调整：自然语言 → 结构化新参数（LLM 只做理解，不排路线）
export interface AdjustChatInput {
  city: string;
  days: number;
  hotelTier: HotelTier;
  hotelPrefs: HotelPref[];
  inPlan: string[]; // 当前行程里的景点名
  dropped: string[]; // 当前被删的景点名
  message: string;
}

export interface AdjustChatResult {
  days: number;
  hotelTier: HotelTier;
  hotelPrefs: HotelPref[];
  include: string[]; // 要确保安排的景点名（从被删里置换回来 / 新强调）
  exclude: string[]; // 要彻底去掉的景点名
  reply: string; // 给用户的一句话回应
}

export interface DroppedPOI {
  id: string;
  name: string;
  category?: string;
  reason: string; // 为什么没排进去
  swappable: boolean; // true=景点，可勾"非去不可"置换；false=多余的餐厅等，仅展示
}

export interface BudgetItem {
  label: string;
  amount: number;
}

export interface EnrichedPlan {
  id: string;
  createdAt: string;
  city: string;
  days: number;
  hotelName?: string;
  scheduledDays: ScheduledDay[];
  hotelRec?: HotelRec;
  budget: { perPerson: number; breakdown: BudgetItem[] };
  failedPOIs: string[];
  droppedPOIs: DroppedPOI[]; // 时间装不下、被自动删除的景点（供用户置换）
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
