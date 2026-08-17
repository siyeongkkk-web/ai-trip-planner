export interface ActivityBlock {
  type: "activity";
  id: string;
  startTime: string;
  endTime: string;
  title: string;
  category: string;
  /** 地图可定位的规范地点名。展示标题可以包含“早餐：”等语境，地点名不可以。 */
  placeName?: string;
  /** 高德实际匹配到的名称与坐标；由服务端补齐，不让模型编造。 */
  matchedName?: string;
  address?: string;
  lng?: number;
  lat?: number;
  cost: string;
  duration: string;
  durationMinutes?: number;
  costSource?: "amap-reference" | "confirmed-hotel" | "unverified";
  tip: string;
  highlights?: string[];
  /** 小红书清单中的点与系统补充的餐厅必须在行程中区分展示。 */
  origin?: "post" | "assistant-recommended";
  /** 对应用户保存清单中的稳定 id；避免用地图改名后的字符串做来源判断。 */
  sourcePOIId?: string;
  /** 用户在候选中明确确认的地点；重排时间和路线时不得改成另一家。 */
  userSelected?: boolean;
  /** 用户明确要求该活动排在另一活动之后；重建时间轴时必须保留这条顺序约束。 */
  placementAfterBlockId?: string;
  /** 非 POI 的自由活动：例如“国家大剧院周边 / 长安街沿线散步”。 */
  activityKind?: "poi" | "flexible";
  /** 自由活动的区域说明；不伪装成一个已核对的具体地图地点。 */
  flexibleArea?: string;
}

export interface TransportBlock {
  type: "transport";
  id: string;
  mode: "walking" | "subway" | "bus" | "taxi" | "train";
  duration: string;
  cost: string;
  description: string;
  fromPlace?: string;
  toPlace?: string;
  fromLng?: number;
  fromLat?: number;
  toLng?: number;
  toLat?: number;
  routeSource?: "amap" | "unverified";
  estimatedCostHigh?: number;
  alternatives?: TransportAlternative[];
}

export interface TransportAlternative {
  mode: "subway" | "taxi";
  durationMinutes: number;
  distanceMeters: number;
  description: string;
  /** 公交地铁为高德返回参考价；打车为按距离给出的透明粗估。 */
  estimatedCost?: number;
  estimatedCostHigh?: number;
  fromLng?: number;
  fromLat?: number;
  toLng?: number;
  toLat?: number;
}

export type Block = ActivityBlock | TransportBlock;

export interface DayPlan {
  dayLabel: string;
  blocks: Block[];
  dailyBudget?: string;
}

export interface TripPlan {
  id: string;
  /** 每次成功的行程调整递增；客户端用它拒绝过期响应覆盖新结果。 */
  revision?: number;
  destination: string;
  departureCity: string;
  days: number;
  preferences: string[];
  hotelPreferences?: HotelPreference[];
  foodPreferences?: FoodPreference[];
  breakfastHabit?: BreakfastHabit;
  planningStrategy?: PlanningStrategy;
  publicTransportTaxiThreshold?: number;
  /** 用户确认采用的市内交通方式；确认后才据此重排后续时间。 */
  transportModeOverrides?: Record<string, "subway" | "taxi">;
  excludedRestaurantNames?: string[];
  excludedCuisineKeys?: string[];
  /** 从小红书清单进入时，日程只能使用这些已确认地点；不保存帖子正文。 */
  sourcePOICollectionId?: string;
  sourcePOIs?: SourcePOI[];
  createdAt: string;
  startDate?: string;
  endDate?: string;
  outboundEarliestTime?: string;
  returnEarliestTime?: string;
  travelers?: number;
  outboundTransport?: ConfirmedTransport;
  returnTransport?: ConfirmedTransport;
  transportPricing?: TransportPricing;
  selectedHotel?: ConfirmedHotel;
  status?: "draft" | "generated";
  engineVersion?: number;
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
  hotelPreferences?: HotelPreference[];
  foodPreferences?: FoodPreference[];
  breakfastHabit?: BreakfastHabit;
  planningStrategy?: PlanningStrategy;
  publicTransportTaxiThreshold: number;
  startDate: string;
  endDate: string;
  outboundEarliestTime?: string;
  returnEarliestTime?: string;
  travelers: number;
  outboundTransport?: ConfirmedTransport;
  returnTransport?: ConfirmedTransport;
  selectedHotel?: ConfirmedHotel;
  sourcePOICollectionId?: string;
  sourcePOIs?: SourcePOI[];
  /** 兼容旧数据；新表单不再使用“几点到达”。 */
  arrivalTime?: string;
  departureTime?: string;
}

