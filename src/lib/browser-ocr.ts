import { createWorker, OEM, PSM } from "tesseract.js";

export interface BrowserOcrProgress {
  label: string;
  progress: number;
}

function normalizeChineseOcrSpacing(value: string): string {
  return value.replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, "$1");
}

function progressLabel(status: string, fileIndex: number, fileCount: number): string {
  const prefix = fileCount > 1 ? `第 ${fileIndex + 1}/${fileCount} 张 · ` : "";
  if (status === "loading tesseract core") return `${prefix}正在加载识别引擎`;
  if (status === "loading language traineddata") return `${prefix}正在加载中文识别能力`;
  if (status === "initializing api") return `${prefix}正在准备识别`;
  if (status === "recognizing text") return `${prefix}正在识别文字`;
  return `${prefix}正在处理截图`;
}

export async function recognizeImagesInBrowser(
  files: File[],
  onProgress?: (progress: BrowserOcrProgress) => void
): Promise<string> {
  if (files.length === 0) return "";

  let fileIndex = 0;
  const worker = await createWorker("chi_sim", OEM.LSTM_ONLY, {
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract/core",
    langPath: "/tesseract/lang",
    logger: (message) => {
      onProgress?.({
        label: progressLabel(message.status, fileIndex, files.length),
        progress: Math.round((message.progress || 0) * 100),
      });
    },
  });

  try {
    await worker.setParameters({
      preserve_interword_spaces: "1",
      tessedit_pageseg_mode: PSM.AUTO,
    });
    const texts: string[] = [];
    for (fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      const result = await worker.recognize(files[fileIndex]);
      const text = normalizeChineseOcrSpacing(result.data.text).trim();
      if (text) texts.push(text);
    }
    return texts.join("\n");
  } finally {
    await worker.terminate();
  }
}
