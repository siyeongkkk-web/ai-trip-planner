"use client";

import { TransportBlock } from "@/lib/types";

const MODE_INFO: Record<string, { icon: string; label: string }> = {
  walking: { icon: "🚶", label: "步行" },
  subway: { icon: "🚇", label: "地铁" },
  bus: { icon: "🚌", label: "公交" },
  taxi: { icon: "🚕", label: "打车" },
  train: { icon: "🚄", label: "高铁" },
};

interface Props {
  block: TransportBlock;
}

export default function TransportCard({ block }: Props) {
  const info = MODE_INFO[block.mode] || { icon: "🚗", label: "交通" };

  return (
    <div className="flex items-center gap-3 py-2 px-4 mx-4">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm">
        {info.icon}
      </div>
      <div className="flex-1 border-t border-dashed border-gray-300" />
      <div className="flex items-center gap-2 text-xs text-gray-500 flex-shrink-0">
        <span>{info.label}</span>
        <span>{block.duration}</span>
        {block.cost && block.cost !== "¥0" && block.cost !== "0" && (
          <span className="text-gray-400">{block.cost}</span>
        )}
      </div>
      <div className="flex-1 border-t border-dashed border-gray-300" />
    </div>
  );
}
