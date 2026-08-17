"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import TransportSetup from "@/components/TransportSetup";
import PlanningSteps from "@/components/PlanningSteps";
import { getHistory } from "@/lib/storage";
import { TripPlan } from "@/lib/types";

function Content() {
  const params = useSearchParams();
  const router = useRouter();
  const [plan, setPlan] = useState<TripPlan | null>();
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const found = getHistory().find((item) => item.id === params.get("id"));
      setPlan(found || null);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [params]);
  if (plan === undefined) return <p className="text-gray-400">加载中…</p>;
  if (!plan) return <p className="text-gray-400">行程不存在或已被清除</p>;
  return (
    <main className="flow-page flex-1">
      <div className="flow-shell">
      <PlanningSteps current="transport" planId={plan.id} hasGeneratedItinerary={plan.dailyPlans.length > 0} />
      <button onClick={() => router.push(`/?id=${plan.id}`)} className="flow-back">← 返回旅行信息</button>
      <TransportSetup plan={plan} />
      </div>
    </main>
  );
}

export default function TransportPage() {
  return <Suspense fallback={<p className="p-6 text-gray-400">加载中…</p>}><Content /></Suspense>;
}
