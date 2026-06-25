"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { POICandidate, POICollection } from "@/lib/types";
import { savePOICollection } from "@/lib/storage";

const CATEGORY_ORDER = ["景点", "美食", "咖啡", "拍照点", "购物", "其他"];

const CATEGORY_STYLE: Record<string, string> = {
  景点: "bg-blue-50 text-blue-700 border-blue-200",
  美食: "bg-orange-50 text-orange-700 border-orange-200",
  咖啡: "bg-amber-50 text-amber-700 border-amber-200",
  拍照点: "bg-pink-50 text-pink-700 border-pink-200",
  购物: "bg-emerald-50 text-emerald-700 border-emerald-200",
  其他: "bg-gray-100 text-gray-600 border-gray-200",
};

export default function ExtractPage() {
  const router = useRouter();
  const [rawText, setRawText] = useState("");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [extracted, setExtracted] = useState(false);
  const [city, setCity] = useState("");
  const [candidates, setCandidates] = useState<POICandidate[]>([]);
  const [manualName, setManualName] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);

  const handleExtract = async () => {
    if (rawText.trim().length < 5) return;
    setLoading(true);
    setError(null);
    setSavedId(null);
    try {
      const res = await fetch("/api/extract-pois", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: rawText.trim(), url: url.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "识别失败，请重试。");
        return;
      }
      setCity(data.city || "");
      setCandidates(data.candidates || []);
      setExtracted(true);
    } catch {
      setError("网络错误，请检查网络连接后重试。");
    } finally {
      setLoading(false);
    }
  };

  const handleOcr = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setOcrLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append("images", f));
      const res = await fetch("/api/ocr", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "图片识别失败，请重试。");
        return;
      }
      // 多张截图/多次上传时，累加到现有文本后面
      setRawText((prev) => (prev ? prev + "\n" + data.text : data.text));
    } catch {
      setError("网络错误，请重试。");
    } finally {
      setOcrLoading(false);
    }
  };

  const toggle = (id: string) => {
    setCandidates((prev) =>
      prev.map((c) => (c.id === id ? { ...c, selected: !c.selected } : c))
    );
  };

  const setAll = (selected: boolean) =>
    setCandidates((prev) => prev.map((c) => ({ ...c, selected })));

  const setCategory = (cat: string, selected: boolean) =>
    setCandidates((prev) =>
      prev.map((c) => ((c.category || "其他") === cat ? { ...c, selected } : c))
    );

  const addManual = () => {
    const name = manualName.trim();
    if (!name) return;
    setCandidates((prev) => [
      ...prev,
      {
        id: `m${Date.now()}`,
        name,
        category: "其他",
        selected: true,
        manual: true,
      },
    ]);
    setManualName("");
  };

  const selectedCount = candidates.filter((c) => c.selected).length;

  const handleSave = () => {
    const collection: POICollection = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      city: city || undefined,
      sourceUrl: url.trim() || undefined,
      rawText: rawText.trim(),
      candidates: candidates.filter((c) => c.selected),
    };
    savePOICollection(collection);
    setSavedId(collection.id);
  };

  return (
    <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
      <button
        onClick={() => router.push("/")}
        className="text-sm text-gray-400 hover:text-gray-600 mb-3 flex items-center gap-1"
      >
        ← 返回
      </button>

      <h1 className="text-2xl font-bold text-gray-900 mb-1">
        从小红书帖子提取景点
      </h1>
      <p className="text-sm text-gray-500 mb-6">
        把帖子正文复制粘贴进来，AI 识别出里面提到的地点，你再勾选想去的（漏掉的可以手动加）。
      </p>

      {/* 输入区 */}
      <div className="space-y-3 mb-6">
        {/* 上传截图 OCR（PC 端小红书不让复制文字时用）*/}
        <label
          className={`flex items-center justify-center gap-2 w-full py-3 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${
            ocrLoading
              ? "border-gray-200 bg-gray-50 text-gray-400 cursor-wait"
              : "border-pink-300 bg-pink-50/50 text-pink-600 hover:bg-pink-50"
          }`}
        >
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={ocrLoading}
            onChange={(e) => {
              handleOcr(e.target.files);
              e.target.value = ""; // 允许重复上传同一张
            }}
            className="hidden"
          />
          {ocrLoading ? (
            <span className="flex items-center gap-2 text-sm">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              正在识别截图文字...
            </span>
          ) : (
            <span className="text-sm font-medium">📷 上传帖子截图（可多张，自动识别文字）</span>
          )}
        </label>

        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-gray-100" />
          <span className="text-xs text-gray-400">或直接粘贴正文</span>
          <div className="flex-1 h-px bg-gray-100" />
        </div>

        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          rows={7}
          placeholder="粘贴小红书帖子正文，例如：成都这几个地方真的绝了！宽窄巷子人均50吃到饱，鹤鸣茶社喝盖碗茶超惬意，东郊记忆那面红墙巨出片……"
          className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm leading-relaxed resize-none"
        />
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="帖子链接（可选，仅作记录，不会自动抓取）"
          className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
        />
        <button
          onClick={handleExtract}
          disabled={rawText.trim().length < 5 || loading}
          className="w-full py-3 rounded-xl btn-route font-semibold shadow-lg"
        >
          {loading ? "AI 识别中..." : extracted ? "重新识别" : "识别景点 🔍"}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* 候选 + 选择区 */}
      {extracted && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-gray-700">
              识别到 {candidates.length} 个地点
              {city && <span className="text-gray-400 ml-1">· {city}</span>}
            </h2>
            <div className="flex items-center gap-2">
              <span className="text-sm text-blue-600 font-medium">已选 {selectedCount}</span>
              {candidates.length > 0 && (
                <button
                  onClick={() => setAll(selectedCount !== candidates.length)}
                  className="text-xs px-2.5 py-1 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-100"
                >
                  {selectedCount === candidates.length ? "全不选" : "全选"}
                </button>
              )}
            </div>
          </div>

          {candidates.length === 0 && (
            <p className="text-sm text-gray-400 mb-4">
              没识别到地点。可能帖子太短或没提到具体地名，试试手动添加。
            </p>
          )}

          {/* 按类别分组，便于看清各类各选了几个 */}
          <div className="space-y-4 mb-4">
            {CATEGORY_ORDER.filter((cat) =>
              candidates.some((c) => (c.category || "其他") === cat)
            ).map((cat) => {
              const group = candidates.filter((c) => (c.category || "其他") === cat);
              const sel = group.filter((c) => c.selected).length;
              return (
                <div key={cat}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full border ${
                        CATEGORY_STYLE[cat] || CATEGORY_STYLE["其他"]
                      }`}
                    >
                      {cat} {sel}/{group.length}
                    </span>
                    <button
                      onClick={() => setCategory(cat, sel !== group.length)}
                      className="text-xs text-gray-400 hover:text-gray-600"
                    >
                      {sel === group.length ? "全不选" : "全选本类"}
                    </button>
                  </div>
                  <div className="space-y-2">
                    {group.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => toggle(c.id)}
                        className={`w-full text-left p-3 rounded-xl border transition-all flex items-start gap-3 ${
                          c.selected
                            ? "bg-white border-blue-300 shadow-sm"
                            : "bg-gray-50 border-gray-200 opacity-60"
                        }`}
                      >
                        <span
                          className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-md border flex items-center justify-center text-xs ${
                            c.selected
                              ? "bg-blue-600 border-blue-600 text-white"
                              : "bg-white border-gray-300 text-transparent"
                          }`}
                        >
                          ✓
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-gray-900">{c.name}</span>
                            {c.manual && (
                              <span className="text-xs px-2 py-0.5 rounded-full border bg-violet-50 text-violet-600 border-violet-200">
                                手动添加
                              </span>
                            )}
                          </span>
                          {c.aliasInPost && (
                            <span className="block text-xs text-gray-400 mt-0.5">
                              帖子里叫：「{c.aliasInPost}」
                            </span>
                          )}
                          {c.note && (
                            <span className="block text-sm text-gray-500 mt-0.5">{c.note}</span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 手动新增（兜底 AI 漏识别的点）*/}
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addManual();
              }}
              placeholder="AI 漏了的地点？手动加一个"
              className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
            <button
              onClick={addManual}
              disabled={!manualName.trim()}
              className="px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium transition-colors disabled:opacity-50"
            >
              + 添加
            </button>
          </div>
          <p className="text-xs text-gray-400 mb-6">
            下一步会接入地图搜索，手动添加时可直接在地图上选准确位置（待接入高德 API）。
          </p>

          {/* 保存 */}
          <button
            onClick={handleSave}
            disabled={selectedCount === 0}
            className="w-full py-3 rounded-xl btn-route font-semibold shadow-lg"
          >
            保存选中的 {selectedCount} 个地点
          </button>

          {savedId && (
            <div className="mt-4 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm">
              ✓ 已保存 {selectedCount} 个地点。
              <button
                onClick={() => router.push(`/plan-route?id=${savedId}`)}
                className="mt-3 w-full py-2.5 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 transition-colors"
              >
                下一步：按天聚类 + 规划路线 🗺 →
              </button>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
