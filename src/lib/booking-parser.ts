import { LongDistanceMode } from "./types";

export interface ParsedBooking {
  mode?: LongDistanceMode;
  serviceNumber?: string;
  departureTerminal?: string;
  arrivalTerminal?: string;
  departTime?: string;
  arriveTime?: string;
  price?: number;
  priceKind?: "per-leg" | "round-trip-total";
}

export function parseBookingText(text: string): ParsedBooking {
  const compact = text.replace(/[：]/g, ":");
  const serviceNumber = compact.match(
    /\b(?:[GDCZTK]\s?\d{1,4}|[A-Z0-9]{2}\s?\d{3,4})\b/i
  )?.[0]?.replace(/\s/g, "");
  const times = Array.from(compact.matchAll(/\b([01]?\d|2[0-3]):[0-5]\d\b/g)).map(
    (match) => match[0].padStart(5, "0")
  );
  const terminals = Array.from(
    compact.matchAll(
      /[\u4e00-\u9fa5A-Za-z0-9（）()]{2,24}(?:国际机场|机场|高铁站|火车站|南站|北站|东站|西站)(?:T\d+)?/g
    )
  )
    .map((match) => match[0].replace(/^(?:起飞|到达|出发|抵达)/, ""))
    .filter((value, index, values) => values.indexOf(value) === index);
  const priceCandidates: { value: number; score: number; index: number }[] = [];
  const pricePattern =
    /(?:实付|支付金额|订单金额|合计|总价|票价|价格|应付|[¥￥])[\s:：]*[¥￥]?\s*(\d{2,6}(?:\.\d{1,2})?)/g;
  for (const match of compact.matchAll(pricePattern)) {
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value < 50 || value > 100000) continue;
    const label = match[0];
    const score =
      /实付|支付金额|应付/.test(label)
        ? 5
        : /合计|总价|订单金额/.test(label)
          ? 4
          : /票价|价格/.test(label)
            ? 3
            : 1;
    priceCandidates.push({ value, score, index: match.index || 0 });
  }
  for (const match of compact.matchAll(/(\d{2,6}(?:\.\d{1,2})?)\s*元(?:\/人|每人)?/g)) {
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value < 50 || value > 100000) continue;
    priceCandidates.push({ value, score: 2, index: match.index || 0 });
  }
  const price = priceCandidates.sort(
    (a, b) => b.score - a.score || b.index - a.index
  )[0]?.value;
  const roundTrip = /往返|来回|双程/.test(compact);

  return {
    mode: serviceNumber
      ? /^[GDCZTK]/i.test(serviceNumber)
        ? "train"
        : "flight"
      : undefined,
    serviceNumber,
    departureTerminal: terminals[0],
    arrivalTerminal: terminals[1],
    departTime: times[0],
    arriveTime: times[1],
    price,
    priceKind: price ? (roundTrip ? "round-trip-total" : "per-leg") : undefined,
  };
}
