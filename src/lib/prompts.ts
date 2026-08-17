import {
  TripInput,
  AdjustRequest,
  Block,
  TripPlan,
  ExtractInput,
  AdjustChatInput,
} from "./types";

// ===== 新架构 · 对话调整：把用户的自然语言反馈翻译成结构化新参数 =====
export const ADJUST_CHAT_SYSTEM_PROMPT = `你是行程调整助手。用户会用自然语言对当前行程提调整建议，你的任务是把它转换成"结构化的新规划参数"。

重要：你**不负责**排路线、算时间、定交通（那些由地图 API 和算法完成）。你只输出调整后的参数 + 一句友好回应。

可调整的维度：
- days：旅行天数（用户说"多玩一天/改成5天"时改）
- hotelTier：住宿档次，只能是 经济 / 舒适 / 豪华
- hotelPrefs：住宿位置偏好，从 [地铁近, 公交近, 景点近, 闹中取静] 里选（可多选）
- include：用户明确想去/强调要保留的景点名（从被删名单里捞回来，或强调别删）
- exclude：用户明确不想去、要删掉的景点名

规则：
- 没提到的维度，原样保留当前值，不要乱改。
- include / exclude 里的名字必须来自下面给出的景点列表，用原名。
- reply 用中文，简短确认你做了什么改动。
只输出 JSON。`;

export function buildAdjustChatPrompt(input: AdjustChatInput): string {
  return `当前设置：
- 城市：${input.city}
- 天数：${input.days}
- 住宿档次：${input.hotelTier}
- 住宿偏好：${input.hotelPrefs.join("、") || "无"}
- 行程里的景点：${input.inPlan.join("、") || "无"}
- 被删掉的景点：${input.dropped.join("、") || "无"}

用户的调整建议："${input.message}"

请严格输出此 JSON（未改动的字段沿用当前值）：
{
  "days": ${input.days},
  "hotelTier": "${input.hotelTier}",
  "hotelPrefs": ${JSON.stringify(input.hotelPrefs)},
  "include": [],
  "exclude": [],
  "reply": "好的，我把…"
}`;
}

// ===== 新架构 · 输入层：从小红书帖子识别景点（NER，LLM 只干"抽名字"这件软活）=====

export const EXTRACT_SYSTEM_PROMPT = `你是一个地点提及抽取（NER）助手。你的唯一任务是：从用户粘贴的小红书旅行帖子正文里，找出明确出现的具体地点名称。

严格遵守：
- 只抽帖子里**真实出现**的地点，绝对不要自己补充、推荐、编造帖子没提到的地点。
- 同一个地点只出现一次，不要重复。
- 抽取对象包括：景点、公园、寺庙、博物馆、网红打卡墙/街区、餐厅、咖啡馆、小吃店、商场、市集等"能在地图上搜到的点"。
- 不要抽：抽象的活动（如"逛街""拍照""散步"）、宽泛的区域（如"老城区""市中心"，除非它本身是个具体地名）、交通方式、时间。
- name 必须逐字出现在帖子正文中；不要把简称补成全名，也不要把描述性指代猜成某个地点。名称不明确时直接跳过。
- evidence 必须逐字复制包含该地点名的短原文片段（不超过60字），用于用户核对；不能概括、改写或编造。
- 你只做"找原文里的名称"，不做行程规划、不算路线、不评价，也不生成推荐理由。

只输出 JSON，不要输出任何解释文字。`;

// ===== 新架构 · 规划层：让 LLM 估"每个景点合理游玩多久 + 重要度"（软判断）=====
// LLM 只输出时长和重要度，不碰路线计算。

export const DURATION_SYSTEM_PROMPT = `你是熟悉中国各地景点的旅行规划助手。给你一批景点，你要估计每个景点"一般游客合理的游玩时长（分钟）"和"重要度（1-5）"。

时长要符合现实：
- 大型主题乐园（如北京环球影城、上海迪士尼）需要一整天，约 480-600 分钟；
- 大型景区/古镇（如颐和园、故宫）约 180-240 分钟；
- 一般景点/博物馆约 90-150 分钟；
- 打卡拍照点、咖啡馆、小景点约 30-60 分钟。

重要度 5 = 必看地标/此行核心，1 = 锦上添花可舍弃。

只输出 JSON，不要任何解释。`;

