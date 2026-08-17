import { AdjustOperationResult } from "@/lib/types";

const ACTION_LABELS: Record<AdjustOperationResult["action"], string> = {
  remove: "删除活动",
  extend: "延长停留",
  replace: "替换活动",
  add: "新增活动",
  move: "移动活动",
};

export default function AdjustmentReceipt({ result }: { result: AdjustOperationResult }) {
  const applied = result.status === "applied";

  return (
    <section
      aria-live="polite"
      className={`mt-4 rounded-xl border p-4 ${
        applied
          ? "border-emerald-300 bg-emerald-50 text-emerald-950"
          : "border-amber-300 bg-amber-50 text-amber-950"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide opacity-70">最近一次调整回执</p>
          <h2 className="mt-1 text-sm font-semibold">
            {applied ? "已更新行程" : "未修改行程"} · {ACTION_LABELS[result.action]}
          </h2>
        </div>
        <span className="rounded-full border border-current/20 bg-white/70 px-2.5 py-1 text-xs font-medium">
          版本 {result.baseRevision} → {result.nextRevision}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6">{result.message}</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
        <div className="rounded-lg bg-white/75 p-2.5">
          <dt className="opacity-65">发生变化</dt>
          <dd className="mt-0.5 font-semibold">{result.changedBlockIds.length} 个行程块</dd>
        </div>
        <div className="rounded-lg bg-white/75 p-2.5">
          <dt className="opacity-65">保持不变</dt>
          <dd className="mt-0.5 font-semibold">{result.unchangedBlockIds.length} 个受保护活动</dd>
        </div>
        <div className="col-span-2 rounded-lg bg-white/75 p-2.5 sm:col-span-1">
          <dt className="opacity-65">写入状态</dt>
          <dd className="mt-0.5 font-semibold">{applied ? "已通过事务验收" : "未写入"}</dd>
        </div>
      </dl>
    </section>
  );
}
