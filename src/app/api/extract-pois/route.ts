import { NextRequest, NextResponse } from "next/server";
import { buildExtractPrompt, EXTRACT_SYSTEM_PROMPT } from "@/lib/prompts";
import { ExtractInput } from "@/lib/types";
import { fetchWithTimeout } from "@/lib/fetch-timeout";

interface RawCandidate {
  name?: string;
  evidence?: string;
  aliasInPost?: string;
  category?: string;
}

const CATEGORIES = new Set(["景点", "美食", "咖啡", "拍照点", "购物", "其他"]);

function normalizeForEvidence(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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

    const response = await fetchWithTimeout("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        max_tokens: 4096,
        // 地点抽取是确定性的结构化任务。关闭默认 thinking，避免长 OCR
        // 文本把输出预算耗在 reasoning_content，导致最终 content 为空。
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        // NER 是确定性抽取任务，温度调低减少自由发挥/编造
        temperature: 0.2,
        messages: [
          { role: "system", content: EXTRACT_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
    }, 30_000, "DeepSeek 地点提取");

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
      console.error("DeepSeek returned empty extraction content", {
        finishReason: choice?.finish_reason,
        hasReasoningContent: Boolean(choice?.message?.reasoning_content),
      });
      return NextResponse.json(
        { error: "AI 没有生成提取结果，请重试，或删减明显的乱码后再试。" },
        { status: 502 }
      );
    }

    const parsed: { city?: string; candidates?: RawCandidate[] } = JSON.parse(text);

    const source = normalizeForEvidence(input.text);
    const seen = new Set<string>();
    const candidates = (parsed.candidates || [])
      .filter((c) => {
        if (typeof c.name !== "string" || typeof c.evidence !== "string") return false;
        const name = normalizeForEvidence(c.name);
        const evidence = normalizeForEvidence(c.evidence);
        if (
          !name ||
          !evidence ||
          evidence.length > 60 ||
          !source.includes(name) ||
          !source.includes(evidence) ||
          !evidence.includes(name)
        ) {
          return false;
        }
        const duplicateKey = name.toLocaleLowerCase();
        if (seen.has(duplicateKey)) return false;
        seen.add(duplicateKey);
        return true;
      })
      .map((c, i) => ({
        id: `p${i + 1}`,
        name: c.name!.trim(),
        evidence: c.evidence?.trim(),
        aliasInPost:
          typeof c.aliasInPost === "string" && source.includes(normalizeForEvidence(c.aliasInPost))
            ? c.aliasInPost.trim()
            : undefined,
        category: CATEGORIES.has(c.category?.trim() || "") ? c.category!.trim() : "其他",
        // 不默认接受模型结果。用户需要基于原文证据主动选择。
        selected: false,
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