export function buildDurationPrompt(
  city: string,
  pois: { name: string; category?: string }[]
): string {
  const list = pois.map((p, i) => `${i + 1}. ${p.name}（${p.category || "景点"}）`).join("\n");
  return `城市：${city}
景点列表：
${list}

请为每个景点估计游玩时长和重要度，严格按此 JSON 输出（name 必须与上面完全一致）：
{
  "results": [
    { "name": "北京环球影城", "minutes": 540, "priority": 5 }
  ]
}`;
}

export function buildExtractPrompt(input: ExtractInput): string {
  return `下面是一篇小红书旅行帖子的正文，请抽取其中明确出现的具体地点名称。

帖子正文：
"""
${input.text}
"""

请严格按以下 JSON 格式输出（candidates 按帖子里出现的先后顺序排列）：
{
  "city": "你推断的城市名（如成都；推断不出就留空字符串）",
  "candidates": [
    {
      "name": "帖子中原样出现的具体地点名",
      "evidence": "包含该地点名的帖子原文片段",
      "category": "景点 / 美食 / 咖啡 / 拍照点 / 购物 / 其他 中选一个",
      "aliasInPost": "仅当帖子里的别名与 name 不同且同样逐字出现时填写，否则留空"
    }
  ]
}

如果帖子里一个真实地点都没有，返回 {"city": "", "candidates": []}。`;
}


