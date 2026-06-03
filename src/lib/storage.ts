import { TripPlan } from "./types";

const STORAGE_KEY = "ai-trip-planner-history";

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