/** 方案编排 Agent 的可确认策略；不是对地点、交通或酒店事实的改写。 */
export type PlanningStrategy = "coverage" | "low-commute" | "relaxed";

export type LongDistanceMode = "train" | "flight";

export type HotelPreference =
  | "卫生优先"
  | "安全优先"
  | "舒适"
  | "经济"
  | "高端"
  | "安静"
  | "交通便利"
  | "连锁"
  | "特色";

export type FoodPreference =
  | "当地本土菜"
  | "老字号/名店"
  | "稀有特色餐厅"
  | "北方口味"
  | "南方口味"
  | "西南口味"
  | "西北口味"
  | "东北口味"
  | "国外风味";

export type BreakfastHabit = "每天吃" | "偶尔吃" | "不吃";

export interface ConfirmedTransport {
  mode: LongDistanceMode;
  serviceNumber: string;
  departureTerminal: string;
  arrivalTerminal: string;
  departTime: string;
  arriveTime: string;
  /** 兼容旧数据。往返总价模式下，单段价格可以留空。 */
  pricePerPerson?: number;
  source: "user-confirmed";
  confirmedAt: string;
}

export type TransportPricing =
  | {
      kind: "per-leg";
      outboundPricePerPerson: number;
      returnPricePerPerson: number;
    }
  | {
      kind: "round-trip-total";
      totalPricePerPerson: number;
    };

export interface ConfirmedHotel {
  name: string;
  address?: string;
  totalPrice: number;
  ctripUrl?: string;
  source: "user-confirmed";
  confirmedAt: string;
}

export interface HotelCandidate {
  id: string;
  name: string;
  address?: string;
  lng: number;
  lat: number;
  group: "arrival" | "preference";
  reason: string;
  anchorName: string;
  preferenceNotes?: string[];
  /** 已由系统核对到同名携程详情页时才提供直达链接。 */
  ctripUrl?: string;
}

export type AdjustAction = "remove" | "extend" | "replace" | "add" | "move";

export interface ActivityOption {
  id: string;
  name: string;
  address?: string;
  category?: string;
  note?: string;
  lng: number;
  lat: number;
  origin: "post" | "assistant-recommended";
  sourcePOIId?: string;
  costPerPerson?: number;
  /** Agent 只读模拟得到的建议插入位置；用户确认前不会写入行程。 */
  proposedDayIndex?: number;
  proposedAnchorBlockId?: string;
  proposedAnchorTitle?: string;
  estimatedStartTime?: string;
  estimatedEndTime?: string;
  estimatedAddedTravelMinutes?: number;
  projectedDayEndTime?: string;
  agentReason?: string;
  /** 地图返回的营业时间文本；缺失时必须展示为未核对，而不是推断为开放。 */
  businessHours?: string;
  openingStatus?: "open" | "closed" | "unknown";
  /** 不是具体 POI 的自由活动方案。 */
  activityKind?: "poi" | "flexible";
  flexibleArea?: string;
  /** 用户确认本候选时，需要一并完成的前置操作，例如“删除旧活动＋新增推荐”。 */
  preRemoveBlockIds?: string[];
  /** 候选生成时的行程版本；确认时若版本已变化，必须放弃旧预览。 */
  previewBaseRevision?: number;
}

/** Agent 生成的待确认计划可以包含多项操作；页面确认前不会写入行程。 */
export type AgentPlannedOperation =
  | { type: "remove"; dayIndex: number; blockId: string }
  | { type: "add"; dayIndex: number; anchorBlockId: string };

export interface AdjustRequest {
  plan: TripPlan;
  dayIndex: number;
  blockId: string;
  action: AdjustAction;
  extraMinutes?: number;
  option?: ActivityOption;
  /** move 动作的目标锚点。目标活动必须排在这个活动之后。 */
  anchorBlockId?: string;
  /** 与本次新增同时原子执行的删除操作。失败时整份修改回滚。 */
  preRemoveBlockIds?: string[];
}

export type AdjustResultStatus = "applied" | "rejected";

export type AdjustReasonCode =
  | "schedule-conflict"
  | "target-not-found"
  | "anchor-not-found"
  | "identity-changed"
  | "result-mismatch"
  | "stale-plan"
  | "invalid-request"
  | "request-cancelled"
  | "network-error";

/**
 * 行程调整的可核对回执。界面只能依据这份回执宣称成功，不能再用
 * “整份 dailyPlans 有任意变化”代替目标操作是否真正生效。
 */
