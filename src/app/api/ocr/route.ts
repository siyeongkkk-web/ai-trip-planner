import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

// 本地 OCR：调用 macOS Vision 框架（scripts/ocr-image.swift），无需任何 API key。
// 仅在本地 macOS 环境可用（依赖系统 swift + Vision）。

const execFileAsync = promisify(execFile);
const SCRIPT = path.join(process.cwd(), "scripts", "ocr-image.swift");

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const files = form
      .getAll("images")
      .filter((f): f is File => f instanceof File);

    if (files.length === 0) {
      return NextResponse.json(
        { error: "请上传至少一张截图。" },
        { status: 400 }
      );
    }

    const texts: string[] = [];
    for (const file of files) {
      const buf = Buffer.from(await file.arrayBuffer());
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const tmp = path.join(tmpdir(), `xhs-ocr-${randomUUID()}.${ext}`);
      await writeFile(tmp, buf);
      try {
        const { stdout } = await execFileAsync("swift", [SCRIPT, tmp], {
          maxBuffer: 10 * 1024 * 1024,
          timeout: 60000,
        });
        if (stdout.trim()) texts.push(stdout.trim());
      } finally {
        await unlink(tmp).catch(() => {});
      }
    }

    const text = texts.join("\n");
    if (!text) {
      return NextResponse.json(
        { error: "没从截图里识别到文字，请确认截图清晰、包含帖子正文。" },
        { status: 422 }
      );
    }

    return NextResponse.json({ text });
  } catch (err) {
    console.error("OCR error:", err);
    return NextResponse.json(
      { error: "图片识别失败，请重试，或改用粘贴文本。" },
      { status: 500 }
    );
  }
}
