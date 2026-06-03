import { NextRequest, NextResponse } from "next/server";
import { buildAdjustPrompt, SYSTEM_PROMPT } from "@/lib/prompts";
import { AdjustRequest, Block } from "@/lib/types";

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "未配置 API Key。请在 .env.local 中设置 ANTHROPIC_API_KEY。" },
      { status: 500 }
    );
  }

  try {
    const adjustReq: AdjustRequest = await req.json();
    const userPrompt = buildAdjustPrompt(adjustReq);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("Anthropic API error:", response.status, errorBody);
      return NextResponse.json(
        { error: `AI 服务调用失败 (${response.status})，请稍后重试。` },
        { status: 502 }
      );
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || "";

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error("Failed to parse AI adjust response:", text);
      return NextResponse.json(
        { error: "AI 返回格式异常，请重试。" },
        { status: 500 }
      );
    }

    const newBlocks: Block[] = JSON.parse(jsonMatch[0]);

    const { plan, dayIndex, blockId } = adjustReq;
    const day = plan.dailyPlans[dayIndex];
    const blockIdx = day.blocks.findIndex((b) => b.id === blockId);

    const updatedBlocks = [...day.blocks.slice(0, blockIdx), ...newBlocks];

    const updatedPlan = { ...plan };
    updatedPlan.dailyPlans = [...plan.dailyPlans];
    updatedPlan.dailyPlans[dayIndex] = {
      ...day,
      blocks: updatedBlocks,
    };

    return NextResponse.json(updatedPlan);
  } catch (err) {
    console.error("Adjust plan error:", err);
    return NextResponse.json(
      { error: "调整行程时出错，请重试。" },
      { status: 500 }
    );
  }
}
