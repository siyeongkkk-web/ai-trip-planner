import { NextRequest, NextResponse } from "next/server";
import { buildGeneratePrompt, SYSTEM_PROMPT } from "@/lib/prompts";
import { TripInput, TripPlan, DayPlan } from "@/lib/types";

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "未配置 API Key。请在 .env.local 中设置 ANTHROPIC_API_KEY。" },
      { status: 500 }
    );
  }

  try {
    const input: TripInput = await req.json();

    if (!input.destination || !input.days) {
      return NextResponse.json(
        { error: "请输入目的地和出行天数" },
        { status: 400 }
      );
    }

    const userPrompt = buildGeneratePrompt(input);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8192,
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

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("Failed to parse AI response:", text);
      return NextResponse.json(
        { error: "AI 返回格式异常，请重试。" },
        { status: 500 }
      );
    }

    const parsed: { dailyPlans: DayPlan[] } = JSON.parse(jsonMatch[0]);

    const plan: TripPlan = {
      id: crypto.randomUUID(),
      destination: input.destination,
      days: input.days,
      preferences: input.preferences,
      createdAt: new Date().toISOString(),
      dailyPlans: parsed.dailyPlans,
    };

    return NextResponse.json(plan);
  } catch (err) {
    console.error("Generate plan error:", err);
    return NextResponse.json(
      { error: "生成行程时出错，请重试。" },
      { status: 500 }
    );
  }
}
