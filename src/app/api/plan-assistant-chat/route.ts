import { NextRequest, NextResponse } from "next/server";
import { AssistantChatTurn } from "@/lib/assistant-agent";
import { runTripPlanningAgent } from "@/lib/trip-agent-harness";
import { ActivityOption, TripPlan } from "@/lib/types";

type PendingChoiceContext = {
  options?: ActivityOption[];
};

/**
 * 这层不再根据“附近/晚餐后/删掉”等句式分流或直接执行动作。
 * 模型负责把自然语言理解为任务、选择工具和生成候选；服务端只保留
 * API 配置、真实地图工具、确认前不可写入以及最终事务校验这些边界。
 */
function sanitizeUnappliedReply(reply: string) {
  if (/(?:已|已经)(?:新增|加入|替换|更新|修改|删除|安排)/.test(reply)) {
    return "我还没有修改行程。需要先完成地图核对，并由你确认方案后才能更新。";
  }
  if (/稍后|稍候|请稍候|待会儿|随后给|正在.*(?:查|找|搜索)/.test(reply)) {
    return "本轮没有完成必要的工具核对，当前行程没有变化。请补充目标后再试。";
  }
  return reply;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  try {
    const {
      plan,
      message,
      activeDayIndex = 0,
      history = [],
      pendingChoice,
    } = (await req.json()) as {
      plan?: TripPlan;
      message?: string;
      activeDayIndex?: number;
      history?: AssistantChatTurn[];
      pendingChoice?: PendingChoiceContext;
    };
    if (!plan || !message?.trim()) {
      return NextResponse.json({ error: "请输入调整建议。" }, { status: 400 });
    }
    if (!apiKey || apiKey === "your-api-key-here") {
      return NextResponse.json(
        { error: "未配置 DeepSeek API Key，无法启动行程 Agent。" },
        { status: 500 }
      );
    }

    const result = await runTripPlanningAgent({
      apiKey,
      plan,
      userMessage: message.trim(),
      history,
      activeDayIndex,
      candidateContext: pendingChoice?.options || [],
      signal: req.signal,
    });
    return NextResponse.json({
      ...result,
      reply: sanitizeUnappliedReply(result.reply),
    });
  } catch (error) {
    console.error("Plan assistant agent error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "行程 Agent 处理请求时出错，当前行程没有变化。",
      },
      { status: 500 }
    );
  }
}
