"use client";

import { useState } from "react";
import { TripInput, PREFERENCE_OPTIONS, DAY_OPTIONS } from "@/lib/types";

interface Props {
  onSubmit: (input: TripInput) => void;
  loading: boolean;
}

export default function TripForm({ onSubmit, loading }: Props) {
  const [departureCity, setDepartureCity] = useState("");
  const [destination, setDestination] = useState("");
  const [days, setDays] = useState<number>(3);
  const [customDays, setCustomDays] = useState("");
  const [isCustom, setIsCustom] = useState(false);
  const [selectedPrefs, setSelectedPrefs] = useState<string[]>([]);
  const [arrivalTime, setArrivalTime] = useState("");
  const [departureTime, setDepartureTime] = useState("");
  const [showMore, setShowMore] = useState(false);

  const togglePref = (label: string) => {
    setSelectedPrefs((prev) =>
      prev.includes(label) ? prev.filter((p) => p !== label) : [...prev, label]
    );
  };

  const handleSubmit = () => {
    const finalDays = isCustom ? parseInt(customDays, 10) : days;
    if (!destination.trim() || !departureCity.trim()) return;
    if (!finalDays || finalDays < 1 || finalDays > 14) return;
    onSubmit({
      destination: destination.trim(),
      departureCity: departureCity.trim(),
      days: finalDays,
      preferences: selectedPrefs,
      arrivalTime: arrivalTime || undefined,
      departureTime: departureTime || undefined,
    });
  };

  const finalDays = isCustom ? parseInt(customDays, 10) : days;
  const isValid =
    destination.trim() && departureCity.trim() && finalDays >= 1 && finalDays <= 14;

  return (
    <div className="w-full max-w-lg mx-auto space-y-5">
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
            className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow text-base"
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
            className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow text-base"
            onKeyDown={(e) => {
              if (e.key === "Enter" && isValid && !loading) handleSubmit();
            }}
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
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
          {isCustom && (
            <input
              type="number"
              min={1}
              max={14}
              value={customDays}
              onChange={(e) => setCustomDays(e.target.value)}
              placeholder="天数"
              className="w-20 px-3 py-2 rounded-full border border-gray-200 text-sm text-gray-900 text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          )}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          偏好（可选）
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

      {!showMore ? (
        <button
          onClick={() => setShowMore(true)}
          className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          + 设置到达/离开时间（可选）
        </button>
      ) : (
        <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              第一天几点到？
            </label>
            <select
              value={arrivalTime}
              onChange={(e) => setArrivalTime(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">默认早上出发</option>
              <option value="08:00">上午 08:00</option>
              <option value="10:00">上午 10:00</option>
              <option value="12:00">中午 12:00</option>
              <option value="14:00">下午 14:00</option>
              <option value="16:00">下午 16:00</option>
              <option value="18:00">傍晚 18:00</option>
              <option value="20:00">晚上 20:00</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              最后一天几点走？
            </label>
            <select
              value={departureTime}
              onChange={(e) => setDepartureTime(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">默认玩到晚上</option>
              <option value="10:00">上午 10:00</option>
              <option value="12:00">中午 12:00</option>
              <option value="14:00">下午 14:00</option>
              <option value="16:00">下午 16:00</option>
              <option value="18:00">傍晚 18:00</option>
              <option value="20:00">晚上 20:00</option>
            </select>
          </div>
        </div>
      )}

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
