import { fetchWithTimeout } from "./fetch-timeout";
import {
  analyzeAgentDay,
  checkAgentBusinessHours,
  compareAgentTransport,
  findBestInsertionOptions,
  findBestInsertionOptionsWithDiagnostics,
  listAgentUnscheduledPlaces,
  recommendNearbyInsertionOptions,
  recommendAfterRemovingActivity,
  proposeFlexibleActivity,
  RecommendationDiagnostic,
  ResolvedAgentPlace,
  resolveAgentPlaces,
} from "./trip-agent-tools";
import { ActivityOption, AdjustAction, AgentPlannedOperation, TripPlan } from "./types";

type AgentRole = "system" | "user" | "assistant" | "tool";
export type AgentMessage = {
  role: AgentRole;
  content: string | null;
  tool_call_id?: string;
  tool_calls?: AgentToolCall[];
};

export type AgentToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type TripAgentTokenUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

type DeepSeekMessage = AgentMessage & {
  reasoning_content?: string;
  usage?: TripAgentTokenUsage;
};

/** 仅在评测/受控 dogfood 中传入；生产请求默认不采集完整用户内容。 */
export type TripAgentTraceSpan = {
  spanId: string;
  parentSpanId: string;
  spanType: "model" | "tool";
  name: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  input: unknown;
  output: unknown;
  rejectionReason?: string;
  tokenUsage?: TripAgentTokenUsage;
};

export type TripAgentTrace = {
  schemaVersion: "1.0";
  startedAt: string;
  initial: {
    plan: TripPlan;
    history: { role: "user" | "assistant"; text: string }[];
    userMessage: string;
    activeDayIndex: number;
    candidateContext: ActivityOption[];
  };
  completeMessagesTranscript: AgentMessage[];
  spans: TripAgentTraceSpan[];
};

export function createTripAgentTrace(input: TripAgentTrace["initial"]): TripAgentTrace {
  return {
    schemaVersion: "1.0",
    startedAt: new Date().toISOString(),
    initial: structuredClone(input),
    completeMessagesTranscript: [],
    spans: [],
  };
}

/**
 * Agent 的模型与事实工具依赖。生产环境使用真实 DeepSeek/高德实现；评测
 * 注入固定脚本和 Mock 结果，从而复现同一条轨迹并判断是策略问题还是外部波动。
 */
export interface TripAgentDependencies {
  callModel: (
    apiKey: string,
    messages: AgentMessage[],
    signal?: AbortSignal
  ) => Promise<DeepSeekMessage>;
  resolvePlaces: typeof resolveAgentPlaces;
  findInsertionOptions: (
    ...args: Parameters<typeof findBestInsertionOptions>
  ) => Promise<
    | ActivityOption[]
    | {
        options: ActivityOption[];
        rejection?: { reasonCode: string; facts?: Record<string, unknown> };
      }
  >;
  recommendNearby: typeof recommendNearbyInsertionOptions;
  recommendAfterRemoving: typeof recommendAfterRemovingActivity;
  checkBusinessHours: typeof checkAgentBusinessHours;
  flexibleActivity: typeof proposeFlexibleActivity;
  analyzeDay: typeof analyzeAgentDay;
  compareTransport: typeof compareAgentTransport;
  listUnscheduledPlaces: typeof listAgentUnscheduledPlaces;
}

export interface TripAgentResult {
  reply: string;
  /** 产品控制流在模型调用前识别出的结构化澄清；不会向模型暴露歧义候选事实。 */
  clarification?: {
    reasonCode: "ambiguous-candidate-referent";
    candidateIds: string[];
    candidateNames: string[];
  };
  action?: AdjustAction;
  blockId?: string;
  anchorBlockId?: string;
  searchQuery?: string;
  extraMinutes?: number;
  options?: ActivityOption[];
  /** 多操作请求在候选确认前只作为提案保留，不能直接写入行程。 */
  plannedOperations?: AgentPlannedOperation[];
  /** 用户明确放弃当前候选时，通知应用层清除未确认候选卡。 */
  candidateContextAction?: "clear";
  candidateIntentCount?: number;
  /** 本轮实际调用过的工具名，仅用于用户可核对的审计与评测统计。 */
  toolCalls: string[];
  agentSteps: string[];
}

type InterpretedTripTask = {
  goal: "answer" | "add" | "replace" | "remove" | "move" | "remove-and-add";
  targetBlockId?: string;
  anchorBlockId?: string;
  needsCandidate: boolean;
  summary: string;
};

