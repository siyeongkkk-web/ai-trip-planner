import { PaddleOCR } from "@paddleocr/paddleocr-js";
import type { OcrResultItem } from "@paddleocr/paddleocr-js";

export interface BrowserOcrProgress {
  label: string;
  progress: number;
}

type BrowserOcrEngine = Awaited<ReturnType<typeof PaddleOCR.create>>;

let enginePromise: Promise<BrowserOcrEngine> | null = null;

function getEngine(): Promise<BrowserOcrEngine> {
  if (!enginePromise) {
    enginePromise = PaddleOCR.create({
      lang: "ch",
      ocrVersion: "PP-OCRv5",
      worker: true,
      textDetLimitSideLen: 1600,
      textDetMaxSideLimit: 4000,
      textRecScoreThresh: 0.45,
      ortOptions: {
        backend: "wasm",
        wasmPaths: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/",
        numThreads: 1,
        simd: true,
      },
    }).catch((error) => {
      enginePromise = null;
      throw error;
    });
  }
  return enginePromise;
}

function readingOrder(items: OcrResultItem[]): OcrResultItem[] {
  return [...items].sort((left, right) => {
    const leftTop = Math.min(...left.poly.map((point) => point[1]));
    const rightTop = Math.min(...right.poly.map((point) => point[1]));
    const leftHeight = Math.max(...left.poly.map((point) => point[1])) - leftTop;
    const rightHeight = Math.max(...right.poly.map((point) => point[1])) - rightTop;
    const sameLineTolerance = Math.max(8, Math.min(leftHeight, rightHeight) * 0.6);
    if (Math.abs(leftTop - rightTop) > sameLineTolerance) return leftTop - rightTop;

    const leftEdge = Math.min(...left.poly.map((point) => point[0]));
    const rightEdge = Math.min(...right.poly.map((point) => point[0]));
    return leftEdge - rightEdge;
  });
}

function resultText(items: OcrResultItem[]): string {
  return readingOrder(items)
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join("\n");
}

export async function recognizeImagesInBrowser(
  files: File[],
  onProgress?: (progress: BrowserOcrProgress) => void
): Promise<string> {
  if (files.length === 0) return "";

  onProgress?.({ label: "正在加载中文识别能力", progress: 5 });
  const engine = await getEngine();
  onProgress?.({ label: "中文识别已就绪", progress: 15 });

  const texts: string[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const prefix = files.length > 1 ? `第 ${index + 1}/${files.length} 张 · ` : "";
    onProgress?.({
      label: `${prefix}正在识别文字`,
      progress: 15 + Math.round((index / files.length) * 80),
    });
    const [result] = await engine.predict(files[index], {
      textDetLimitSideLen: 1600,
      textDetMaxSideLimit: 4000,
      textRecScoreThresh: 0.45,
    });
    const text = result ? resultText(result.items) : "";
    if (text) texts.push(text);
  }

  onProgress?.({ label: "识别完成", progress: 100 });
  return texts.join("\n");
}
