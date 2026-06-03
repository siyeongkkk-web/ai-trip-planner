"use client";

import { useState } from "react";
import { PREFERENCE_OPTIONS, DAY_OPTIONS } from "@/lib/types";

interface Props {
  onSubmit: (destination: string, days: number, preferences: string[]) => void;
  loading: boolean;
}

export default function TripForm({ onSubmit, loading }: Props) {
  const [destination, setDestination] = useState("");
  const [days, setDays] = useState<number>(3);
  const [customDays, setCustomDays] = useState("");
  const [isCustom, setIsCustom] = useState(false);
  const [selectedPrefs, setSelectedPrefs] = useState<string[]>([]);

  const togglePref = (label: string) => {
    setSelectedPrefs((prev) =>
      prev.includes(label) ? prev.filter((p) => p !== label) : [...prev, label]
    );
  };

  const handleSubmit = () => {
    const finalDays = isCustom ? parseInt(customDays, 10) : days;
    if (!destination.trim()) return;
    if (!finalDays || finalDays < 1 || finalDays > 14) return;
    onSubmit(destination.trim(), finalDays, selectedPrefs);
  };

  const finalDays = isCustom ? parseInt(customDays, 10) : days;
  const isValid = destination.trim() && finalDays >= 1 && finalDays <= 14;

  return (
    <div className="w-full max-w-lg mx-auto space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          去哪里？
        </label>
        <input
          type="text"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder="输入目的地，如：成都、北京、大理..."
          className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow text-base"
          onKeyDown={(e) => {
            if (e.key === "Enter" && isValid && !loading) handleSubmit();
          }}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          玩几天？
        </label>
        <div className="flex flex-wrap gap-2">
          {DAY_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => {
                setDays(d);
                setIsCustom(false);
              }}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                !isCustom && days === d
                  ? "bg-blue-600 text-white shadow-md"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {d}天
            </button>
          ))}
          <button
            onClick={() => setIsCustom(true)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
              isCustom
                ? "bg-blue-600 text-white shadow-md"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            自定义
          </button>
        </div>
        {isCustom && (
          <input
            type="number"
            min={1}
            max={14}
            value={customDays}
            onChange={(e) => setCustomDays(e.target.value)}
            placeholder="输入天数 (1-14)"
            className="mt-2 w-32 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          偏好（可选，选你喜欢的）
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

      <button
        onClick={handleSubmit}
        disabled={!isValid || loading}
        className="w-full py-3.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold text-base shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-lg"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            AI 正在规划中...
          </span>
        ) : (
          "生成我的行程 ✨"
        )}
      </button>
    </div>
  );
}
