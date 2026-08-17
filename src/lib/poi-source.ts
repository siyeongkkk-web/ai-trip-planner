import { POICandidate, POICollection, SourcePOI } from "./types";

function normalizeSourceText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * 用户修改地点名后，旧地图实体已经不能再证明新名称对应同一地点。
 * 保留候选身份与选择状态，但必须清空核验结果，等待用户重新核对。
 */
export function renameCandidateAndInvalidateVerification(
  candidate: POICandidate,
  name: string
): POICandidate {
  return {
    ...candidate,
    name,
    manual: true,
    mapVerification: undefined,
  };
}

/**
 * 进入“来自帖子清单”的地点必须能回到用户保存的原文。
 * 手动补充是用户的明确选择，因此不要求原文证据；两类都必须已经地图核对。
 */
export function isSavedCandidateUsableForPlanning(candidate: POICandidate, rawText: string): boolean {
  if (!candidate.selected || candidate.mapVerification?.status !== "matched") return false;
  if (candidate.manual) return Boolean(candidate.name.trim());

  const source = normalizeSourceText(rawText);
  const name = normalizeSourceText(candidate.name);
  const evidence = normalizeSourceText(candidate.evidence || "");
  // 旧逻辑只要求 name 和 evidence 分别出现在正文里，可能把两段无关文字拼成“证据”。
  return Boolean(name && evidence && evidence.includes(name) && source.includes(evidence));
}

export function getUsableSavedCandidates(collection: POICollection): POICandidate[] {
  return collection.candidates.filter((candidate) =>
    isSavedCandidateUsableForPlanning(candidate, collection.rawText)
  );
}

export function getSelectedSavedCandidateCount(collection: POICollection): number {
  return collection.candidates.filter((candidate) => candidate.selected).length;
}

/** 保留用户保存原名；地图匹配名与坐标只能作为独立核对字段。 */
export function sourcePOIFromCandidate(candidate: POICandidate): SourcePOI {
  return {
    id: candidate.id,
    name: candidate.name,
    matchedName: candidate.mapVerification?.matchedName,
    address: candidate.mapVerification?.address,
    mapPOIId: candidate.mapVerification?.poiId,
    lng: candidate.mapVerification?.lng,
    lat: candidate.mapVerification?.lat,
    category: candidate.category,
    note: candidate.note,
    evidence: candidate.evidence,
    manual: candidate.manual,
  };
}

export function sourcePOIsFromCollection(collection: POICollection): SourcePOI[] {
  return getUsableSavedCandidates(collection).map(sourcePOIFromCandidate);
}
