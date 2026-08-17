import { AdjustAction } from "./types";

export type AssistantChatTurn = { role: "user" | "assistant"; text: string };

export type AssistantActivityRef = {
  day: number;
  id: string;
  title: string;
  place: string;
  category: string;
};

export type AgentIntent = {
  action: AdjustAction;
  blockId: string;
  searchQuery?: string;
  dayNumber: number;
  anchorLabel?: string;
};

export type AgentMoveIntent = {
  action: "move";
  blockId: string;
  anchorBlockId: string;
  dayNumber: number;
  anchorLabel: string;
  targetLabel: string;
};

export type AgentRemoveIntent = {
  action: "remove";
  blockId: string;
  dayNumber: number;
  targetLabel: string;
};

const CHINESE_DAY: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

const STATUS_QUESTION = /查好|查到|找到没|找到了吗|好了没|好了吗|结果呢|候选在哪|选项在哪/;

function parseDayNumber(text: string): number | undefined {
  const digit = text.match(/(?:第\s*(\d+)\s*天|day\s*(\d+))/i);
  if (digit) return Number(digit[1] || digit[2]);
  const chinese = text.match(/第\s*([一二两三四五六七八九十])\s*天/);
  return chinese ? CHINESE_DAY[chinese[1]] : undefined;
}

function mealAnchor(text: string): "早餐" | "午餐" | "晚餐" | undefined {
  if (/晚餐后|吃完晚饭|饭后|晚上/.test(text)) return "晚餐";
  if (/午餐后|吃完午饭|下午/.test(text)) return "午餐";
  if (/早餐后|吃完早饭|上午/.test(text)) return "早餐";
  return undefined;
}

function cleanQuery(value?: string): string | undefined {
  const query = String(value || "")
    .replace(/^(?:晚餐后|午餐后|早餐后|晚上|下午|上午)+/, "")
    .replace(/(?:一带|附近|周边)$/, "")
    .replace(/(?:散散步|散步|逛逛|走走|看看|夜骑|骑行|游览|参观|打卡)$/, "")
    .replace(/[啊呀呢吧啦]+$/, "")
    .trim();
  return query && query.length >= 2 && query.length <= 30 ? query : undefined;
}

function placeQuery(text: string): string | undefined {
  // “想在晚餐后在什刹海一带散步”包含两个“在”，只取紧邻动作的最后一个地点。
  const aroundMatches = [
    ...text.matchAll(/(?:在|去|到)([^在，。！？!?]{2,30}?)(?:一带|附近|周边)?(?:散散步|散步|逛逛|走走|看看|夜骑|骑行|游览|参观|打卡)/g),
  ];
  const around = cleanQuery(aroundMatches.at(-1)?.[1]);
  if (around) return around;

  const explicit = text.match(
    /(?:想去|新增|加入|安排去|换成|改成|替换为|替换成)[：:\s]*([^，。！？!?]+)/
  );
  const named = cleanQuery(explicit?.[1]?.replace(/^(?:一家|一个|去|吃|的)/, ""));
  if (named) return named;

  if (/特色街区/.test(text)) return "特色街区";
  if (/胡同/.test(text)) return "胡同";
  if (/咖啡/.test(text)) return "咖啡馆";
  if (/餐厅|饭店|吃饭/.test(text)) return "餐厅";
  if (/公园|散散步|散步|走走/.test(text)) return "公园";
  if (/商场|逛街|购物/.test(text)) return "商场";
  if (/博物馆|展览/.test(text)) return "博物馆";
  return undefined;
}

function isActionableCandidateRequest(text: string): boolean {
  return /想|新增|加入|安排|推荐|帮我|找|去|散步|逛|走走|看看|夜骑|骑行/.test(text);
}

function recoverTaskText(message: string, history: AssistantChatTurn[]): string {
  if (!STATUS_QUESTION.test(message)) return message;
  return (
    [...history]
      .reverse()
      .find(
        (turn) =>
          turn.role === "user" &&
          !STATUS_QUESTION.test(turn.text) &&
          isActionableCandidateRequest(turn.text)
      )?.text || message
  );
}

function activityMentionKey(value: string): string {
  return value
    .replace(/^(?:游览|参观|拍摄|夜观|早餐[：:]?|午餐[：:]?|晚餐[：:]?|用餐[：:]?)/, "")
    .replace(/[（）()·\s\-—_]/g, "")
    .toLowerCase();
}

