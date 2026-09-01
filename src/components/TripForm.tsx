"use client";

import { useMemo, useState } from "react";
import {
  BreakfastHabit,
  FoodPreference,
  HotelPreference,
  TripInput,
  TripPlan,
  POICollection,
  PREFERENCE_OPTIONS,
} from "@/lib/types";
import { buildPlanningReadinessReport } from "@/lib/planning-readiness";
import PlanningReadinessCard from "./PlanningReadinessCard";

const HOTEL_PREFERENCES: HotelPreference[] = [
  "卫生优先",
  "安全优先",
  "舒适",
  "经济",
  "高端",
  "安静",
  "交通便利",
  "连锁",
  "特色",
];

const FOOD_PREFERENCES: FoodPreference[] = [
  "当地本土菜",
  "老字号/名店",
  "稀有特色餐厅",
  "北方口味",
  "南方口味",
  "西南口味",
  "西北口味",
  "东北口味",
  "国外风味",
];

interface Props {
  onSubmit: (input: TripInput) => void;
  loading: boolean;
  initialDestination?: string;
  sourceSummary?: { count: number; city: string };
  sourceCollection?: POICollection;
  compact?: boolean;
  initialPlan?: TripPlan;
}

export default function TripForm({ onSubmit, loading, initialDestination = "", sourceSummary, sourceCollection, compact = false, initialPlan }: Props) {
  const [departureCity, setDepartureCity] = useState(initialPlan?.departureCity || "");
  const [destination, setDestination] = useState(initialPlan?.destination || initialDestination);
  const [selectedPrefs, setSelectedPrefs] = useState<string[]>(initialPlan?.preferences || []);
  const [hotelPreferences, setHotelPreferences] = useState<HotelPreference[]>([
    ...(initialPlan?.hotelPreferences || ["卫生优先", "安全优先"]),
  ]);
  const [foodPreferences, setFoodPreferences] = useState<FoodPreference[]>([
    ...(initialPlan?.foodPreferences || ["当地本土菜", "老字号/名店"]),
  ]);
  const [breakfastHabit, setBreakfastHabit] =
    useState<BreakfastHabit>(initialPlan?.breakfastHabit || "每天吃");
  const [startDate, setStartDate] = useState(initialPlan?.startDate || "");
  const [endDate, setEndDate] = useState(initialPlan?.endDate || "");
  const [publicTransportTaxiThreshold, setPublicTransportTaxiThreshold] =
    useState(initialPlan?.publicTransportTaxiThreshold || 60);
  const [travelers, setTravelers] = useState(initialPlan?.travelers || 1);

  const getDays = () => {
    if (!startDate || !endDate) return 0;
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);
    return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  };

  const togglePref = (label: string) => {
    setSelectedPrefs((prev) =>
      prev.includes(label) ? prev.filter((p) => p !== label) : [...prev, label]
    );
  };

  const toggleHotelPreference = (value: HotelPreference) => {
    setHotelPreferences((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value]
    );
  };

  const toggleFoodPreference = (value: FoodPreference) => {
    setFoodPreferences((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value]
    );
  };

  const handleSubmit = () => {
    const finalDays = getDays();
    if (!destination.trim() || !departureCity.trim()) return;
    if (!finalDays || finalDays < 1 || finalDays > 14) return;
    onSubmit({
      destination: destination.trim(),
      departureCity: departureCity.trim(),
      days: finalDays,
      preferences: selectedPrefs,
      hotelPreferences,
      foodPreferences,
      breakfastHabit,
      startDate,
      endDate,
      publicTransportTaxiThreshold,
      travelers,
    });
  };

  const finalDays = getDays();
  const readiness = useMemo(
    () => sourceCollection ? buildPlanningReadinessReport(sourceCollection, finalDays || undefined) : null,
    [sourceCollection, finalDays]
  );
  const isValid =
    destination.trim() &&
    departureCity.trim() &&
    startDate &&
    endDate &&
    travelers >= 1 &&
    finalDays >= 1 &&
    finalDays <= 14 &&
    (readiness?.canStart ?? true);

  return (
    <div className="w-full max-w-lg mx-auto space-y-5">
      {sourceSummary && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
          已导入 {sourceSummary.count} 个地点 · {sourceSummary.city}
        </div>
      )}
      {readiness && <PlanningReadinessCard report={readiness} />}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            从哪出发？
          </label>
          <input
            type="text"
            value={departureCity}
            onChange={(e) => setDepartureCity(e.target.value)}
            placeholder="如：北京、上海..."
            className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent transition-shadow text-base"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            去哪玩？
          </label>
          <input
            type="text"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="如：成都、大理..."
            readOnly={Boolean(sourceSummary)}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent transition-shadow text-base"
            onKeyDown={(e) => {
              if (e.key === "Enter" && isValid && !loading) handleSubmit();
            }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            出发日期
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full px-3 py-3 rounded-xl border border-gray-200 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            返程日期
          </label>
          <input
            type="date"
            min={startDate || undefined}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full px-3 py-3 rounded-xl border border-gray-200 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
        </div>
        {finalDays > 0 && finalDays <= 14 && (
          <p className="col-span-2 text-xs text-teal-700">
            共 {finalDays} 天（含出发日和返程日）
          </p>
        )}
      </div>

      <details className={compact ? "group rounded-xl border border-gray-200 bg-gray-50" : "group"} open={!compact}>
        <summary className={compact ? "cursor-pointer list-none px-4 py-3 text-sm font-medium text-gray-800" : "sr-only"}>
          <span className="flex items-center justify-between">按需补充旅行偏好 <span aria-hidden="true" className="text-gray-400 group-open:rotate-180">⌄</span></span>
        </summary>
        <div className={compact ? "space-y-5 border-t border-gray-200 px-4 py-4" : "space-y-5"}>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          旅行风格（可选）
        </label>
        <div className="flex flex-wrap gap-2">
          {PREFERENCE_OPTIONS.map((pref) => (
            <button
              key={pref.label}
              onClick={() => togglePref(pref.label)}
              className={`px-3 py-1.5 rounded-full text-sm transition-all ${
                selectedPrefs.includes(pref.label)
                  ? "bg-blue-100 text-blue-700 border border-blue-300"
                  : "bg-gray-100 text-gray-600 border border-transparent hover:bg-gray-200"
              }`}
            >
              {pref.emoji} {pref.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          酒店偏好
        </label>
        <p className="mb-2 text-xs text-gray-500">
          用于推荐排序；卫生和安全仍需在携程结合近期点评复核。
        </p>
        <div className="flex flex-wrap gap-2">
          {HOTEL_PREFERENCES.map((preference) => (
            <button
              type="button"
              key={preference}
              onClick={() => toggleHotelPreference(preference)}
              className={`rounded-full border px-3 py-1.5 text-sm transition-all ${
                hotelPreferences.includes(preference)
                  ? "border-violet-300 bg-violet-100 text-violet-800"
                  : "border-transparent bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {preference}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          饮食偏好
        </label>
        <p className="mb-2 text-xs text-gray-500">
          行程会优先安排有明确店名的本地特色餐厅，避开泛化的“附近餐厅”。
        </p>
        <div className="flex flex-wrap gap-2">
          {FOOD_PREFERENCES.map((preference) => (
            <button
              type="button"
              key={preference}
              onClick={() => toggleFoodPreference(preference)}
              className={`rounded-full border px-3 py-1.5 text-sm transition-all ${
                foodPreferences.includes(preference)
                  ? "border-amber-300 bg-amber-100 text-amber-900"
                  : "border-transparent bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {preference}
            </button>
          ))}
        </div>
        <div className="mt-3">
          <p className="mb-1.5 text-xs text-gray-600">早餐习惯</p>
          <div className="grid grid-cols-3 gap-2">
            {(["每天吃", "偶尔吃", "不吃"] as BreakfastHabit[]).map((value) => (
              <button
                type="button"
                key={value}
                onClick={() => setBreakfastHabit(value)}
                className={`rounded-lg border px-2 py-2 text-sm ${
                  breakfastHabit === value
                    ? "border-amber-400 bg-white text-amber-900"
                    : "border-gray-200 bg-gray-50 text-gray-500"
                }`}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
        <label className="block text-xs text-gray-600">
          公交/地铁超过多少分钟时考虑打车？
          <div className="mt-1 flex items-center gap-3">
            <input
              type="range"
              min={30}
              max={120}
              step={10}
              value={publicTransportTaxiThreshold}
              onChange={(event) =>
                setPublicTransportTaxiThreshold(Number(event.target.value))
              }
              className="flex-1"
            />
            <span className="min-w-16 rounded-lg border border-gray-200 bg-white px-2 py-2 text-center text-sm text-gray-900">
              {publicTransportTaxiThreshold}分钟
            </span>
          </div>
          <span className="mt-1 block text-[11px] text-gray-500">
            达到阈值后会同时比较打车耗时；只有明显更快时才默认推荐打车。
          </span>
        </label>
        <div>
          <label className="block text-xs text-gray-600 mb-1">出行人数</label>
          <input
            type="number"
            min={1}
            max={20}
            value={travelers}
            onChange={(e) => setTravelers(Math.max(1, Number(e.target.value) || 1))}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
        </div>
      </div>
        </div>
      </details>

      <button
        onClick={handleSubmit}
        disabled={!isValid || loading}
        className="w-full py-3.5 rounded-xl btn-route font-semibold text-base shadow-lg"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            正在创建规划...
          </span>
        ) : (
          "先选择往返交通 →"
        )}
      </button>
    </div>
  );
}
