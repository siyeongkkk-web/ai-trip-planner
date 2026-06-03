"use client";

import { DayPlan, AdjustAction } from "@/lib/types";
import ActivityCard from "./ActivityCard";
import TransportCard from "./TransportCard";

interface Props {
  dayPlan: DayPlan;
  dayIndex: number;
  onAdjust?: (dayIndex: number, blockId: string, action: AdjustAction) => void;
  adjustingBlockId?: string | null;
}

export default function Timeline({ dayPlan, dayIndex, onAdjust, adjustingBlockId }: Props) {
  return (
    <div className="space-y-1">
      {dayPlan.blocks.map((block) => {
        if (block.type === "activity") {
          return (
            <ActivityCard
              key={block.id}
              block={block}
              onAdjust={
                onAdjust ? (action) => onAdjust(dayIndex, block.id, action) : undefined
              }
              adjusting={adjustingBlockId === block.id}
            />
          );
        }
        return <TransportCard key={block.id} block={block} />;
      })}
    </div>
  );
}