const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "understand_trip_request",
      description:
        "每轮必须最先调用。把用户自然语言理解为结构化行程任务；同一句既有删除又有推荐/新增/替代时 goal 必须是 remove-and-add，不能拆成纯删除。活动 id 只能来自当前行程快照。",
      parameters: {
        type: "object",
        properties: {
          goal: { type: "string", enum: ["answer", "add", "replace", "remove", "move", "remove-and-add"] },
          target_block_id: { type: "string", description: "要删除、替换或移动的既有活动 id；没有则传空字符串" },
          anchor_block_id: { type: "string", description: "明确的插入/移动锚点 id；由工具自行选择时传空字符串" },
          needs_candidate: { type: "boolean", description: "是否需要寻找地图候选或插入方案" },
          summary: { type: "string", description: "用一句话保留用户的完整目标和约束" },
        },
        required: ["goal", "target_block_id", "anchor_block_id", "needs_candidate", "summary"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "resolve_place",
      description:
        "把用户说的地点、俗称或别名核对为真实地图实体。模型可提供可能的正式名称作为 aliases，但返回结果只信任地图。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "用户原话中的地点名称或俗称" },
          aliases: {
            type: "array",
            description: "可能的正式名称或常见别名；不确定时可为空",
            items: { type: "string" },
          },
        },
        required: ["query", "aliases"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recommend_after_removing_activity",
      description:
        "用于“不要去某个已有活动，但希望在它腾出的时间或某个明确活动后推荐替代地点”的复合请求。它在临时移除目标的行程上查地图候选；若用户明确说“晚餐后”等锚点，必须传 anchor_block_id。返回候选前不会删除任何活动。",
      parameters: {
        type: "object",
        properties: {
          day: { type: "integer" },
          remove_block_id: { type: "string", description: "被替代/删除的既有活动 id" },
          anchor_block_id: { type: "string", description: "用户明确要求安排在某活动后时传真实活动 id；未指定时传空字符串" },
          keyword: { type: "string", description: "搜索类型，例如特色街区、公园、咖啡馆、旅游景点" },
          visit_minutes: { type: "integer", minimum: 30, maximum: 180 },
          radius_meters: { type: "integer", minimum: 1000, maximum: 8000 },
        },
        required: ["day", "remove_block_id", "anchor_block_id", "keyword", "visit_minutes", "radius_meters"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_best_insertion_slots",
      description:
        "在不删除、不替换且不改变既有活动相对顺序的前提下，跨天模拟把已核对地点插入行程，按新增交通时间排序。调用前必须先 resolve_place。",
      parameters: {
        type: "object",
        properties: {
          place_handle: { type: "string", description: "resolve_place 返回的地点 handle" },
          visit_minutes: {
            type: "integer",
            description: "预计停留分钟；用户没说时通常用 60",
            minimum: 30,
            maximum: 240,
          },
          allowed_days: {
            type: "array",
            description: "用户明确指定日期时填写，例如第三天为 [3]；未指定时传空数组以搜索全部日期",
            items: { type: "integer" },
          },
        },
        required: ["place_handle", "visit_minutes", "allowed_days"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recommend_nearby_after_activity",
      description:
        "用户没有指定具体地点，而是想在某个既有活动后去附近逛逛、散步、看夜景或找同类地点时使用。直接返回高德附近候选和插入方案。",
      parameters: {
        type: "object",
        properties: {
          day: { type: "integer", description: "目标日期，例如第三天为 3" },
          anchor_block_id: { type: "string", description: "用户说的餐后或活动后的真实活动 id" },
          keyword: {
            type: "string",
            description: "高德检索词，例如公园、特色街区、商场、咖啡馆、旅游景点",
          },
          visit_minutes: { type: "integer", minimum: 30, maximum: 180 },
          radius_meters: { type: "integer", minimum: 1000, maximum: 8000 },
        },
        required: ["day", "anchor_block_id", "keyword", "visit_minutes", "radius_meters"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_place_business_hours",
      description: "核对本次候选卡中某一个地点在指定时间是否开放。只接受候选卡 option_id；地图没有营业时间时必须返回 unknown，不能猜测。",
      parameters: {
        type: "object",
        properties: {
          option_id: { type: "string", description: "候选卡上的真实 option id" },
          at_time: { type: "string", description: "要核对的时间，HH:MM" },
        },
        required: ["option_id", "at_time"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "discard_candidate_context",
      description: "用户明确放弃当前全部待确认候选时调用。只清除未确认候选意图，不修改已保存行程。",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_flexible_activity",
      description: "用户明确表示只想在某区域散步、看夜景、不固化为一个景点时使用。生成可确认的自由活动方案，不虚构具体 POI。",
      parameters: {
        type: "object",
        properties: {
          day: { type: "integer" },
          anchor_block_id: { type: "string", description: "自由活动紧随其后的既有活动 id" },
          area: { type: "string", description: "真实区域描述，例如国家大剧院周边、长安街沿线" },
          visit_minutes: { type: "integer", minimum: 15, maximum: 180 },
        },
        required: ["day", "anchor_block_id", "area", "visit_minutes"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_day_schedule",
      description:
        "用确定性的行程时间数据分析某天是否紧凑、活动与交通各占多久、空档是否充裕。适合回答某天累不累、某景点时长是否合理等问题。",
      parameters: {
        type: "object",
        properties: {
          day: { type: "integer", description: "要分析的日期，例如第三天为 3" },
        },
        required: ["day"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_transport_between_activities",
      description:
        "调用地图比较两个既有活动之间的推荐交通方式、耗时、距离和可用替代方案。",
      parameters: {
        type: "object",
        properties: {
          from_block_id: { type: "string", description: "起点活动 id" },
          to_block_id: { type: "string", description: "终点活动 id" },
        },
        required: ["from_block_id", "to_block_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_unscheduled_saved_places",
      description:
        "列出用户确实保存但尚未纳入行程的地点。只读取保存清单和稳定地点身份，不允许模型补写地点。",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "prepare_activity_change",
      description:
        "为明确的删除、延长、替换或移动请求准备结构化动作。只验证目标活动和参数，不直接修改行程。",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["remove", "extend", "replace", "move"],
          },
          block_id: { type: "string", description: "活动列表中真实存在的目标 id" },
          anchor_block_id: {
            type: "string",
            description: "move 时排在其后的活动 id；其他动作传空字符串",
          },
          search_query: {
            type: "string",
            description: "replace 时用于找候选的用户要求；其他动作传空字符串",
          },
          extra_minutes: {
            type: "integer",
            description: "extend 时增加的分钟数；其他动作传 0",
            minimum: 0,
            maximum: 240,
          },
        },
        required: ["action", "block_id", "anchor_block_id", "search_query", "extra_minutes"],
        additionalProperties: false,
      },
    },
  },
] as const;

/** 仅供评测 runner 计算版本哈希；生产 Agent 仍使用同一份内部 schema。 */
export function getTripAgentToolSchemaForEvaluation() {
  return structuredClone(AGENT_TOOLS);
}

function activitySummary(plan: TripPlan) {
  return plan.dailyPlans
    .map((day, dayIndex) => {
      const rows = day.blocks
        .filter((block) => block.type === "activity")
        .map((block) =>
          `${block.startTime}-${block.endTime} | id=${block.id} | ${block.title} | ${block.placeName || ""}`
        );
      return `Day ${dayIndex + 1}\n${rows.join("\n") || "（无活动）"}`;
    })
    .join("\n\n");
}

function safeArguments(value: string) {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function callDeepSeek(
  apiKey: string,
  messages: AgentMessage[],
  signal?: AbortSignal
): Promise<DeepSeekMessage> {
  const model = process.env.DEEPSEEK_AGENT_MODEL || "deepseek-v4-flash";
  const response = await fetchWithTimeout(
    "https://api.deepseek.com/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 1200,
        thinking: { type: "disabled" },
        messages,
        tools: AGENT_TOOLS,
        tool_choice: "auto",
      }),
      signal,
    },
    30_000,
    "DeepSeek 行程 Agent"
  );
  if (!response.ok) {
    const body = await response.text();
    console.error("Trip agent DeepSeek error:", response.status, body);
    throw new Error(`行程 Agent 调用失败 (${response.status})。`);
  }
  const data = await response.json();
  const message = data.choices?.[0]?.message as DeepSeekMessage | undefined;
  if (!message) throw new Error("行程 Agent 没有返回有效结果。");
  message.usage = data.usage as TripAgentTokenUsage | undefined;
  return message;
}

const DEFAULT_AGENT_DEPENDENCIES: TripAgentDependencies = {
  callModel: callDeepSeek,
  resolvePlaces: resolveAgentPlaces,
  findInsertionOptions: findBestInsertionOptionsWithDiagnostics,
  recommendNearby: recommendNearbyInsertionOptions,
  recommendAfterRemoving: recommendAfterRemovingActivity,
  checkBusinessHours: checkAgentBusinessHours,
  flexibleActivity: proposeFlexibleActivity,
  analyzeDay: analyzeAgentDay,
  compareTransport: compareAgentTransport,
  listUnscheduledPlaces: listAgentUnscheduledPlaces,
};

function compactAgentReply(value: string) {
  const cleaned = String(value || "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*/g, "")
    .replace(/^\s*\|?[-:| ]+\|?\s*$/gm, "")
    .replace(/\s*\|\s*/g, " · ")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const paragraphs = cleaned
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4);
  const compact = paragraphs.join("\n");
  return compact.length > 480 ? `${compact.slice(0, 477).trimEnd()}…` : compact;
}

function ambiguousCandidateReferent(userMessage: string, candidateContext: ActivityOption[]) {
  if (candidateContext.length < 2) return false;
  const message = String(userMessage || "").trim();
  const explicitlyNamed = candidateContext.filter((option) =>
    [option.id, option.name].some((value) => value && message.includes(value))
  );
  if (explicitlyNamed.length === 1) return false;
  return /(?:它|这个|这家|那个|那家|该店|该地点|该公园)/.test(message);
}

function transientToolError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return false;
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /(?:timeout|timed out|超时|temporar|暂时|network|fetch failed|econnreset|etimedout|socket hang up|\b429\b|\b502\b|\b503\b|\b504\b)/i.test(message);
}

/**
 * 只读 Agent harness：模型可以多轮选择工具、观察结果并继续推理，但没有写工具。
 * 真正修改仍必须回到前端确认，再走 /api/adjust-plan 的事务校验。
 */
export async function runTripPlanningAgent({
  apiKey,
  plan,
  userMessage,
  history,
  activeDayIndex,
  candidateContext = [],
  signal,
  dependencies,
  trace,
}: {
  apiKey: string;
  plan: TripPlan;
  userMessage: string;
  history: { role: "user" | "assistant"; text: string }[];
  activeDayIndex: number;
  /** 上一轮候选卡的完整地图身份，用于“这个公园晚上开放吗”等指代。 */
  candidateContext?: ActivityOption[];
  signal?: AbortSignal;
  /** 仅供自动化评测注入可重复的模型/工具结果；页面不传此参数。 */
  dependencies?: Partial<TripAgentDependencies>;
  /** 仅供评测保存完整模型—工具—observation 轨迹；页面不传。 */
  trace?: TripAgentTrace;
}): Promise<TripAgentResult> {
  const deps: TripAgentDependencies = {
    ...DEFAULT_AGENT_DEPENDENCIES,
    ...dependencies,
  };
  const places = new Map<string, ResolvedAgentPlace>();
  let insertionOptions: ActivityOption[] = [];
  let task: InterpretedTripTask | null = null;
  const preparedActions: { action: AdjustAction; blockId: string; anchorBlockId?: string; searchQuery?: string; extraMinutes?: number }[] = [];
  let candidateContextCleared = false;
  let needsPlaceClarification = false;
  let lastInsertionRejection: { reasonCode: string; facts?: Record<string, unknown> } | undefined;
  const existingIds = new Set(
    plan.dailyPlans.flatMap((day) =>
      day.blocks.filter((block) => block.type === "activity").map((block) => block.id)
    )
  );
  const agentSteps: string[] = [];
  const agentToolCalls: string[] = [];
  const traceRootSpanId = "trip-agent-run";
  const recordTraceSpan = (
    spanType: TripAgentTraceSpan["spanType"],
    name: string,
    startedMs: number,
    input: unknown,
    output: unknown,
    tokenUsage?: TripAgentTokenUsage
  ) => {
    if (!trace) return;
    const endedMs = Date.now();
    const outputRecord = output as Record<string, unknown> | null;
    trace.spans.push({
      spanId: `${spanType}-${trace.spans.length + 1}`,
      parentSpanId: traceRootSpanId,
      spanType,
      name,
      startedAt: new Date(startedMs).toISOString(),
      endedAt: new Date(endedMs).toISOString(),
      durationMs: endedMs - startedMs,
      input: structuredClone(input),
      output: structuredClone(output),
      rejectionReason: outputRecord && typeof outputRecord.error === "string" ? outputRecord.error : undefined,
      tokenUsage,
    });
  };
  if (ambiguousCandidateReferent(userMessage, candidateContext)) {
    const clarification = {
      reasonCode: "ambiguous-candidate-referent" as const,
      candidateIds: candidateContext.map((option) => option.id),
      candidateNames: candidateContext.map((option) => option.name),
    };
    const startedMs = Date.now();
    recordTraceSpan(
      "tool",
      "clarify_candidate_referent",
      startedMs,
      { userMessage, candidateIds: clarification.candidateIds },
      clarification
    );
    if (trace) trace.completeMessagesTranscript = [];
    return {
      reply: `你指的是哪一个候选：${clarification.candidateNames.join("，")}？确认具体地点后我再核对，当前行程没有变化。`,
      clarification,
      toolCalls: [],
      agentSteps: ["候选指代不唯一：在模型和事实查询前请求用户澄清"],
    };
  }
  const runReadOnlyToolWithRetry = async <T>(
    toolName: string,
    args: Record<string, unknown>,
    action: () => Promise<T>
  ): Promise<T> => {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const attemptStartedMs = Date.now();
      try {
        return await action();
      } catch (error) {
        const retryable = transientToolError(error);
        if (!retryable || attempt === 2) throw error;
        const failureOutput = {
          error: error instanceof Error ? error.message : String(error),
          thrown: true,
          reasonCode: "transient-tool-error",
          retryable: true,
          attempt,
          maxAttempts: 2,
          nextAction: "automatic-retry",
        };
        recordTraceSpan("tool", toolName, attemptStartedMs, args, failureOutput);
        agentToolCalls.push(toolName);
        agentSteps.push(`${toolName} 第 ${attempt} 次出现瞬时错误，产品控制流自动补试一次`);
      }
    }
    throw new Error(`${toolName} retry loop exhausted`);
  };
  const recentHistory = history
    .slice(-10)
    .map((turn) => `${turn.role === "user" ? "用户" : "助手"}：${turn.text.slice(0, 500)}`)
    .join("\n");
  const messages: AgentMessage[] = [
    {
      role: "system",
      content: `你是一个有工具的专业行程规划 Agent，不是客服分类器。

你的工作规则：
0. 每轮第一步必须调用 understand_trip_request。它是对本轮自然语言的语义理解，不是写入操作；意思相近的不同表述应得到相同的 goal。
1. 回答当前行程相关问题时，以提供的行程快照为准。
2. 用户想新增具体地点、找顺路时间或表达地点俗称时，必须先调用 resolve_place，再调用 find_best_insertion_slots；不能凭常识声称地点已核对。
 2a. 用户没有说具体地点，只说某天某个活动后想在附近逛逛、散步、看夜景或找推荐时，直接调用 recommend_nearby_after_activity；不要调用 resolve_place 猜一个地点。
2a-1. 只有“没有指定具体地点、需要附近推荐”时才调用 recommend_nearby_after_activity。该工具只返回已从地图详情核到营业时间、且覆盖预计到达时刻的具体地点；没有候选时如实说明，不能把“未返回营业时间”当作可用方案。新增用户明确点名的地点仍必须按第 2 条先 resolve_place，再 find_best_insertion_slots。若用户只想散步/看夜景，可调用 propose_flexible_activity 提供不固化为 POI 的自由活动时段。
2a-2. 用户问“这个/这家/它晚上开放吗”时，先在“本轮候选卡上下文”中定位 option_id，再调用 check_place_business_hours。先直接回答核对结果；只有用户要求替代方案或该地点明确关闭时，才继续寻找替代。
2a-3. 用户明确说当前候选都不要了时，调用 discard_candidate_context；它只清除未确认候选，不修改行程。
2b. 用户明确删除、延长、替换或移动既有活动时，调用 prepare_activity_change；block_id 必须来自行程快照。
2b-2. extend 必须传用户要求增加的 extra_minutes；工具会用当前时间轴检查是否撞到后续锁定活动。出现冲突时只说明冲突并请用户选择，不得准备写入。
2b-1. 同一句既说“不想去/删除某活动”，又要找推荐、替代、顺路安排或填补空档：understand_trip_request 必须给 remove-and-add；再调用 recommend_after_removing_activity。它会在临时移除旧活动的行程上找候选；若用户明确“晚餐后/某活动后”，anchor_block_id 必须等于该真实活动 id，不能只调用删除准备工具后结束。
2c. 用户问某天是否紧凑或时长是否充裕，调用 analyze_day_schedule；问两个既有活动之间怎么走，调用 compare_transport_between_activities；问保存但未排入的地点，调用 list_unscheduled_saved_places。
3. 所有既有活动默认锁定。除非用户明确说删除或替换某个活动，否则不能建议删除、替换或改变既有活动相对顺序。
3a. remove-and-add 中，删除只作为候选确认时的前置操作，不能单独结束本轮。
4. 你只有只读分析工具，没有修改工具。不能说“已新增/已更新/已安排”。只能说明已找到可确认方案；用户确认方案卡后，应用层才会执行。
5. 如果用户没指定日期，find_best_insertion_slots 的 allowed_days 必须为空，让工具搜索所有天；不能擅自只看当前 Day。
6. 地图无结果或所有插入位置冲突时，如实说明缺少什么，不得编造。
7. 一轮内主动完成必要的工具调用，不要说“稍后查找”。
8. 普通文字回答最多 4 个短段落或 3 个要点，不输出 Markdown 表格，不复述完整行程，不使用 ##、** 或竖线表格。`,
    },
    {
      role: "user",
      content: `当前查看：Day ${activeDayIndex + 1}
当前行程（既有活动均默认锁定）：
${activitySummary(plan)}

本轮候选卡上下文（真实地图实体；指代“这个公园/这家店”只可引用这里的 option_id）：
${candidateContext.length ? candidateContext.map((option) => `option_id=${option.id} | ${option.name} | ${option.address || ""} | 营业时间=${option.businessHours || "未返回"} | 建议时段=${option.estimatedStartTime || ""}`).join("\n") : "（无）"}

近期对话：
${recentHistory || "（无）"}

本轮请求：${userMessage}`,
    },
  ];
  const syncTranscript = () => {
    if (trace) trace.completeMessagesTranscript = structuredClone(messages);
  };
  syncTranscript();

  for (let step = 0; step < 6; step += 1) {
    if (signal?.aborted) throw new DOMException("请求已取消", "AbortError");
    const modelStartedMs = Date.now();
    const modelInput = structuredClone(messages);
    const modelMessage = await deps.callModel(apiKey, messages, signal);
    recordTraceSpan("model", "chat.completions", modelStartedMs, modelInput, modelMessage, modelMessage.usage);
    messages.push(modelMessage);
    syncTranscript();
    const toolCalls = modelMessage.tool_calls || [];
    if (!toolCalls.length) {
      if (!task && step < 2) {
        messages.push({
          role: "system",
          content: "请先调用 understand_trip_request，完成本轮任务理解后再回答或调用其他工具。",
        });
        syncTranscript();
        continue;
      }
      const removeOperations = task?.goal === "remove-and-add" && task.targetBlockId
        ? [{ type: "remove" as const, dayIndex: plan.dailyPlans.findIndex((day) => day.blocks.some((block) => block.id === task?.targetBlockId)), blockId: task.targetBlockId }]
        : task?.goal === "remove"
          ? preparedActions
            .filter((item) => item.action === "remove")
            .map((item) => ({ type: "remove" as const, dayIndex: plan.dailyPlans.findIndex((day) => day.blocks.some((block) => block.id === item.blockId)), blockId: item.blockId }))
          : [];
      const needsCandidate = Boolean(task?.needsCandidate || task?.goal === "remove-and-add");
      if (needsCandidate && !insertionOptions.length && !needsPlaceClarification) {
        return {
          reply: lastInsertionRejection?.reasonCode
            ? `没有满足当前约束的可确认时段（${lastInsertionRejection.reasonCode}），当前行程没有变化。`
            : "我没有找到满足当前时间与路线约束的可确认候选，当前行程没有变化。你可以换一种活动类型、扩大范围或调整时长后再试。",
          toolCalls: agentToolCalls,
          agentSteps,
          candidateContextAction: candidateContextCleared ? "clear" : undefined,
          candidateIntentCount: candidateContextCleared ? 0 : undefined,
        };
      }
      const defaultReply = insertionOptions.length
        ? `已找到 ${insertionOptions.length} 个可行方案。请直接在下方选择；确认前不会修改行程。`
        : "我已根据当前行程完成分析。";
      const preparedAction = preparedActions.at(-1);
      return {
        reply: insertionOptions.length
          ? defaultReply
          : compactAgentReply(String(modelMessage.content || defaultReply)) || defaultReply,
        action: insertionOptions.length ? (task?.goal === "replace" ? "replace" : "add") : preparedAction?.action,
        blockId: insertionOptions.length && task?.goal === "replace" ? task.targetBlockId : insertionOptions[0]?.proposedAnchorBlockId || preparedAction?.blockId,
        anchorBlockId: preparedAction?.anchorBlockId,
        searchQuery: preparedAction?.searchQuery,
        extraMinutes: preparedAction?.extraMinutes,
        options: insertionOptions.length ? insertionOptions : undefined,
        plannedOperations: removeOperations,
        candidateContextAction: candidateContextCleared ? "clear" : undefined,
        candidateIntentCount: candidateContextCleared ? 0 : undefined,
        toolCalls: agentToolCalls,
        agentSteps,
      };
    }

    for (const call of toolCalls) {
      agentToolCalls.push(call.function.name);
      const args = safeArguments(call.function.arguments);
      const toolStartedMs = Date.now();
      let output: unknown;
      try {
      if (call.function.name === "understand_trip_request") {
        const goal = String(args.goal || "") as InterpretedTripTask["goal"];
        const targetBlockId = String(args.target_block_id || "") || undefined;
        const anchorBlockId = String(args.anchor_block_id || "") || undefined;
        const validGoals = new Set<InterpretedTripTask["goal"]>(["answer", "add", "replace", "remove", "move", "remove-and-add"]);
        if (
          !validGoals.has(goal) ||
          (targetBlockId && !existingIds.has(targetBlockId)) ||
          (anchorBlockId && !existingIds.has(anchorBlockId)) ||
          ((goal === "remove" || goal === "replace" || goal === "move" || goal === "remove-and-add") && !targetBlockId)
        ) {
          output = { error: "任务理解未能对应当前行程中的真实活动 id；请结合行程快照重新理解，不要猜测。" };
        } else {
          task = {
            goal,
            targetBlockId,
            anchorBlockId,
            needsCandidate: Boolean(args.needs_candidate) || goal === "add" || goal === "replace" || goal === "remove-and-add",
            summary: String(args.summary || "").slice(0, 240),
          };
          agentSteps.push(`理解本轮任务：${task.goal}${task.summary ? `（${task.summary}）` : ""}`);
          output = {
            accepted: true,
            task,
            instruction: task.goal === "remove-and-add"
              ? "下一步调用 recommend_after_removing_activity；不要返回或准备单独删除结果。"
              : "按任务选择必要的地图或行程分析工具；没有写入工具。",
          };
        }
      } else if (!task) {
        output = { error: "必须先调用 understand_trip_request，才能调用其他工具。" };
      } else if (call.function.name === "resolve_place") {
        const query = String(args.query || userMessage).trim();
        const aliases = Array.isArray(args.aliases)
          ? args.aliases.map(String).filter(Boolean).slice(0, 4)
          : [];
        const resolved = await runReadOnlyToolWithRetry(call.function.name, args, () =>
          deps.resolvePlaces(query, plan.destination, aliases)
        );
        resolved.forEach((place) => places.set(place.handle, place));
        needsPlaceClarification = resolved.length > 1;
        agentSteps.push(`地图核对地点：${query}${aliases.length ? `（候选别名：${aliases.join("、")}）` : ""}`);
        output = {
          query,
          candidates: resolved.map((place) => ({
            handle: place.handle,
            name: place.name,
            address: place.address,
            matchedFrom: place.matchedFrom,
          })),
          instruction: resolved.length
            ? "选择最符合用户目标的 handle，再调用 find_best_insertion_slots。"
            : "地图没有返回可核对实体；不得继续编造地点。",
        };
      } else if (call.function.name === "find_best_insertion_slots") {
        const handle = String(args.place_handle || "");
        const place = places.get(handle);
        if (!place) {
          output = { error: "未知 place_handle，请先调用 resolve_place。" };
        } else {
          const visitMinutes = Math.max(30, Math.min(240, Number(args.visit_minutes) || 60));
          const allowedDays = Array.isArray(args.allowed_days)
            ? args.allowed_days.map(Number).filter(Number.isFinite)
            : [];
          const insertionResult = await runReadOnlyToolWithRetry(call.function.name, args, () =>
            deps.findInsertionOptions(plan, place, visitMinutes, allowedDays)
          );
          insertionOptions = Array.isArray(insertionResult) ? insertionResult : insertionResult.options;
          lastInsertionRejection = Array.isArray(insertionResult) ? undefined : insertionResult.rejection;
          agentSteps.push(
            `跨天模拟插入“${place.name}”：${allowedDays.length ? `限定 Day ${allowedDays.join("、")}` : "比较全部日期"}`
          );
          output = {
            place: { name: place.name, address: place.address, matchedFrom: place.matchedFrom },
            feasibleSlots: insertionOptions.map((option) => ({
              day: (option.proposedDayIndex || 0) + 1,
              after: option.proposedAnchorTitle,
              estimatedStartTime: option.estimatedStartTime,
              estimatedEndTime: option.estimatedEndTime,
              addedTravelMinutes: option.estimatedAddedTravelMinutes,
              projectedDayEndTime: option.projectedDayEndTime,
            })),
            rejection: insertionOptions.length ? undefined : lastInsertionRejection,
            lockedActivitiesPreserved: true,
          };
        }
      } else if (call.function.name === "recommend_after_removing_activity") {
        const day = Number(args.day) || activeDayIndex + 1;
        const removeBlockId = String(args.remove_block_id || "");
        const anchorBlockId = String(args.anchor_block_id || "") || undefined;
        const keyword = String(args.keyword || "旅游景点").trim();
        const visitMinutes = Math.max(30, Math.min(180, Number(args.visit_minutes) || 60));
        const radiusMeters = Math.max(1000, Math.min(8000, Number(args.radius_meters) || 4000));
        if (
          task.goal !== "remove-and-add" ||
          task.targetBlockId !== removeBlockId ||
          (anchorBlockId && !existingIds.has(anchorBlockId))
        ) {
          output = { error: "该工具只可用于本轮已理解的 remove-and-add 任务，且 remove_block_id 必须等于任务目标。" };
        } else {
          const recommendationDiagnostics: RecommendationDiagnostic[] = [];
          insertionOptions = await runReadOnlyToolWithRetry(call.function.name, args, () =>
            deps.recommendAfterRemoving(
              plan,
              day,
              removeBlockId,
              keyword,
              visitMinutes,
              radiusMeters,
              anchorBlockId,
              trace ? (event) => recommendationDiagnostics.push(event) : undefined
            )
          );
          agentSteps.push(`临时移除 ${removeBlockId} 后搜索“${keyword}”：${insertionOptions.length} 个可行候选`);
          output = {
            feasibleOptions: insertionOptions.map((option) => ({
              name: option.name,
              address: option.address,
              after: option.proposedAnchorTitle,
              estimatedStartTime: option.estimatedStartTime,
              estimatedEndTime: option.estimatedEndTime,
              addedTravelMinutes: option.estimatedAddedTravelMinutes,
            })),
            recommendationDiagnostics: trace ? recommendationDiagnostics : undefined,
            instruction: insertionOptions.length
              ? "候选会由应用层显示为方案卡；确认一张卡后才同时删除旧活动并新增候选。"
              : "没有可行候选；本轮不得输出删除动作。",
          };
        }
      } else if (call.function.name === "recommend_nearby_after_activity") {
        const day = Number(args.day) || activeDayIndex + 1;
        const anchorBlockId = String(args.anchor_block_id || "");
        const keyword = String(args.keyword || "旅游景点").trim();
        const visitMinutes = Math.max(30, Math.min(180, Number(args.visit_minutes) || 60));
        const radiusMeters = Math.max(1000, Math.min(8000, Number(args.radius_meters) || 4000));
        const recommendationDiagnostics: RecommendationDiagnostic[] = [];
        insertionOptions = await runReadOnlyToolWithRetry(call.function.name, args, () =>
          deps.recommendNearby(
            plan,
            day,
            anchorBlockId,
            keyword,
            visitMinutes,
            radiusMeters,
            trace ? (event) => recommendationDiagnostics.push(event) : undefined
          )
        );
        agentSteps.push(`搜索 Day ${day} 锚点附近的“${keyword}”：${insertionOptions.length} 个可行候选`);
        output = {
          feasibleOptions: insertionOptions.map((option) => ({
            name: option.name,
            address: option.address,
            after: option.proposedAnchorTitle,
            estimatedStartTime: option.estimatedStartTime,
            estimatedEndTime: option.estimatedEndTime,
            addedTravelMinutes: option.estimatedAddedTravelMinutes,
          })),
          lockedActivitiesPreserved: true,
          recommendationDiagnostics: trace ? recommendationDiagnostics : undefined,
          instruction: insertionOptions.length
            ? "候选会由应用层显示为方案卡，不要在文字中逐项复述。"
            : "附近没有可行候选；如实说明并请用户调整类型、半径或时长。",
        };
      } else if (call.function.name === "check_place_business_hours") {
        const optionId = String(args.option_id || "");
        const option = candidateContext.find((item) => item.id === optionId);
        agentSteps.push(`核对候选营业时间：${optionId || "无有效候选"}`);
        output = option
          ? deps.checkBusinessHours(option, String(args.at_time || "").trim() || undefined)
          : { error: "候选卡中不存在该 option_id，不能对未核对地点猜测营业时间。" };
      } else if (call.function.name === "discard_candidate_context") {
        candidateContextCleared = true;
        insertionOptions = [];
        agentSteps.push(`清除 ${candidateContext.length} 个未确认候选；不修改已保存行程`);
        output = {
          cleared: true,
          candidateIntentCount: 0,
          clearedOptionIds: candidateContext.map((item) => item.id),
          planChanged: false,
        };
      } else if (call.function.name === "propose_flexible_activity") {
        const option = deps.flexibleActivity(
          plan,
          Number(args.day) || activeDayIndex + 1,
          String(args.anchor_block_id || ""),
          String(args.area || "附近").trim(),
          Math.max(15, Math.min(180, Number(args.visit_minutes) || 45))
        );
        insertionOptions = option ? [option] : [];
        agentSteps.push(`生成不虚构 POI 的自由活动方案：${String(args.area || "附近").trim()}`);
        output = option
          ? { option: { id: option.id, area: option.flexibleArea, after: option.proposedAnchorTitle, start: option.estimatedStartTime, end: option.estimatedEndTime }, instruction: "应用层会显示自由活动确认卡；不要把它描述为具体景点。" }
          : { error: "这个自由活动时段无法在不改变既有活动的前提下插入。" };
      } else if (call.function.name === "analyze_day_schedule") {
        const day = Number(args.day) || activeDayIndex + 1;
        const analysis = deps.analyzeDay(plan, day);
        agentSteps.push(`分析 Day ${day} 的活动、交通与空档`);
        output = analysis || { error: `不存在 Day ${day}` };
      } else if (call.function.name === "compare_transport_between_activities") {
        const fromBlockId = String(args.from_block_id || "");
        const toBlockId = String(args.to_block_id || "");
        const comparison = await runReadOnlyToolWithRetry(call.function.name, args, () =>
          deps.compareTransport(plan, fromBlockId, toBlockId)
        );
        agentSteps.push(`比较交通：${fromBlockId} → ${toBlockId}`);
        output = comparison || { error: "活动或坐标无效，无法比较交通。" };
      } else if (call.function.name === "list_unscheduled_saved_places") {
        const unscheduled = deps.listUnscheduledPlaces(plan);
        agentSteps.push(`核对未纳入行程的已保存地点：${unscheduled.length} 个`);
        output = { count: unscheduled.length, places: unscheduled };
      } else if (call.function.name === "prepare_activity_change") {
        const action = String(args.action || "") as AdjustAction;
        const blockId = String(args.block_id || "");
        const anchorBlockId = String(args.anchor_block_id || "") || undefined;
        const searchQuery = String(args.search_query || "").trim() || undefined;
        const extraMinutes = Math.max(0, Math.min(240, Number(args.extra_minutes) || 0));
        const validActions = new Set<AdjustAction>(["remove", "extend", "replace", "move"]);
        const existingIds = new Set(
          plan.dailyPlans.flatMap((day) =>
            day.blocks.filter((block) => block.type === "activity").map((block) => block.id)
          )
        );
        if (
          !validActions.has(action) ||
          !existingIds.has(blockId) ||
          (action === "extend" && extraMinutes <= 0) ||
          (action === "move" && (!anchorBlockId || !existingIds.has(anchorBlockId) || anchorBlockId === blockId))
        ) {
          output = { error: "动作参数无效；不能修改行程。" };
        } else {
          const day = plan.dailyPlans.find((item) => item.blocks.some((block) => block.id === blockId));
          const blockIndex = day?.blocks.findIndex((block) => block.id === blockId) ?? -1;
          const target = blockIndex >= 0 ? day?.blocks[blockIndex] : undefined;
          const nextActivity = day?.blocks.slice(blockIndex + 1).find((block) => block.type === "activity");
          const toMinutes = (value?: string) => {
            const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ""));
            return match ? Number(match[1]) * 60 + Number(match[2]) : null;
          };
          const currentEnd = target?.type === "activity" ? toMinutes(target.endTime) : null;
          const nextStart = nextActivity?.type === "activity" ? toMinutes(nextActivity.startTime) : null;
          if (action === "extend" && currentEnd !== null && nextStart !== null && currentEnd + extraMinutes > nextStart) {
            output = {
              prepared: false,
              action,
              blockId,
              extraMinutes,
              reasonCode: "locked-activity-conflict",
              conflictWith: nextActivity?.id,
              currentEnd: target?.type === "activity" ? target.endTime : undefined,
              requestedEndMinutes: currentEnd + extraMinutes,
              lockedNextStart: nextActivity?.type === "activity" ? nextActivity.startTime : undefined,
              instruction: "延长会与后续锁定活动冲突；当前行程不变，请用户选择是否缩短或调整其他安排。",
            };
          } else {
          preparedActions.push({ action, blockId, anchorBlockId, searchQuery, extraMinutes: action === "extend" ? extraMinutes : undefined });
          agentSteps.push(`准备${action}动作：${blockId}`);
          output = {
            prepared: true,
            action,
            blockId,
            anchorBlockId,
            searchQuery,
            extraMinutes: action === "extend" ? extraMinutes : undefined,
            instruction: "动作只完成参数校验；应用层收到后才执行并验证。",
          };
          }
        }
      } else {
        output = { error: `不支持的工具：${call.function.name}` };
      }
      } catch (error) {
        const failureOutput = {
          error: error instanceof Error ? error.message : String(error),
          thrown: true,
        };
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(failureOutput),
        });
        recordTraceSpan("tool", call.function.name, toolStartedMs, args, failureOutput);
        syncTranscript();
        continue;
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(output),
      });
      recordTraceSpan("tool", call.function.name, toolStartedMs, args, output);
      syncTranscript();
    }
  }

  const compositeRemove = task?.goal === "remove-and-add" && task.targetBlockId
    ? [{ type: "remove" as const, dayIndex: plan.dailyPlans.findIndex((day) => day.blocks.some((block) => block.id === task?.targetBlockId)), blockId: task.targetBlockId }]
    : [];
  return {
    reply: insertionOptions.length
      ? `已找到 ${insertionOptions.length} 个可行方案。请直接在下方选择；确认前不会修改行程。`
      : task?.needsCandidate || task?.goal === "remove-and-add"
        ? "本轮没有找到满足当前约束的可确认候选，当前行程没有变化。"
        : "Agent 已达到本轮工具调用上限，当前行程没有变化。请缩小问题范围后再试。",
    action: insertionOptions.length ? (task?.goal === "replace" ? "replace" : "add") : undefined,
    blockId: task?.goal === "replace" ? task.targetBlockId : insertionOptions[0]?.proposedAnchorBlockId,
    anchorBlockId: task?.anchorBlockId,
    searchQuery: undefined,
    options: insertionOptions.length ? insertionOptions : undefined,
    plannedOperations: compositeRemove,
    candidateContextAction: candidateContextCleared ? "clear" : undefined,
    candidateIntentCount: candidateContextCleared ? 0 : undefined,
    toolCalls: agentToolCalls,
    agentSteps,
  };
}
