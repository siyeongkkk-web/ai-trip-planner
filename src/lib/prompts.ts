import { TripInput, AdjustRequest, Block, TripPlan } from "./types";

export function buildGeneratePrompt(input: TripInput): string {
  const prefText =
    input.preferences.length > 0
      ? `用户偏好：${input.preferences.join("、")}。请在行程中优先安排符合这些偏好的活动。`
      : "用户未指定偏好，请安排多样化的体验。";

  let scheduleText = "";
  if (input.arrivalTime) {
    scheduleText += `用户第一天预计 ${input.arrivalTime} 到达${input.destination}。第一天从到达后开始安排，到达前不安排活动。`;
    scheduleText += `\n往返交通建议必须匹配这个到达时间——推荐的出发车次/航班应该能让用户在 ${input.arrivalTime} 前后到达。`;
  }
  if (input.departureTime) {
    scheduleText += `\n最后一天用户需要在 ${input.departureTime} 前到达车站/机场，请预留至少1小时提前量，最后一天行程在此之前结束。`;
    scheduleText += `\n返程交通建议必须匹配这个离开时间——推荐的返程车次/航班应该在 ${input.departureTime} 之后出发。`;
  }

  return `请为用户生成一份从${input.departureCity}出发去${input.destination}玩 ${input.days}天的详细旅行行程。

出行信息：
${scheduleText || `用户从${input.departureCity}出发前往${input.destination}，未指定具体到达时间。`}
${prefText}

要求：
1. 活动段和交通段必须严格交替排列，时间轴完全连续，不能有空白间隙
2. 合理分配体力（上午精力充沛安排重点景点，下午可稍轻松，晚上安排夜景/美食）
3. 【重要】交通方式必须写清楚具体线路信息：
   - 地铁：必须写"地铁X号线（往XX方向）到XX站（X口出）"，不能只写"乘坐地铁"
   - 公交：必须写"XX路公交到XX站"
   - 打车：写"打车约X公里，约¥XX"
   - 步行：写"沿XX路步行约X米"
4. 交通耗时和费用要合理估算
5. 每天必须包含早餐、午餐、晚餐三顿正餐
6. 【重要】tip 字段要包含预订/购票信息：
   - 是否需要提前预约？提前几天？在哪个平台预约（微信公众号/小程序/官网）？
   - 预约难度如何？（如"非常抢手，建议提前7天早上8点准时抢票"）
   - 是否需要身份证/学生证？是否有免费日？
7. 费用用人民币，每个活动给出具体金额。所有费用按单人计算。
8. 每个景点/活动增加 highlights 字段：列出2-3个必看/必做/必吃的具体亮点
9. 每天结尾给出当天预估总花费 dailyBudget（如"约¥500/人"），按单人计算
10. 【重要】每天最后一个活动结束后，必须安排一段"返回酒店"的交通段作为当天最后一个 block

另外请额外输出以下信息：
- hotel：推荐住宿区域，包含 area（推荐区域）、reason（为什么住这里，距离主要景点多远）、budgetRange（每晚价格区间）、examples（3个不同价位的具体酒店/民宿名称，从经济到中档排列）
- totalBudget：整个行程预估总花费（单人，含住宿、餐饮、门票、市内交通，不含往返大交通），并注明"以上为单人预估费用，参考各平台2024年均价"
- transportAdvice：往返大交通建议。必须和用户指定的到达/离开时间一致。格式如"去程：建议乘坐XX:XX从${input.departureCity}出发的高铁/航班，约X小时到达，票价约¥XXX；返程：建议购买XX:XX的车次/航班，票价约¥XXX"

请严格按照以下 JSON 格式输出，不要输出任何其他内容：

{
  "dailyPlans": [
    {
      "dayLabel": "Day 1",
      "dailyBudget": "约¥500/人",
      "blocks": [
        {
          "type": "activity",
          "id": "a1",
          "startTime": "08:00",
          "endTime": "09:00",
          "title": "酒店早餐",
          "category": "美食",
          "cost": "含在房费中",
          "duration": "1小时",
          "tip": "建议早点去避开高峰",
          "highlights": ["必吃：当地特色早点"]
        },
        {
          "type": "transport",
          "id": "t1",
          "mode": "subway",
          "duration": "30分钟",
          "cost": "¥5",
          "description": "乘坐地铁3号线（往太阳宫方向）到鼓楼大街站（B口出），步行200米到达"
        }
      ]
    }
  ],
  "hotel": {
    "area": "春熙路-太古里商圈",
    "reason": "位于市中心，步行10分钟可达春熙路、太古里，地铁2/3号线交汇，周边餐饮丰富",
    "budgetRange": "¥200-500/晚",
    "examples": ["汉庭酒店(春熙路店) ¥200/晚", "全季酒店(太古里店) ¥350/晚", "亚朵S酒店(春熙路店) ¥500/晚"]
  },
  "totalBudget": "约¥1500-2000/人（含住宿、餐饮、门票、市内交通，不含往返大交通。参考各平台2024年均价）",
  "transportAdvice": "去程：建议乘坐08:00从北京出发的G字头高铁，约8小时到达，二等座约¥500；返程：建议购买18:00的高铁，票价约¥500"
}

id 命名规则：活动用 a1, a2, a3...，交通用 t1, t2, t3...，全局递增不重复。`;
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
用户住在${plan.hotel?.area || "市中心"}。

${instruction}

已确定的行程（不要修改）：
${confirmedJSON}

请只输出从调整点开始的新 blocks 数组（包含活动段和交通段交替），格式与之前相同。
要求：
- 每个景点活动包含 highlights 字段（2-3个必看/必做亮点）
- 交通段必须写清楚具体线路：地铁几号线（往哪个方向）到哪站（哪个口出）
- tip 要包含预约/购票信息（是否需要预约、提前几天、在哪个平台）
- 时间必须与已确定行程的最后一个 block 衔接，到 21:00 左右结束
- 最后一个活动结束后必须有一段返回酒店的交通段
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

export const SYSTEM_PROMPT = `你是一位专业的旅行规划师，擅长为中国国内旅行制定详细的逐小时行程。你的建议参考了小红书、马蜂窝、携程等平台上的真实旅行攻略和用户评价。

你的行程特点：
- 时间安排精确且合理，考虑实际交通时间
- 活动段和交通段严格交替，时间轴完全连续
- 了解各城市热门景点的开放时间、门票价格、预约方式和预约难度
- 【关键】交通信息必须具体：地铁写到几号线、方向、站名和出口；公交写到几路；打车写距离和费用
- 每个景点给出2-3个具体的必看/必做/必吃亮点
- 提供实用的小贴士，特别是预约购票信息（提前几天、哪个平台、难不难抢）
- 合理安排体力：上午重点景点，下午轻松活动，晚上夜景美食
- 每天三顿正餐不能少
- 每天结束后必须有返回酒店的交通安排
- 推荐性价比高的住宿区域，给出不同价位选择
- 所有费用按单人计算

你只输出 JSON，不输出任何解释文字。`;
