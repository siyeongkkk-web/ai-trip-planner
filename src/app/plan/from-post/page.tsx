"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import TripForm from "@/components/TripForm";
import { POICollection, TripInput, TripPlan } from "@/lib/types";
import { getPOICollection, savePlan } from "@/lib/storage";
import { getSelectedSavedCandidateCount, getUsableSavedCandidates, sourcePOIFromCandidate } from "@/lib/poi-source";

function FromPostContent() {
  const router = useRouter();
  const params = useSearchParams();
  const [collection, setCollection] = useState<POICollection | null | undefined>(undefined);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setCollection(getPOICollection(params.get("id") || "") || null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [params]);

  const createDraft = (input: TripInput) => {
    if (!collection) return;
    const usableCandidates = getUsableSavedCandidates(collection);
    const plan: TripPlan = {
      id: crypto.randomUUID(),
      destination: input.destination,
      departureCity: input.departureCity,
      days: input.days,
      preferences: input.preferences,
      hotelPreferences: input.hotelPreferences,
      foodPreferences: input.foodPreferences,
      breakfastHabit: input.breakfastHabit,
      createdAt: new Date().toISOString(),
      startDate: input.startDate,
      endDate: input.endDate,
      publicTransportTaxiThreshold: input.publicTransportTaxiThreshold,
      travelers: input.travelers,
      sourcePOICollectionId: collection.id,
      sourcePOIs: usableCandidates.map(sourcePOIFromCandidate),
      status: "draft",
      dailyPlans: [],
    };
    savePlan(plan);
    router.push(`/plan/transport?id=${plan.id}`);
  };

  if (collection === undefined) return <p className="p-6 text-gray-500">正在读取已保存地点…</p>;
  if (!collection) return <p className="p-6 text-gray-500">没有找到地点清单，请先回到提取页保存地点。</p>;
  if (!collection.city) return <p className="p-6 text-gray-500">这份地点清单缺少城市，请回到提取页确认城市。</p>;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
      <button onClick={() => router.push("/extract")} className="mb-4 text-sm text-gray-600 hover:text-gray-900">返回地点清单</button>
      <h1 className="text-2xl font-bold text-gray-900">补充旅行偏好</h1>
      <p className="mb-5 mt-1 text-sm text-gray-600">确认日期和偏好，继续选择交通与酒店。</p>
      <TripForm
        key={collection.id}
        initialDestination={collection.city}
        sourceSummary={{ count: getSelectedSavedCandidateCount(collection), city: collection.city }}
        sourceCollection={collection}
        onSubmit={createDraft}
        loading={false}
      />
    </main>
  );
}

export default function FromPostPage() {
  return <Suspense fallback={<p className="p-6 text-gray-500">加载中…</p>}><FromPostContent /></Suspense>;
}
