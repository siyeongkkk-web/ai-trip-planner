"use client";

import { DayPlan, AdjustAction } from "@/lib/types";
import ActivityCard from "./ActivityCard";
import TransportCard from "./TransportCard";

interface Props {
  dayPlan: DayPlan;
  dayIndex: number;
  city: string;
  onAdjust?: (dayIndex: number, blockId: string, action: AdjustAction) => void;
  adjustingBlockId?: string | null;
}

export default function Timeline({ dayPlan, dayIndex, city, onAdjust, adjustingBlockId }: Props) {
  return (
    <div className="space-y-1">
      {dayPlan.blocks.map((block) => {
        if (block.type === "activity") {
          return (
            <ActivityCard
              key={block.id}
              block={block}
              city={city}
              onAdjust={
                onAdjust ? (action) => onAdjust(dayIndex, block.id, action) : undefined
              }
              adjusting={adjustingBlockId === block.id}
            />
          );
        }
        return <TransportCard key={block.id} block={block} />;
      })}

      {dayPlan.dailyBudget && (
        <div className="mt-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 text-center font-medium">
          💰 当日预估花费：{dayPlan.dailyBudget}
        </div>
      )}
    </div>
  );
}
