"use client";

import { ActivityOption, DayPlan, AdjustAction } from "@/lib/types";
import ActivityCard from "./ActivityCard";
import TransportCard from "./TransportCard";
import ActivityChoicePanel from "./ActivityChoicePanel";

interface Props {
  dayPlan: DayPlan;
  dayIndex: number;
  city: string;
  onAdjust?: (dayIndex: number, blockId: string, action: AdjustAction) => void;
  onRequestReplace?: (dayIndex: number, blockId: string) => void;
  pendingChoice?: {
    dayIndex: number;
    blockId: string;
    title: string;
    action: "replace" | "add";
    options: ActivityOption[];
  } | null;
  onCloseChoice?: () => void;
  onChooseOption?: (option: ActivityOption) => void;
  onRecommendChoice?: () => void;
  recommendingChoice?: boolean;
  adjustingBlockId?: string | null;
  onCancelAdjust?: () => void;
  onConfirmTransport?: (blockId: string, mode: "subway" | "taxi") => void;
  confirmingTransportId?: string | null;
}

export default function Timeline({
  dayPlan,
  dayIndex,
  city,
  onAdjust,
  onRequestReplace,
  pendingChoice,
  onCloseChoice,
  onChooseOption,
  onRecommendChoice,
  recommendingChoice,
  adjustingBlockId,
  onCancelAdjust,
  onConfirmTransport,
  confirmingTransportId,
}: Props) {
  return (
    <div className="tl">
      {dayPlan.blocks.map((block, index) => {
        if (block.type === "activity") {
          return (
            <div key={`${block.id}-${index}`}>
              <div className="tl-row mb-2">
                <span className="tl-time tnum">{block.startTime}</span>
                <span className={`tl-dot ${/午餐|晚餐|早餐/.test(block.title) ? "tl-dot--meal" : ""}`} />
                <ActivityCard
                  block={block}
                  city={city}
                  timeline
                  onAdjust={
                    onAdjust ? (action) => onAdjust(dayIndex, block.id, action) : undefined
                  }
                  onRequestReplace={
                    onRequestReplace ? () => onRequestReplace(dayIndex, block.id) : undefined
                  }
                  adjusting={adjustingBlockId === block.id}
                  onCancelAdjust={onCancelAdjust}
                />
                <span className="tl-endtime tnum" aria-label={`活动结束时间 ${block.endTime}`}>
                  {block.endTime}
                </span>
              </div>
              {pendingChoice?.blockId === block.id && onCloseChoice && onChooseOption && onRecommendChoice && (
                <div className="mb-2 ml-[72px]">
                  <ActivityChoicePanel
                    title={pendingChoice.title}
                    options={pendingChoice.options}
                    busy={adjustingBlockId !== null}
                    recommending={recommendingChoice}
                    onClose={onCloseChoice}
                    onChoose={onChooseOption}
                    onRecommend={onRecommendChoice}
                  />
                </div>
              )}
            </div>
          );
        }
        return (
          <TransportCard
            key={`${block.id}-${index}-${block.mode}`}
            block={block}
            timeline
            onConfirm={onConfirmTransport}
            confirming={confirmingTransportId === block.id}
          />
        );
      })}
    </div>
  );
}
