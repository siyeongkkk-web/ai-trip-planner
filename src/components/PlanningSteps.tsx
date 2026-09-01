import Link from "next/link";

type Step = "trip" | "transport" | "hotel" | "itinerary";

const STEPS: { id: Step; label: string }[] = [
  { id: "trip", label: "旅行信息" },
  { id: "transport", label: "往返交通" },
  { id: "hotel", label: "确认酒店" },
  { id: "itinerary", label: "行程" },
];

const STEP_INDEX: Record<Step, number> = {
  trip: 0,
  transport: 1,
  hotel: 2,
  itinerary: 3,
};

interface Props {
  current: Step;
  planId?: string;
  hasGeneratedItinerary?: boolean;
}

export default function PlanningSteps({ current, planId, hasGeneratedItinerary = false }: Props) {
  const currentIndex = STEP_INDEX[current];

  return (
    <nav aria-label="规划进度" className="planning-steps mb-5">
      <ol className="grid grid-cols-4 gap-0">
        {STEPS.map((step, index) => {
          const isCurrent = index === currentIndex;
          const isComplete = index < currentIndex;
          const canVisit = Boolean(
            planId && (isComplete || (step.id === "itinerary" && hasGeneratedItinerary))
          );
          const label = (
            <>
              <span className={`step-dot mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs font-black ${
                isCurrent
                  ? "is-current"
                  : isComplete
                    ? "is-complete"
                    : "is-upcoming"
              }`}>
                {isComplete ? "✓" : index + 1}
              </span>
              <span className={`mt-1 block truncate text-center text-[11px] sm:text-xs ${
                isCurrent ? "font-semibold text-[color:var(--route-deep)]" : "text-gray-500"
              }`}>
                {step.label}
              </span>
            </>
          );

          return (
            <li key={step.id} aria-current={isCurrent ? "step" : undefined}>
              {canVisit ? (
                <Link
                  href={step.id === "trip" ? `/?id=${planId}` : step.id === "transport" ? `/plan/transport?id=${planId}` : step.id === "hotel" ? `/plan/hotel?id=${planId}` : `/plan?id=${planId}`}
                  className="block rounded-lg py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--route)]"
                  aria-label={step.id === "itinerary" ? "返回已生成行程" : undefined}
                >
                  {label}
                </Link>
              ) : (
                <div className="relative z-10 py-1">{label}</div>
              )}
            </li>
          );
        })}
      </ol>
      <div className="step-landmarks" aria-hidden="true">
        <span className="step-landmark step-landmark--train"><i /><b /><b /></span>
        <svg className="step-landmark step-landmark--hotel" viewBox="0 0 36 32" focusable="false">
          <path className="hotel-roof" d="M3 15 18 3l15 12" />
          <path className="hotel-house" d="M6 13v16h24V13" />
          <path className="hotel-door" d="M14 29V19h8v10" />
          <path className="hotel-window" d="M25 18h3v4h-3z" />
        </svg>
        <span className="step-landmark step-landmark--flag"><i /><b /></span>
      </div>
      <p className="sr-only">当前步骤：{STEPS[currentIndex].label}。已完成的步骤可以返回查看。</p>
    </nav>
  );
}
