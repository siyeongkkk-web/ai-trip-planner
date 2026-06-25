import { TripPlan, POICollection } from "./types";

const STORAGE_KEY = "ai-trip-planner-history";
const POI_KEY = "ai-trip-planner-poi-collections";

export function savePlan(plan: TripPlan): void {
  const history = getHistory();
  const existing = history.findIndex((p) => p.id === plan.id);
  if (existing >= 0) {
    history[existing] = plan;
  } else {
    history.unshift(plan);
  }
  if (history.length > 20) history.pop();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

export function getHistory(): TripPlan[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function deletePlan(id: string): void {
  const history = getHistory().filter((p) => p.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

export function clearHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// ===== 新架构：POI 候选集存储 =====

export function savePOICollection(collection: POICollection): void {
  const all = getPOICollections();
  const existing = all.findIndex((c) => c.id === collection.id);
  if (existing >= 0) {
    all[existing] = collection;
  } else {
    all.unshift(collection);
  }
  if (all.length > 20) all.pop();
  localStorage.setItem(POI_KEY, JSON.stringify(all));
}

export function getPOICollections(): POICollection[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(POI_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function getPOICollection(id: string): POICollection | undefined {
  return getPOICollections().find((c) => c.id === id);
}
