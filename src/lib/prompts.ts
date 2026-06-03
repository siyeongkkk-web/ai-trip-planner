import { TripInput, AdjustRequest, Block } from "./types";

export function buildGeneratePrompt(input: TripInput): string {
  const prefText =
    input.preferences.length > 0
      ? `用户偏好：${input.preferences.join("、")}。请在行程中优先安排符合这些偏好的活动。`
      : "用户未指定偏好，请安排多样化的体验。";

  return `请为用户生成一份${input.destination} ${input.days}天的详细旅行行程。

${prefText}

要求：
1. 每天安排 8:00 至 21:00 的活动，合理分配体力（上午精力充沛安排重点景点，下午可稍轻松，晚上安排夜景/美食）
2. 活动段和交通段必须严格交替排列，时间轴完全连续，不能有空白间隙
3. 交通方式根据距离选择：步行（<1km）、地铁/公交（1-10km）、打车（10-20km）、高铁/火车（跨城）
4. 交通耗时和费用要合理估算
5. 每天必须包含早餐、午餐、晚餐三顿正餐
6. tip 要实用：是否需要预约、最佳游览时间、避坑提醒等
7. 费用用人民币

请严格按照以下 JSON 格式输出，不要输出任何其他内容：

{
  "dailyPlans": [
    {
      "dayLabel": "Day 1",
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
          "tip": "建议早点去避开高峰"
        },
        {
          "type": "transport",
          "id": "t1",
          "mode": "subway",
          "duration": "30分钟",
          "cost": "¥5",
          "description": "乘坐地铁X号线到XX站"
        }
      ]
    }
  ]
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

${instruction}

已确定的行程（不要修改）：
${confirmedJSON}

请只输出从调整点开始的新 blocks 数组（包含活动段和交通段交替），格式与之前相同。
时间必须与已确定行程的最后一个 block 衔接，到 21:00 左右结束。
id 请从 a${getMaxId(day.blocks, "a") + 1} 和 t${getMaxId(day.blocks, "t") + 1} 开始递增。

请严格按照 JSON 数组格式输出，不要输出任何其他内容：
[
  { "type": "activity", ... },
  { "type": "transport", ... },
  ...
]`;
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

export const SYSTEM_PROMPT = `你是一位专业的旅行规划师，擅长为中国国内旅行制定详细的逐小时行程。

你的行程特点：
- 时间安排精确且合理，考虑实际交通时间
- 活动段和交通段严格交替，时间轴完全连续
- 了解各城市热门景点的开放时间、门票价格、最佳游览时间
- 提供实用的小贴士（预约方式、避坑提醒、拍照建议等）
- 合理安排体力：上午重点景点，下午轻松活动，晚上夜景美食
- 每天三顿正餐不能少

你只输出 JSON，不输出任何解释文字。`;
