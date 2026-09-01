"use client";

import { useCallback, useRef, useState } from "react";
import { TravelUpdateReport, TripPlan } from "@/lib/types";

type Props = {
  plan: TripPlan;
  activeDay: number;
  onOpenAssistant: (prompt: string) => void;
};

export default function TravelUpdatePanel({ plan, activeDay, onOpenAssistant }: Props) {
  const [report, setReport] = useState<TravelUpdateReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const checkUpdates = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/travel-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, dayIndex: activeDay }),
      });
      const data = (await response.json()) as TravelUpdateReport & { error?: string };
      if (!response.ok) throw new Error(data.error || "出行更新检查失败。");
      if (sequence === requestSequence.current) setReport(data);
    } catch (requestError) {
      if (sequence === requestSequence.current) {
        setError(requestError instanceof Error ? requestError.message : "出行更新检查失败。");
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [activeDay, plan]);

  return (
    <section className="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-3" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-sky-950">天气与交通</h2>
          <p className="mt-1 text-xs text-sky-900">{loading ? "正在检查…" : report?.issues.length ? `${report.issues.length} 项需要确认` : "需要时可检查当天情况"}</p>
        </div>
        <button
          type="button"
          onClick={() => void checkUpdates()}
          disabled={loading}
          className="shrink-0 rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-xs font-medium text-sky-800 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "检查中…" : "检查当天"}
        </button>
      </div>
      {error && <p className="mt-3 text-xs text-red-700">{error}</p>}
      {!!report?.issues.length && (
        <ul className="mt-3 space-y-2">
          {report.issues.map((issue) => (
            <li key={issue.id} className="rounded-lg border border-sky-200 bg-white p-3">
              <p className="text-sm font-medium text-gray-900">
                {issue.severity === "risk" ? "需核对 · " : "待确认 · "}{issue.title}
              </p>
              <button
                type="button"
                onClick={() => onOpenAssistant(issue.suggestedPrompt)}
                className="mt-1.5 text-xs font-medium text-sky-700 underline underline-offset-2 hover:text-sky-900"
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
