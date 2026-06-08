import { NextRequest, NextResponse } from "next/server";
import { buildGeneratePrompt, SYSTEM_PROMPT } from "@/lib/prompts";
import { TripInput, TripPlan, DayPlan, HotelRecommendation } from "@/lib/types";

export async function POST(req: NextRequest) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || apiKey === "your-api-key-here") {
    return NextResponse.json(
      { error: "未配置 API Key。请在 .env.local 文件中将 DEEPSEEK_API_KEY 设置为你的真实 API Key。" },
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

    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        max_tokens: 8192,
        temperature: 0.7,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("DeepSeek API error:", response.status, errorBody);
      return NextResponse.json(
        { error: `AI 服务调用失败 (${response.status})，请稍后重试。` },
        { status: 502 }
      );
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("Failed to parse AI response:", text);
      return NextResponse.json(
        { error: "AI 返回格式异常，请重试。" },
        { status: 500 }
      );
    }

    const parsed: {
      dailyPlans: DayPlan[];
      hotel?: HotelRecommendation;
      totalBudget?: string;
      transportAdvice?: string;
    } = JSON.parse(jsonMatch[0]);

    const plan: TripPlan = {
      id: crypto.randomUUID(),
      destination: input.destination,
      departureCity: input.departureCity,
      days: input.days,
      preferences: input.preferences,
      createdAt: new Date().toISOString(),
      dailyPlans: parsed.dailyPlans,
      hotel: parsed.hotel,
      totalBudget: parsed.totalBudget,
      transportAdvice: parsed.transportAdvice,
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
