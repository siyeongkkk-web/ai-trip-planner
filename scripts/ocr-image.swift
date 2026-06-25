// 用 macOS Vision 框架本地 OCR（中文）识别单张图片，文本打印到 stdout。
// 用法：swift scripts/ocr-image.swift <图片路径>
// 复用自 reading-synthesizer 项目的本地 OCR 方案：免费、无需 API key、中文准确。
import Foundation
import Vision
import AppKit

let args = CommandLine.arguments
guard args.count >= 2 else {
    FileHandle.standardError.write("usage: ocr-image.swift <path>\n".data(using: .utf8)!)
    exit(1)
}

let path = args[1]
guard let img = NSImage(contentsOfFile: path),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write("cannot load image: \(path)\n".data(using: .utf8)!)
    exit(2)
}

let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.recognitionLanguages = ["zh-Hans", "en-US"]
req.usesLanguageCorrection = true

let handler = VNImageRequestHandler(cgImage: cg, options: [:])
do {
    try handler.perform([req])
    let lines = (req.results as? [VNRecognizedTextObservation] ?? []).compactMap {
        $0.topCandidates(1).first?.string
    }
    print(lines.joined(separator: "\n"))
} catch {
    FileHandle.standardError.write("ocr failed: \(error)\n".data(using: .utf8)!)
    exit(3)
}
