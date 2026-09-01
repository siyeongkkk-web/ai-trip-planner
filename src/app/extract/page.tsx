"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { POICandidate, POICollection, POIMapVerification } from "@/lib/types";
import { savePOICollection } from "@/lib/storage";
import { renameCandidateAndInvalidateVerification } from "@/lib/poi-source";

const CATEGORY_ORDER = ["景点", "美食", "咖啡", "拍照点", "购物", "其他"];

const CATEGORY_STYLE: Record<string, string> = {
  景点: "bg-blue-50 text-blue-700 border-blue-200",
  美食: "bg-orange-50 text-orange-700 border-orange-200",
  咖啡: "bg-amber-50 text-amber-700 border-amber-200",
  拍照点: "bg-pink-50 text-pink-700 border-pink-200",
  购物: "bg-emerald-50 text-emerald-700 border-emerald-200",
  其他: "bg-gray-100 text-gray-600 border-gray-200",
};

type VerifyResult = POIMapVerification & { id: string };

function verificationLabel(candidate: POICandidate): string {
  if (!candidate.mapVerification) return "尚未核对";
  if (candidate.mapVerification.status === "not-found") return "地图未找到";
  return "地图已匹配";
}

export default function ExtractPage() {
  const router = useRouter();
  const [rawText, setRawText] = useState("");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrStatus, setOcrStatus] = useState("");
  const [verifyLoading, setVerifyLoading] = useState(false);
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

  const recognizeScreenshots = async (files: File[]) => {
    if (files.length === 0) return;
    setOcrLoading(true);
    setOcrStatus("正在加载浏览器识别能力");
    setError(null);
    try {
      const { recognizeImagesInBrowser } = await import("@/lib/browser-ocr");
      const text = await recognizeImagesInBrowser(files, ({ label, progress }) => {
        setOcrStatus(`${label}${progress > 0 ? ` ${progress}%` : ""}`);
      });
      if (!text) {
        setError("没从截图里识别到文字，请确认图片清晰并包含可读文字。");
        return;
      }
      setRawText((previous) => (previous ? `${previous}\n${text}` : text));
    } catch {
      setError("图片识别没有完成。你可以重试，或直接粘贴帖子正文。");
    } finally {
      setOcrLoading(false);
      setOcrStatus("");
    }
  };

  const handleOcr = (files: FileList | null) =>
    recognizeScreenshots(files ? Array.from(files) : []);

  const toggle = (id: string) => {
    setSavedId(null);
    setCandidates((previous) =>
      previous.map((candidate) =>
        candidate.id === id ? { ...candidate, selected: !candidate.selected } : candidate
      )
    );
  };

  const setAll = (selected: boolean) => {
    setSavedId(null);
    setCandidates((previous) => previous.map((candidate) => ({ ...candidate, selected })));
  };

  const setCategory = (category: string, selected: boolean) => {
    setSavedId(null);
    setCandidates((previous) =>
      previous.map((candidate) =>
        (candidate.category || "其他") === category ? { ...candidate, selected } : candidate
      )
    );
  };

  const updateName = (id: string, name: string) => {
    setSavedId(null);
    setCandidates((previous) =>
      previous.map((candidate) =>
        candidate.id === id
          ? renameCandidateAndInvalidateVerification(candidate, name)
          : candidate
      )
    );
  };

  const removeCandidate = (id: string) => {
    setSavedId(null);
    setCandidates((previous) => previous.filter((candidate) => candidate.id !== id));
  };

  const addManual = () => {
    const name = manualName.trim();
    if (!name) return;
    setSavedId(null);
    setCandidates((previous) => [
      ...previous,
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

  const selectedCandidates = candidates.filter((candidate) => candidate.selected);
  const selectedCount = selectedCandidates.length;
  const verifiedCount = selectedCandidates.filter(
    (candidate) => candidate.mapVerification?.status === "matched"
  ).length;
  const unverifiedSelected = selectedCandidates.filter(
    (candidate) => candidate.mapVerification?.status !== "matched"
  );
  const canSave = selectedCount > 0 && verifiedCount === selectedCount;
  const verifySelected = async () => {
    if (!selectedCount) {
      setError("请先选择至少一个想去的地点。");
      return;
    }
    if (!city.trim()) {
      setError("请先填写或确认城市，再核对地点。");
      return;
    }
    setVerifyLoading(true);
    setError(null);
    setSavedId(null);
    try {
      const res = await fetch("/api/verify-pois", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          city: city.trim(),
          candidates: selectedCandidates.map(({ id, name }) => ({ id, name })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "地点核对失败，请重试。");
        return;
      }
      const verifiedAt = data.verifiedAt || new Date().toISOString();
      const resultById = new Map<string, VerifyResult>(
        (data.results || []).map((result: VerifyResult) => [result.id, result])
      );
      setCandidates((previous) =>
        previous.map((candidate) => {
          const result = resultById.get(candidate.id);
          if (!result) return candidate;
          return {
            ...candidate,
            mapVerification: {
              status: result.status,
              query: result.query,
              matchedName: result.matchedName,
              address: result.address,
              poiId: result.poiId,
              lng: result.lng,
              lat: result.lat,
              verifiedAt,
            },
          };
        })
      );
    } catch {
      setError("网络错误，请检查网络连接后重试。");
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleSave = () => {
    if (!canSave) {
      setError("请先核对每一个已选地点；未找到的地点可改名后重新核对，或取消选择。");
      return;
    }
    const collection: POICollection = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      city: city.trim(),
      sourceUrl: url.trim() || undefined,
      rawText: rawText.trim(),
      candidates: selectedCandidates,
    };
    savePOICollection(collection);
    setSavedId(collection.id);
  };

  return (
    <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
      <button onClick={() => router.push("/")} className="text-sm text-gray-500 hover:text-gray-700 mb-3 flex items-center gap-1">
        返回
      </button>

      <h1 className="text-2xl font-bold text-gray-900 mb-1">从小红书帖子提取地点</h1>
      <p className="text-sm text-gray-600 mb-6">
        上传截图或粘贴正文，选出这次旅行想去的地点。
      </p>

      <div className="space-y-3 mb-6">
        <label className={`flex items-center justify-center gap-2 w-full py-3 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${ocrLoading ? "border-gray-200 bg-gray-50 text-gray-400 cursor-wait" : "border-pink-300 bg-pink-50/50 text-pink-700 hover:bg-pink-50"}`}>
          <input type="file" accept="image/*" multiple disabled={ocrLoading} onChange={(event) => { handleOcr(event.target.files); event.target.value = ""; }} className="hidden" />
          <span className="text-sm font-medium">{ocrLoading ? ocrStatus || "正在识别截图文字…" : "上传帖子截图（可多张）"}</span>
        </label>

        <div className="flex items-center gap-3"><div className="flex-1 h-px bg-gray-100" /><span className="text-xs text-gray-500">或直接粘贴正文</span><div className="flex-1 h-px bg-gray-100" /></div>

        <textarea value={rawText} onChange={(event) => setRawText(event.target.value)} rows={7} placeholder="粘贴小红书帖子正文" className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent text-sm leading-relaxed resize-none" />
        <input type="text" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="帖子链接（可选）" className="w-full px-4 py-2.5 rounded-xl border border-gray-300 bg-white text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent text-sm" />
        <button onClick={handleExtract} disabled={rawText.trim().length < 5 || loading} className="w-full py-3 rounded-xl btn-route font-semibold shadow-lg disabled:opacity-50">
          {loading ? "正在从原文提取…" : extracted ? "重新从原文提取" : "提取原文地点"}
        </button>
      </div>

      {error && <div role="alert" className="mb-4 p-3 rounded-xl bg-red-50 border border-red-300 text-red-800 text-sm">{error}</div>}

      {extracted && (
        <section aria-labelledby="review-heading">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 mb-4">
            <h2 id="review-heading" className="font-semibold text-blue-950">确认旅行城市</h2>
            <div className="mt-2">
              <label className="sr-only" htmlFor="city">旅行城市</label>
              <input id="city" value={city} onChange={(event) => { setCity(event.target.value); setSavedId(null); setCandidates((previous) => previous.map((candidate) => ({ ...candidate, mapVerification: undefined }))); }} placeholder="例如：成都" className="w-full px-3 py-2 rounded-lg border border-blue-300 bg-white text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-600" />
            </div>
          </div>

          <div className="flex items-center justify-between mb-3 gap-3">
            <h2 className="text-sm font-medium text-gray-800">提取到 {candidates.length} 个原文地点</h2>
            {candidates.length > 0 && <button onClick={() => setAll(selectedCount !== candidates.length)} className="text-xs px-2.5 py-1 rounded-full border border-gray-300 text-gray-700 hover:bg-gray-100">{selectedCount === candidates.length ? "全不选" : "全选"}</button>}
          </div>

          {candidates.length === 0 && <p className="text-sm text-gray-600 mb-4">没有找到可直接核对的具体地点。你可以手动添加一个名称，再用地图核对。</p>}

          <div className="space-y-4 mb-4">
            {CATEGORY_ORDER.filter((category) => candidates.some((candidate) => (candidate.category || "其他") === category)).map((category) => {
              const group = candidates
                .filter((candidate) => (candidate.category || "其他") === category)
                .sort((a, b) => Number(b.selected && b.mapVerification?.status !== "matched") - Number(a.selected && a.mapVerification?.status !== "matched"));
              const selectedInGroup = group.filter((candidate) => candidate.selected).length;
              return <div key={category}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${CATEGORY_STYLE[category] || CATEGORY_STYLE["其他"]}`}>{category} {selectedInGroup}/{group.length}</span>
                  <button onClick={() => setCategory(category, selectedInGroup !== group.length)} className="text-xs text-gray-600 hover:text-gray-900">{selectedInGroup === group.length ? "全不选" : "全选本类"}</button>
                </div>
                <div className="space-y-2">
                  {group.map((candidate) => <article id={`candidate-card-${candidate.id}`} key={candidate.id} className={`rounded-xl border p-3 transition-colors ${candidate.selected ? "bg-white border-blue-300 shadow-sm" : "bg-gray-50 border-gray-300"}`}>
                    <div className="flex items-start gap-3">
                      <input aria-label={`选择 ${candidate.name || "地点"}`} type="checkbox" checked={candidate.selected} onChange={() => toggle(candidate.id)} className="mt-2 h-4 w-4 accent-blue-700" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <label className="sr-only" htmlFor={`candidate-${candidate.id}`}>地点名称</label>
                          <input id={`candidate-${candidate.id}`} value={candidate.name} onChange={(event) => updateName(candidate.id, event.target.value)} className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-600" />
                          <button onClick={() => removeCandidate(candidate.id)} className="text-xs text-gray-600 hover:text-red-700">移除</button>
                        </div>
                        {candidate.evidence ? <p className="mt-2 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-2 text-xs text-amber-950"><span className="font-semibold">帖子原文：</span>“{candidate.evidence}”</p> : <p className="mt-2 text-xs text-violet-800">手动添加：没有帖子原文证据，需用地图确认名称和城市。</p>}
                        {candidate.aliasInPost && <p className="mt-1 text-xs text-gray-600">帖子别名：“{candidate.aliasInPost}”</p>}
                        <div className="mt-2 text-xs">
                          <span className={candidate.mapVerification?.status === "matched" ? "text-emerald-800" : candidate.mapVerification?.status === "not-found" ? "text-red-800" : "text-gray-600"}>{verificationLabel(candidate)}</span>
                          {candidate.mapVerification?.status === "matched" && <span className="text-gray-700">：{candidate.mapVerification.matchedName}{candidate.mapVerification.address ? ` · ${candidate.mapVerification.address}` : ""}</span>}
                          {candidate.mapVerification?.status === "not-found" && <span className="text-red-800">：请检查城市或名称，改名后重新核对。</span>}
                        </div>
                      </div>
                    </div>
                  </article>)}
                </div>
              </div>;
            })}
          </div>

          <div className="mb-3 rounded-2xl border-2 border-blue-300 bg-blue-50 p-4 shadow-sm">
            <label htmlFor="manual-place" className="mb-2 block text-sm font-semibold text-blue-950">还有其他想去的地点？</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input id="manual-place" value={manualName} onChange={(event) => setManualName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addManual(); }} placeholder="输入地点名称" className="flex-1 px-4 py-3 rounded-xl border border-blue-300 bg-white text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm" />
              <button onClick={addManual} disabled={!manualName.trim()} className="rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-50">添加地点</button>
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm font-medium text-gray-900">已选 {selectedCount} 个，已地图核对 {verifiedCount} 个</p>
            <p className="text-xs text-gray-600 mt-1">地图匹配展示的是高德返回的实体名称与地址；请确认它确实是你想去的地方。</p>
            {unverifiedSelected.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" role="status">
                <p className="font-medium">还有 {unverifiedSelected.length} 个已选地点尚未通过地图核对</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {unverifiedSelected.map((candidate) => (
                    <button
                      key={candidate.id}
                      type="button"
                      onClick={() => document.getElementById(`candidate-card-${candidate.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
                      className="rounded-full border border-amber-400 bg-white px-2.5 py-1 text-xs text-amber-950 hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                    >
                      {candidate.name} · {verificationLabel(candidate)}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs">请改名或取消选择后重新核对；在它处理完成前，不会保存一个缺项的帖子清单。</p>
              </div>
            )}
            <button onClick={verifySelected} disabled={verifyLoading || selectedCount === 0} className="mt-3 w-full py-2.5 rounded-lg border border-blue-700 bg-white text-blue-800 font-medium hover:bg-blue-50 disabled:opacity-50">
              {verifyLoading ? "正在用地图核对…" : "核对已选地点"}
            </button>
            <button onClick={handleSave} disabled={!canSave} className="mt-2 w-full py-3 rounded-xl btn-route font-semibold shadow-lg disabled:opacity-50">
              {canSave ? `保存已核对的 ${verifiedCount} 个地点` : `请先处理 ${unverifiedSelected.length} 个待核对地点`}
            </button>
          </div>

          {savedId && <div className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4 pb-24 text-sm text-emerald-950">
            已保存 {verifiedCount} 个已核对地点。下一步入口已固定在屏幕底部，不需要再往下找。
          </div>}
        </section>
      )}
      {savedId && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-emerald-200 bg-white/95 p-3 shadow-[0_-8px_24px_rgba(23,36,43,0.12)] backdrop-blur">
          <div className="mx-auto flex max-w-2xl items-center gap-3 px-1">
            <p className="hidden flex-1 text-sm text-emerald-900 sm:block">已保存 {verifiedCount} 个已核对地点</p>
            <button onClick={() => router.push(`/plan/from-post?id=${savedId}`)} className="flex-1 rounded-xl bg-emerald-700 py-3 font-semibold text-white hover:bg-emerald-800 sm:flex-none sm:px-6">
              下一步：补充偏好与出行信息
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