export function buildGeneratePrompt(input: TripInput): string {
  const prefText =
    input.preferences.length > 0
      ? `用户偏好：${input.preferences.join("、")}。请在行程中优先安排符合这些偏好的活动。`
      : "用户未指定偏好，请安排多样化的体验。";
  const outbound = input.outboundTransport;
  const inbound = input.returnTransport;
  const hotel = input.selectedHotel;
  const breakfastRule =
    input.breakfastHabit === "不吃"
      ? "用户不吃早餐，不要强行安排早餐。"
      : `用户${input.breakfastHabit || "每天吃"}早餐；除非到达时间不允许，每天先安排早餐。`;
  const foodRule = input.foodPreferences?.length
    ? `饮食偏好：${input.foodPreferences.join("、")}。餐厅必须有地图可搜索的具体店名，优先当地特色、老字号或知名店，禁止“附近餐厅”“长城脚下餐厅”之类占位名称。`
    : "餐厅必须有地图可搜索的具体店名，优先当地特色店，禁止使用任何模糊占位名称。";
  const strategyRule = input.planningStrategy === "coverage"
    ? "方案倾向：地点覆盖优先。在不违反交通、用餐、营业和返程约束的前提下，尽量安排更多已保存地点；无法纳入的地点必须留给后续清单，不得硬塞。"
    : input.planningStrategy === "low-commute"
      ? "方案倾向：通勤优先。优先按区域聚类，宁可少安排较远地点，也不要制造明显绕路。"
      : input.planningStrategy === "relaxed"
        ? "方案倾向：轻松优先。每天保留更充裕的空档，减少连续活动数量，不为覆盖率压缩用餐和交通时间。"
        : "综合规划要求：以用户已填写的旅行偏好为主要决策依据，同时平衡已保存地点的覆盖、区域间通勤与每日活动节奏。不为追求地点数量制造明显绕路，也不得压缩用餐、交通和返程缓冲时间。";
  const sourcePOIRule = input.sourcePOIs?.length
    ? `\n这次行程来自用户已保存的小红书地点清单。非餐饮活动只能从下列清单中选择，不得新增景点、商场、街区、咖啡馆或打卡点，也不要把清单外地点说成帖子提到过的。餐饮活动优先使用清单中类别为“美食”或“咖啡”的地点；餐饮不足时只输出“午餐”或“晚餐”这一餐次，服务端会用地图在附近补充真实餐厅并标注“小助手推荐”。\n地点清单：\n${input.sourcePOIs.map((poi, index) => `${index + 1}. ${poi.name}（${poi.category || "其他"}${poi.note ? `；${poi.note}` : ""}）`).join("\n")}\n`
    : "";

  return `请为用户生成${input.destination}${input.days}日游的活动顺序。往返交通和酒店已经由用户在真实平台确认，你不能修改、替换或重新估价。

已确认信息：
- 日期：${input.startDate} 至 ${input.endDate}
- 人数：${input.travelers}人
- 去程：${outbound?.serviceNumber}，${outbound?.departureTerminal} ${outbound?.departTime} → ${outbound?.arrivalTerminal} ${outbound?.arriveTime}
- 返程：${inbound?.serviceNumber}，${inbound?.departureTerminal} ${inbound?.departTime} → ${inbound?.arrivalTerminal} ${inbound?.arriveTime}
- 酒店：${hotel?.name}${hotel?.address ? `，地址：${hotel.address}` : ""}
- 酒店偏好：${input.hotelPreferences?.join("、") || "未指定"}
- ${breakfastRule}
- ${foodRule}
- ${strategyRule}
${prefText}
${sourcePOIRule}

严格规则：
1. 不得生成任何新的高铁车次、航班号、机票价、酒店价、菜价或日均价。
2. 每个活动必须提供 placeName：只能填地图可以搜索的规范地点名。title 可以写“晚餐：XX”，placeName 只能写“XX”。
3. 不确定的门票、餐饮等费用统一写“价格待核实”，不得写具体金额。
4. highlights 不得包含具体价格；只写体验亮点。tip 只写一般性提醒，不得捏造预约开放时间、票价或抢票规则。
5. 每段市内交通必须提供 fromPlace 和 toPlace。duration、cost、description 先写“待地图计算”，服务端会用高德数据覆盖，绝不能自行编地铁线路、出口、耗时或费用。
6. Day 1 从 ${outbound?.arrivalTerminal} ${outbound?.arriveTime} 开始，先前往 ${hotel?.name} 办理入住，再安排活动。
7. 中间每天从 ${hotel?.name} 出发，最后返回 ${hotel?.name}。
8. 最后一天必须预留充足时间，从最后一个地点前往 ${inbound?.departureTerminal}，并在 ${inbound?.departTime} 前至少90分钟到达。
9. 早餐应在07:00-09:00、午餐应在11:30-13:30、晚餐应在17:30-20:00；不能把午餐拖到下午五点或把晚餐拖到深夜。
10. 普通参观活动最晚21:30结束；20:00后不要安排需要入馆的活动。鸟巢、水立方等夜间只能写“外观”，不得声称场馆仍开放。
11. 不输出 dailyBudget、totalBudget、hotel 或 transportAdvice。只输出 dailyPlans。

严格按以下 JSON 输出，不要输出解释：
{
  "dailyPlans": [
    {
      "dayLabel": "Day 1",
      "blocks": [
        {
          "type": "transport",
          "id": "t1",
          "mode": "taxi",
          "duration": "待地图计算",
          "cost": "待地图计算",
          "description": "待地图计算",
          "fromPlace": "${outbound?.arrivalTerminal}",
          "toPlace": "${hotel?.name}"
        },
        {
          "type": "activity",
          "id": "a1",
          "startTime": "14:30",
          "endTime": "15:30",
          "title": "前往酒店办理入住",
          "placeName": "${hotel?.name}",
          "category": "住宿",
          "cost": "已计入已确认酒店费用",
          "duration": "1小时",
          "tip": "入住时间以酒店订单为准",
          "highlights": []
        }
      ]
    }
  ]
}

category 必须是：美食、文化古迹、自然风光、购物、亲子、摄影打卡、休闲、住宿之一。
活动 id 用 a1、a2…；交通 id 用 t1、t2…，全局不重复。`;
}

