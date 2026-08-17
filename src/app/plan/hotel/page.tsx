"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import HotelSetup from "@/components/HotelSetup";
import PlanningSteps from "@/components/PlanningSteps";
import { getHistory } from "@/lib/storage";
import { TripPlan } from "@/lib/types";

function Content() {
  const params = useSearchParams();
  const router = useRouter();
  const [plan, setPlan] = useState<TripPlan | null | undefined>(undefined);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const found = getHistory().find((item) => item.id === params.get("id"));
      if (found && (!found.outboundTransport || !found.returnTransport)) {
        router.replace(`/plan/transport?id=${found.id}`);
        return;
      }
      setPlan(found || null);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [params, router]);
  if (plan === undefined) return <p className="p-6 text-gray-400">加载中…</p>;
  if (!plan) return <p className="p-6 text-gray-400">行程不存在或已被清除</p>;
  if (!plan.outboundTransport || !plan.returnTransport) return null;
  return (
    <main className="flow-page flex-1">
      <div className="flow-shell">
      <PlanningSteps current="hotel" planId={plan.id} hasGeneratedItinerary={plan.dailyPlans.length > 0} />
      <button onClick={() => router.push(`/plan/transport?id=${plan.id}`)} className="flow-back">← 返回交通选择</button>
      <HotelSetup plan={plan} />
      </div>
    </main>
  );
}

export default function HotelPage() {
  return <Suspense fallback={<p className="p-6 text-gray-400">加载中…</p>}><Content /></Suspense>;
}
