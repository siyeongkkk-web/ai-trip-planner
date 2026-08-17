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
    <section className="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-4" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-sky-950">出行更新检查</h2>
          <p className="mt-1 text-xs leading-5 text-sky-900">
            {loading
              ? "正在读取高德天气与当前日期首个已核对地点周边路况…"
              : report?.summary || "检查天气和区域交通态势；只产出待确认项，不会自动改行程。"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void checkUpdates()}
          disabled={loading}
          className="shrink-0 rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-xs font-medium text-sky-800 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "检查中…" : "检查当前日期"}
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
              <p className="mt-1 text-xs leading-5 text-gray-600">{issue.detail}</p>
              <button
                type="button"
                onClick={() => onOpenAssistant(issue.suggestedPrompt)}
                className="mt-2 text-xs font-medium text-sky-700 underline underline-offset-2 hover:text-sky-900"
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
