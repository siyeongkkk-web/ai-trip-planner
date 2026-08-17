import { ActivityBlock, TransportBlock } from "./types";

const TITLE_PREFIX =
  /^(早餐|午餐|晚餐|夜宵|游览|参观|打卡|购物|休息|入住|办理入住)\s*[：:]\s*/;

export function cleanPlaceName(title: string): string | undefined {
  const clean = String(title || "")
    .replace(TITLE_PREFIX, "")
    .replace(/^(前往|返回)\s*/, "")
    .replace(/\s*(夜景|游览|参观|打卡)$/, "")
    .trim();

  if (
    !clean ||
    /^(酒店|酒店办理入住|办理入住|自由活动|返回酒店|前往酒店办理入住)$/.test(clean)
  ) {
    return undefined;
  }
  return clean;
}

export function activityPlace(block: ActivityBlock): string | undefined {
  if (block.activityKind === "flexible") return undefined;
  return block.matchedName || block.placeName || cleanPlaceName(block.title);
}

export function activityMapUrl(block: ActivityBlock, city: string): string | undefined {
  const name = activityPlace(block);
  if (!name) return undefined;
  if (Number.isFinite(block.lng) && Number.isFinite(block.lat)) {
    const position = `${block.lng},${block.lat}`;
    return `https://uri.amap.com/marker?position=${encodeURIComponent(position)}&name=${encodeURIComponent(name)}&callnative=1`;
  }
  return `https://www.amap.com/search?query=${encodeURIComponent(`${city} ${name}`)}`;
}

export function transportMapUrl(block: TransportBlock): string | undefined {
  if (
    !block.fromPlace ||
    !block.toPlace ||
    !Number.isFinite(block.fromLng) ||
    !Number.isFinite(block.fromLat) ||
    !Number.isFinite(block.toLng) ||
    !Number.isFinite(block.toLat)
  ) {
    return undefined;
  }
  const from = `${block.fromLng},${block.fromLat},${block.fromPlace}`;
  const to = `${block.toLng},${block.toLat},${block.toPlace}`;
  const mode =
    block.mode === "walking" ? "walk" : block.mode === "taxi" ? "car" : "bus";
  return `https://uri.amap.com/navigation?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&mode=${mode}&policy=0&callnative=1`;
}