export interface AdjustOperationResult {
  operationId: string;
  status: AdjustResultStatus;
  action: AdjustAction;
  dayIndex: number;
  targetBlockId: string;
  anchorBlockId?: string;
  appliedBlockId?: string;
  changedBlockIds: string[];
  unchangedBlockIds: string[];
  message: string;
  reasonCode?: AdjustReasonCode;
  resolutionOptions?: string[];
  baseRevision: number;
  nextRevision: number;
}

export interface AdjustResponse {
  plan?: TripPlan;
  operationResult: AdjustOperationResult;
}

/**
 * 行程质检 Agent 的只读输出。它只能提出待处理项，不能在生成报告时改写行程。
 * 真正的新增、替换和删除仍必须走 adjust-plan 的确认与事务校验。
 */
export type PlanHealthIssueAction = "open-day" | "open-saved-places" | "open-assistant";

export interface PlanHealthIssue {
  id: string;
  severity: "attention" | "risk";
  title: string;
  detail: string;
  dayIndex?: number;
  action: PlanHealthIssueAction;
  actionLabel: string;
  /** 仅用于预填已有行程 Agent；用户发送前不会发起地图查询或修改行程。 */
  suggestedPrompt?: string;
}

export interface PlanHealthReport {
  status: "ready" | "needs-attention";
  summary: string;
  checkedAt: string;
  issues: PlanHealthIssue[];
}

/** 出行前/中数据检查的只读输出；不以天气或区域路况直接改写行程。 */
export interface TravelUpdateIssue {
  id: string;
  severity: "attention" | "risk";
  title: string;
  detail: string;
  dayIndex?: number;
  actionLabel: string;
  /** 只预填行程助手，用户发送并确认后才可能调整行程。 */
  suggestedPrompt: string;
}

export interface TravelUpdateReport {
  status: "clear" | "needs-attention" | "unavailable";
  summary: string;
  checkedAt: string;
  weatherSource: "checked" | "unavailable";
  trafficSource: "checked" | "unavailable";
  issues: TravelUpdateIssue[];
}

/** 规划前准备度 Agent 的只读检查结果。 */
export interface PlanningReadinessItem {
  id: string;
  status: "ready" | "attention" | "blocked";
  title: string;
  detail: string;
}

export interface PlanningReadinessReport {
  canStart: boolean;
  summary: string;
  items: PlanningReadinessItem[];
}

// ===== 新架构：输入层（识别 + 选择）=====

export interface POICandidate {
  id: string;
  /** 用户确认或编辑后的地点名。模型抽取时必须是帖子中的原文。 */
  name: string;
  /** 帖子中能直接核对到的原文片段；手动新增没有这项。 */
  evidence?: string;
  aliasInPost?: string; // 兼容旧数据：帖子里原本的叫法（网红名/简称）
  category?: string; // 类型：景点 / 美食 / 咖啡 / 拍照点 / 购物 ...
  note?: string; // 兼容旧数据：帖子里提到的一句话亮点或原因
  selected: boolean; // 用户是否勾选要去
  manual?: boolean; // 是否用户手动新增（AI 漏掉的兜底）
  /** 由地图核对得到，不能由模型生成。编辑 name 后必须清空重新核对。 */
  mapVerification?: POIMapVerification;
}

export interface POIMapVerification {
  status: "matched" | "not-found";
  query: string;
  matchedName?: string;
  address?: string;
  poiId?: string;
  lng?: number;
  lat?: number;
  verifiedAt: string;
}

export interface POICollection {
  id: string;
  createdAt: string;
  city?: string; // AI 猜的城市，可空
  sourceUrl?: string; // 小红书链接（可选，仅作记录）
  rawText: string; // 用户粘贴的帖子正文
  candidates: POICandidate[];
}

/** 用户已经在提取页选择并地图核对过的地点，不含帖子原文。 */
export interface SourcePOI {
  id: string;
  /** 用户在提取页亲自勾选/编辑后看到的名称，是帖子清单的唯一展示名称。 */
  name: string;
  /** 地图只负责实体核对与坐标，不得覆盖用户保存的名称。 */
  matchedName?: string;
  address?: string;
  mapPOIId?: string;
  lng?: number;
  lat?: number;
  category?: string;
  note?: string;
  /** 仅当该片段确实出现在保存的帖子原文中，才可标为来自帖子。 */
  evidence?: string;
  manual?: boolean;
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
  /** 仅在地图明确返回票价时填写。 */
  estimatedCost?: number;
  estimatedCostHigh?: number;
  /** 交通枢纽可能需要从 POI 中心点吸附到真实乘车站点。 */
  fromLng?: number;
  fromLat?: number;
  toLng?: number;
  toLat?: number;
  alternatives?: TransportAlternative[];
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