export function buildAdjustPrompt(req: AdjustRequest): string {
  const { plan, dayIndex, blockId, action, extraMinutes } = req;
  const day = plan.dailyPlans[dayIndex];
  const blockIdx = day.blocks.findIndex((b) => b.id === blockId);
  const targetBlock = day.blocks[blockIdx] as Block & { title?: string };

  const confirmedBlocks = day.blocks.slice(0, blockIdx);
  const confirmedJSON = JSON.stringify(confirmedBlocks, null, 2);

  let instruction = "";
  switch (action) {
    case "remove":
      instruction = `用户不想去"${targetBlock.title}"。请删除这个活动及其前后的交通段，从该时间点开始重新规划当天剩余行程。`;
      break;
    case "extend":
      instruction = `用户想在"${targetBlock.title}"多待${extraMinutes || 60}分钟。请将该活动的结束时间延后${extraMinutes || 60}分钟，然后重新规划当天剩余行程（可能需要删减后续某个活动）。`;
      break;
    case "replace":
      instruction = `用户想换掉"${targetBlock.title}"，请用一个不同类型的活动替换它（保持相同的时间窗口），后续行程的交通衔接也要相应更新。`;
      break;
  }

  return `这是${plan.destination}旅行第${dayIndex + 1}天的行程调整请求。
用户住在${plan.selectedHotel?.name || plan.hotel?.area || "已确认酒店"}。

${instruction}

已确定的行程（不要修改）：
${confirmedJSON}

请只输出从调整点开始的新 blocks 数组（包含活动段和交通段交替），格式与之前相同。
要求：
- 每个活动必须包含 category、placeName 和 highlights；placeName 只能是地图能搜索的规范地点名
- 不得输出具体菜价、票价、营业时间或抢票规则；cost 统一写"价格待核实"
- 每段交通必须包含准确 fromPlace 和 toPlace；duration、cost、description 统一写"待地图计算"
- 不得自行编地铁线路、出口、交通耗时或费用，服务端会调用地图 API
- 时间必须与已确定行程的最后一个 block 衔接，到 21:00 左右结束
- 最后一个活动结束后必须有一段返回${plan.selectedHotel?.name || "酒店"}的交通段
- id 从 a${getMaxId(day.blocks, "a") + 1} 和 t${getMaxId(day.blocks, "t") + 1} 开始递增

请严格按照 JSON 数组格式输出，不要输出任何其他内容：
[
  { "type": "activity", ... },
  { "type": "transport", ... },
  ...
]`;
}

export function buildHotelSelectPrompt(plan: TripPlan, hotelName: string): string {
  return `用户选择了住在"${hotelName}"（位于${plan.destination}）。

请根据这个酒店的位置，重新调整以下行程中所有天的交通方式和时间。
- 每天第一个交通段应该是从"${hotelName}"出发
- 每天最后一个交通段应该是返回"${hotelName}"
- 其他景点安排保持不变，只调整交通段的具体线路、时间和费用
- 交通段必须写清楚：地铁几号线（往哪个方向）到哪站（哪个口出）

当前完整行程：
${JSON.stringify(plan.dailyPlans, null, 2)}

请输出调整后的完整 dailyPlans（所有天），以及更新后的 dailyBudget。
hotel 信息更新为用户选择的酒店。

请严格按照 JSON 格式输出：
{
  "dailyPlans": [...],
  "hotel": {
    "area": "...",
    "reason": "...",
    "budgetRange": "...",
    "examples": ["${hotelName}"]
  }
}`;
}

function getMaxId(blocks: Block[], prefix: string): number {
  let max = 0;
  for (const b of blocks) {
    if (b.id.startsWith(prefix)) {
      const num = parseInt(b.id.slice(prefix.length), 10);
      if (num > max) max = num;
    }
  }
  return max;
}

export const SYSTEM_PROMPT = `你是一位旅行活动排序助手。你只能做偏好理解、活动选择和顺序安排，不能冒充票务、酒店、地图或商家实时数据库。

你的行程特点：
- 往返交通和酒店只使用用户已确认的信息
- 市内交通只标明准确起点和终点，具体路线交给地图 API
- 不输出无来源的票价、菜价、营业时间、预约规则或预算
- 每个景点给出2-3个具体的必看/必做/必吃亮点
- 合理安排体力：上午重点景点，下午轻松活动，晚上夜景美食
- 每天三顿正餐不能少
- 每天结束后必须有返回酒店的交通安排

你只输出 JSON，不输出任何解释文字。`;
