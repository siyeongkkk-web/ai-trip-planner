import { NextRequest, NextResponse } from "next/server";
import { buildHotelSelectPrompt, SYSTEM_PROMPT } from "@/lib/prompts";
import { TripPlan, DayPlan, HotelRecommendation } from "@/lib/types";

export async function POST(req: NextRequest) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || apiKey === "your-api-key-here") {
    return NextResponse.json(
      { error: "未配置 API Key。" },
      { status: 500 }
    );
  }

  try {
    const { plan, hotelName }: { plan: TripPlan; hotelName: string } = await req.json();
    const userPrompt = buildHotelSelectPrompt(plan, hotelName);

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
        { error: `AI 服务调用失败 (${response.status})` },
        { status: 502 }
      );
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: "AI 返回格式异常，请重试。" },
        { status: 500 }
      );
    }

    const parsed: { dailyPlans: DayPlan[]; hotel?: HotelRecommendation } =
      JSON.parse(jsonMatch[0]);

    const updatedPlan: TripPlan = {
      ...plan,
      dailyPlans: parsed.dailyPlans,
      hotel: parsed.hotel || plan.hotel,
    };

    return NextResponse.json(updatedPlan);
  } catch (err) {
    console.error("Select hotel error:", err);
    return NextResponse.json(
      { error: "更新行程时出错，请重试。" },
      { status: 500 }
    );
  }
}
