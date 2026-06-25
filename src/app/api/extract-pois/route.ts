import { NextRequest, NextResponse } from "next/server";
import { buildExtractPrompt, EXTRACT_SYSTEM_PROMPT } from "@/lib/prompts";
import { ExtractInput } from "@/lib/types";

interface RawCandidate {
  name?: string;
  aliasInPost?: string;
  category?: string;
  note?: string;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || apiKey === "your-api-key-here") {
    return NextResponse.json(
      { error: "未配置 API Key。请在 .env.local 文件中将 DEEPSEEK_API_KEY 设置为你的真实 API Key。" },
      { status: 500 }
    );
  }

  try {
    const input: ExtractInput = await req.json();

    if (!input.text || input.text.trim().length < 5) {
      return NextResponse.json(
        { error: "请粘贴小红书帖子的正文内容（至少几句话）。" },
        { status: 400 }
      );
    }

    const userPrompt = buildExtractPrompt(input);

    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        max_tokens: 4096,
        // NER 是确定性抽取任务，温度调低减少自由发挥/编造
        temperature: 0.2,
        messages: [
          { role: "system", content: EXTRACT_SYSTEM_PROMPT },
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

    const parsed: { city?: string; candidates?: RawCandidate[] } = JSON.parse(
      jsonMatch[0]
    );

    const candidates = (parsed.candidates || [])
      .filter((c) => c.name && c.name.trim())
      .map((c, i) => ({
        id: `p${i + 1}`,
        name: c.name!.trim(),
        aliasInPost: c.aliasInPost?.trim() || undefined,
        category: c.category?.trim() || "其他",
        note: c.note?.trim() || undefined,
        selected: true, // 默认全选，用户取消不想去的（灭掉 AI 抽错的点）
        manual: false,
      }));

    return NextResponse.json({
      city: parsed.city?.trim() || "",
      candidates,
    });
  } catch (err) {
    console.error("Extract POIs error:", err);
    return NextResponse.json(
      { error: "识别景点时出错，请重试。" },
      { status: 500 }
    );
  }
}
