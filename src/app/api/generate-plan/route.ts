import { NextRequest, NextResponse } from "next/server";
import { buildGeneratePrompt, SYSTEM_PROMPT } from "@/lib/prompts";
import { normalizeDailyPlans } from "@/lib/plan-safety";
import { fetchWithTimeout } from "@/lib/fetch-timeout";
import { TripInput, TripPlan } from "@/lib/types";

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

    if (
      !input.destination ||
      !input.days ||
      !input.startDate ||
      !input.endDate ||
      !input.outboundTransport ||
      !input.returnTransport ||
      !input.selectedHotel
    ) {
      return NextResponse.json(
        { error: "请先确认日期、往返交通和酒店。" },
        { status: 400 }
      );
    }

    const userPrompt = buildGeneratePrompt(input);

    const response = await fetchWithTimeout("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        max_tokens: 8192,
        // 行程生成已经由提示词和服务端安全规则约束。关闭默认 thinking，
        // 把完整输出预算留给最终行程 JSON，避免 content 为空。
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        temperature: 0.7,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
    }, 60_000, "DeepSeek 行程生成");

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("DeepSeek API error:", response.status, errorBody);
      return NextResponse.json(
        { error: `AI 服务调用失败 (${response.status})，请稍后重试。` },
        { status: 502 }
      );
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    const text = choice?.message?.content;
    if (typeof text !== "string" || !text.trim()) {
      console.error("DeepSeek returned empty plan content", {
        finishReason: choice?.finish_reason,
        hasReasoningContent: Boolean(choice?.message?.reasoning_content),
      });
      return NextResponse.json(
        { error: "AI 没有生成完整行程，请重试。" },
        { status: 502 }
      );
    }

    const parsed = JSON.parse(text) as { dailyPlans?: unknown };
    const normalized = normalizeDailyPlans(parsed.dailyPlans);
    if (normalized.length === 0 || normalized.every((day) => day.blocks.length === 0)) {
      return NextResponse.json(
        { error: "AI 返回的活动结构不完整，请重试。" },
        { status: 502 }
      );
    }
    const plan: TripPlan = {
      id: crypto.randomUUID(),
      destination: input.destination,
      departureCity: input.departureCity,
      days: input.days,
      preferences: input.preferences,
      hotelPreferences: input.hotelPreferences,
      foodPreferences: input.foodPreferences,
      breakfastHabit: input.breakfastHabit,
      planningStrategy: input.planningStrategy,
      sourcePOICollectionId: input.sourcePOICollectionId,
      sourcePOIs: input.sourcePOIs,
      createdAt: new Date().toISOString(),
      startDate: input.startDate,
      endDate: input.endDate,
      publicTransportTaxiThreshold: input.publicTransportTaxiThreshold || 60,
      travelers: input.travelers,
      outboundTransport: input.outboundTransport,
      returnTransport: input.returnTransport,
      selectedHotel: input.selectedHotel,
      status: "generated",
      // 先返回可查看的 AI 活动顺序。行程页会在后台调用 repair-plan，
      // 用高德逐段核对并升级到 engineVersion 7，避免长请求被浏览器断开。
      engineVersion: 6,
      dailyPlans: normalized,
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
