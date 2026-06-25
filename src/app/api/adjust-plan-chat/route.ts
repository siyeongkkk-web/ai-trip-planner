import { NextRequest, NextResponse } from "next/server";
import { buildAdjustChatPrompt, ADJUST_CHAT_SYSTEM_PROMPT } from "@/lib/prompts";
import { AdjustChatInput, AdjustChatResult, HotelTier, HotelPref } from "@/lib/types";

const TIERS: HotelTier[] = ["经济", "舒适", "豪华"];
const PREFS: HotelPref[] = ["地铁近", "公交近", "景点近", "闹中取静"];

export async function POST(req: NextRequest) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || apiKey === "your-api-key-here") {
    return NextResponse.json({ error: "未配置 DeepSeek API Key。" }, { status: 500 });
  }
  try {
    const input: AdjustChatInput = await req.json();
    if (!input.message?.trim()) {
      return NextResponse.json({ error: "请输入调整建议。" }, { status: 400 });
    }

    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        max_tokens: 1024,
        temperature: 0.2,
        messages: [
          { role: "system", content: ADJUST_CHAT_SYSTEM_PROMPT },
          { role: "user", content: buildAdjustChatPrompt(input) },
        ],
      }),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `AI 调用失败 (${res.status})。` }, { status: 502 });
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return NextResponse.json({ error: "AI 返回格式异常，请重试。" }, { status: 500 });

    const p = JSON.parse(m[0]) as Partial<AdjustChatResult>;
    // 收敛/兜底，避免 LLM 给出非法值
    const days = Math.min(14, Math.max(1, Math.round(Number(p.days) || input.days)));
    const hotelTier = TIERS.includes(p.hotelTier as HotelTier)
      ? (p.hotelTier as HotelTier)
      : input.hotelTier;
    const hotelPrefs = Array.isArray(p.hotelPrefs)
      ? (p.hotelPrefs.filter((x) => PREFS.includes(x as HotelPref)) as HotelPref[])
      : input.hotelPrefs;
    const result: AdjustChatResult = {
      days,
      hotelTier,
      hotelPrefs: hotelPrefs.length ? hotelPrefs : input.hotelPrefs,
      include: Array.isArray(p.include) ? p.include.filter(Boolean) : [],
      exclude: Array.isArray(p.exclude) ? p.exclude.filter(Boolean) : [],
      reply: typeof p.reply === "string" && p.reply ? p.reply : "好的，已根据你的建议调整。",
    };
    return NextResponse.json(result);
  } catch (err) {
    console.error("Adjust chat error:", err);
    return NextResponse.json({ error: "调整时出错，请重试。" }, { status: 500 });
  }
}
