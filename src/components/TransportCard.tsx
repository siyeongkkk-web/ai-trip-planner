"use client";

import { useState } from "react";
import Image from "next/image";
import { TransportBlock } from "@/lib/types";
import { transportMapUrl } from "@/lib/place-utils";

const MODE_INFO: Record<string, { icon: string; label: string }> = {
  walking: { icon: "🚶", label: "步行" },
  subway: { icon: "🚇", label: "地铁" },
  bus: { icon: "🚌", label: "公交" },
  taxi: { icon: "🚕", label: "打车" },
  train: { icon: "🚄", label: "高铁" },
};

const MODE_ILLUSTRATIONS: Partial<Record<string, { src: string; alt: string }>> = {
  taxi: {
    src: "/illustrations/self-mocking-bear/transport-taxi.png",
    alt: "自嘲熊乘坐出租车",
  },
  subway: {
    src: "/illustrations/self-mocking-bear/transport-subway.png",
    alt: "自嘲熊在地铁里握着吊环",
  },
};

interface Props {
  block: TransportBlock;
  timeline?: boolean;
  onConfirm?: (blockId: string, mode: "subway" | "taxi") => void;
  confirming?: boolean;
}

export default function TransportCard({ block, timeline = false, onConfirm, confirming }: Props) {
  const switchable =
    block.alternatives?.some((item) => item.mode === "subway") &&
    block.alternatives?.some((item) => item.mode === "taxi");
  const recommendedMode = block.mode === "taxi" ? "taxi" : "subway";
  const [selectedMode, setSelectedMode] = useState<"subway" | "taxi">(recommendedMode);

  const selectedAlternative = switchable
    ? block.alternatives?.find((item) => item.mode === selectedMode)
    : undefined;
  const effectiveBlock: TransportBlock = selectedAlternative
    ? {
        ...block,
        mode: selectedAlternative.mode,
        duration: `${selectedAlternative.durationMinutes}分钟`,
        cost:
          selectedAlternative.estimatedCost !== undefined
            ? selectedAlternative.mode === "taxi" && selectedAlternative.estimatedCostHigh !== undefined
              ? `打车预估 ¥${Math.round(selectedAlternative.estimatedCost)}–${Math.round(selectedAlternative.estimatedCostHigh)}`
              : `¥${Math.round(selectedAlternative.estimatedCost)}`
            : block.cost,
        estimatedCostHigh: selectedAlternative.estimatedCostHigh,
        description: `${block.fromPlace} → ${block.toPlace}：${selectedAlternative.description}`,
        fromLng: selectedAlternative.fromLng ?? block.fromLng,
        fromLat: selectedAlternative.fromLat ?? block.fromLat,
        toLng: selectedAlternative.toLng ?? block.toLng,
        toLat: selectedAlternative.toLat ?? block.toLat,
      }
    : block;
  const info = MODE_INFO[effectiveBlock.mode] || { icon: "🚗", label: "交通" };
  const illustration = MODE_ILLUSTRATIONS[effectiveBlock.mode];
  const mapUrl = transportMapUrl(effectiveBlock);
  const otherMode = selectedMode === "taxi" ? "subway" : "taxi";
  const otherAlternative = block.alternatives?.find((item) => item.mode === otherMode);
  const hasUnconfirmedPreview = switchable && selectedMode !== recommendedMode;

  if (timeline) {
    const color = effectiveBlock.mode === "walking" ? "var(--mode-walk)" : effectiveBlock.mode === "taxi" ? "var(--mode-taxi)" : "var(--mode-subway)";
    return (
      <div className="tl-leg" style={{ ["--leg-color" as string]: color }}>
        {illustration ? (
          <span className="transport-bear-icon">
            <Image unoptimized src={illustration.src} alt={illustration.alt} width={54} height={46} />
          </span>
        ) : (
          <span>{info.icon}</span>
        )}
        <span className="tl-legtext">{effectiveBlock.description} · {effectiveBlock.duration}{effectiveBlock.mode === "taxi" && effectiveBlock.cost ? ` · ${effectiveBlock.cost}` : ""}</span>
        {switchable && otherAlternative && (
          <button type="button" onClick={() => setSelectedMode(otherMode)} className="ml-auto rounded-full border border-blue-200 bg-white px-2 py-1 text-[11px] text-blue-700">
            看看{otherMode === "taxi" ? "打车" : "公交/地铁"}方案
          </button>
        )}
        {hasUnconfirmedPreview && onConfirm && (
          <button type="button" onClick={() => onConfirm(block.id, selectedMode)} disabled={confirming} className="rounded-full bg-teal-700 px-2 py-1 text-[11px] text-white disabled:opacity-50">
            {confirming ? "更新中…" : "确定"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="py-2 px-4 mx-4">
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm">
          {info.icon}
        </div>
        <div className="flex-1 border-t border-dashed border-gray-300" />
        <div className="flex items-center gap-2 text-xs text-gray-500 flex-shrink-0">
          <span>{info.label}</span>
          <span>{effectiveBlock.duration}</span>
          {effectiveBlock.cost && effectiveBlock.cost !== "¥0" && effectiveBlock.cost !== "0" && (
            <span className="text-gray-400">{effectiveBlock.cost}</span>
          )}
        </div>
        <div className="flex-1 border-t border-dashed border-gray-300" />
      </div>
      <div className="mt-1 ml-11 rounded-lg border border-gray-100 bg-white px-3 py-2 text-xs text-gray-600">
        <p>{effectiveBlock.description}</p>
        {effectiveBlock.mode === "taxi" && effectiveBlock.cost && (
          <p className="mt-1 text-amber-800">{effectiveBlock.cost}，仅按距离粗估；实际以叫车平台实时价格为准。</p>
        )}
        {switchable && otherAlternative && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-gray-400">
              当前仅查看方案；确认后才会调整后续行程时间
            </span>
            <button
              type="button"
              onClick={() => setSelectedMode(otherMode)}
              className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-blue-700 hover:bg-blue-100"
            >
              看看{otherMode === "taxi" ? "打车" : "公交/地铁"}方案（
              {otherAlternative.durationMinutes}分钟）
            </button>
            {hasUnconfirmedPreview && onConfirm && (
              <button
                type="button"
                onClick={() => onConfirm(block.id, selectedMode)}
                disabled={confirming}
                className="rounded-full bg-teal-700 px-3 py-1 text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {confirming
                  ? "正在更新行程…"
                  : `确定${selectedMode === "taxi" ? "打车" : "公交/地铁"}`}
              </button>
            )}
          </div>
        )}
        <div className="mt-1 flex items-center gap-3">
          <span className={effectiveBlock.routeSource === "amap" ? "text-teal-700" : "text-amber-700"}>
            {effectiveBlock.routeSource === "amap" ? "路线与耗时来自高德" : "路线尚未核实"}
          </span>
          {mapUrl && (
            <a
              href={mapUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              在高德打开这段路线
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