/** 明确说出“取消/删除某地点”时直接落到已有活动，不再调用模型。 */
export function resolveDeterministicRemoveIntent(
  message: string,
  activeDayIndex: number,
  activities: AssistantActivityRef[]
): AgentRemoveIntent | null {
  if (!/(?:取消|删除|删掉|移除|不想去|不去了)/.test(message)) return null;
  const explicitDay = parseDayNumber(message);
  const normalizedMessage = activityMentionKey(message);
  const target = activities
    .filter((item) => !explicitDay || item.day === explicitDay)
    .filter((item) => {
      const place = activityMentionKey(item.place);
      const title = activityMentionKey(item.title);
      return (place.length >= 2 && normalizedMessage.includes(place)) ||
        (title.length >= 2 && normalizedMessage.includes(title));
    })
    .sort((a, b) => activityMentionKey(b.place).length - activityMentionKey(a.place).length)[0];
  if (!target) return null;
  return {
    action: "remove",
    blockId: target.id,
    dayNumber: explicitDay || target.day || activeDayIndex + 1,
    targetLabel: target.place,
  };
}

/**
 * 把“晚餐后去 X / 把 X 移到晚餐后”解析为真正的顺序修改。
 * 如果 X 已在行程里，就必须 move，不能再次 add，也不能只在回复里声称改好了。
 */
export function resolveDeterministicMoveIntent(
  message: string,
  activeDayIndex: number,
  activities: AssistantActivityRef[]
): AgentMoveIntent | null {
  const anchorLabel = mealAnchor(message);
  if (!anchorLabel) return null;
  if (!/(?:放在|移到|挪到|排在|调整|改到|之后|后面|吃完|去|逛|散步)/.test(message)) return null;

  const explicitDay = parseDayNumber(message);
  const normalizedMessage = activityMentionKey(message);
  const mentioned = activities
    .filter((item) => !explicitDay || item.day === explicitDay)
    .filter((item) => {
      const place = activityMentionKey(item.place);
      const title = activityMentionKey(item.title);
      return (place.length >= 2 && normalizedMessage.includes(place)) ||
        (title.length >= 2 && normalizedMessage.includes(title));
    })
    .sort((a, b) => activityMentionKey(b.place).length - activityMentionKey(a.place).length)[0];
  if (!mentioned) return null;

  const dayNumber = explicitDay || mentioned.day || activeDayIndex + 1;
  const anchor = activities.find(
    (item) => item.day === dayNumber && item.id !== mentioned.id && item.title.includes(anchorLabel)
  );
  if (!anchor) return null;
  return {
    action: "move",
    blockId: mentioned.id,
    anchorBlockId: anchor.id,
    dayNumber,
    anchorLabel,
    targetLabel: mentioned.place,
  };
}

/**
 * 把高频自然语言请求确定性地落到“哪一天、哪个锚点、查什么”。
 * DeepSeek 仍负责开放语义理解；这个执行层保证常见请求不会退化成“稍后再查”。
 */
export function resolveDeterministicAgentIntent(
  message: string,
  activeDayIndex: number,
  activities: AssistantActivityRef[],
  history: AssistantChatTurn[]
): AgentIntent | null {
  const taskText = recoverTaskText(message, history);
  if (!isActionableCandidateRequest(taskText)) return null;
  if (/(?:换|替换|改成|换成).*(?:早餐|午餐|晚餐)|(?:早餐|午餐|晚餐).*(?:换|替换|改成|换成)/.test(taskText)) {
    return null;
  }
  const searchQuery = placeQuery(taskText);
  if (!searchQuery) return null;
  const requestedDay = parseDayNumber(taskText) || activeDayIndex + 1;
  const availableDays = activities.map((item) => item.day);
  const dayNumber = availableDays.includes(requestedDay) ? requestedDay : activeDayIndex + 1;
  const dayItems = activities.filter((item) => item.day === dayNumber);
  const anchorLabel = mealAnchor(taskText);
  const anchor = anchorLabel
    ? [...dayItems].reverse().find((item) => item.title.includes(anchorLabel))
    : dayItems.at(-1);
  const fallbackAnchor = anchor || dayItems.at(-1);
  return fallbackAnchor
    ? {
        action: "add",
        blockId: fallbackAnchor.id,
        searchQuery,
        dayNumber,
        anchorLabel,
      }
    : null;
}
