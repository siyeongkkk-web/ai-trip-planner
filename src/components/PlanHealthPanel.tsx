"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PlanHealthIssue, PlanHealthReport, TripPlan } from "@/lib/types";

type Props = {
  plan: TripPlan;
  onOpenDay: (dayIndex: number) => void;
  onOpenSavedPlaces: () => void;
  onOpenAssistant: (prompt?: string) => void;
};

export default function PlanHealthPanel({ plan, onOpenDay, onOpenSavedPlaces, onOpenAssistant }: Props) {
  const [report, setReport] = useState<PlanHealthReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const checkPlan = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/plan-health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = (await response.json()) as PlanHealthReport & { error?: string };
      if (!response.ok) throw new Error(data.error || "行程检查失败。");
      if (sequence === requestSequence.current) setReport(data);
    } catch (requestError) {
      if (sequence === requestSequence.current) {
        setError(requestError instanceof Error ? requestError.message : "行程检查失败。");
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [plan]);

  useEffect(() => {
    const timer = window.setTimeout(() => void checkPlan(), 0);
    return () => window.clearTimeout(timer);
  }, [checkPlan]);

  const handleIssue = (issue: PlanHealthIssue) => {
    if (issue.action === "open-day" && issue.dayIndex !== undefined) onOpenDay(issue.dayIndex);
    if (issue.action === "open-saved-places") onOpenSavedPlaces();
    if (issue.action === "open-assistant") onOpenAssistant(issue.suggestedPrompt);
  };

  return (
    <section className="mb-4 rounded-xl border border-teal-200 bg-teal-50 p-3" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-teal-950">行程提醒</h2>
          <p className="mt-1 text-xs text-teal-900">{loading ? "正在检查…" : report?.issues.length ? `${report.issues.length} 项需要确认` : "暂未发现需要处理的问题"}</p>
        </div>
        <button
          type="button"
          onClick={() => void checkPlan()}
          disabled={loading}
          className="shrink-0 rounded-lg border border-teal-300 bg-white px-3 py-1.5 text-xs font-medium text-teal-800 hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "检查中…" : "刷新"}
        </button>
      </div>
      {error && <p className="mt-3 text-xs text-red-700">{error}</p>}
      {!!report?.issues.length && (
        <ul className="mt-3 space-y-2">
          {report.issues.map((issue) => (
            <li key={issue.id} className="rounded-lg border border-teal-200 bg-white p-3">
              <p className="text-sm font-medium text-gray-900">
                {issue.severity === "risk" ? "需核对 · " : "待确认 · "}{issue.title}
              </p>
              <button
                type="button"
                onClick={() => handleIssue(issue)}
                className="mt-1.5 text-xs font-medium text-teal-700 underline underline-offset-2 hover:text-teal-900"
              >
                {issue.actionLabel}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
