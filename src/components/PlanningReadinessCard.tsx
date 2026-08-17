import { PlanningReadinessReport } from "@/lib/types";

export default function PlanningReadinessCard({ report }: { report: PlanningReadinessReport }) {
  return (
    <section className="rounded-xl border border-indigo-200 bg-indigo-50 p-4" aria-live="polite">
      <h2 className="text-sm font-semibold text-indigo-950">规划前准备度</h2>
      <p className="mt-1 text-xs leading-5 text-indigo-900">{report.summary}</p>
      <ul className="mt-3 space-y-2">
        {report.items.map((item) => (
          <li key={item.id} className="rounded-lg border border-indigo-100 bg-white px-3 py-2">
            <p className="text-xs font-medium text-gray-900">
              {item.status === "blocked" ? "需补齐 · " : item.status === "attention" ? "待确认 · " : "已就绪 · "}
              {item.title}
            </p>
            <p className="mt-1 text-xs leading-5 text-gray-600">{item.detail}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
