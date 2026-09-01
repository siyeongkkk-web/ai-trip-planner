import { PlanningReadinessReport } from "@/lib/types";

export default function PlanningReadinessCard({ report }: { report: PlanningReadinessReport }) {
  const actionableItems = report.items.filter((item) => item.status !== "ready");
  if (report.canStart && actionableItems.length === 0) return null;

  return (
    <section className={`rounded-xl border p-3 ${report.canStart ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`} aria-live="polite">
      <p className={`text-sm font-medium ${report.canStart ? "text-emerald-900" : "text-amber-950"}`}>
        {report.canStart ? "地点清单已准备好，可以继续填写" : "地点清单还需处理"}
      </p>
      {!!actionableItems.length && (
        <ul className="mt-2 space-y-1 text-xs text-gray-700">
          {actionableItems.map((item) => <li key={item.id}>· {item.title}</li>)}
        </ul>
      )}
    </section>
  );
}
