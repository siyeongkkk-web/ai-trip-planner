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

function cleanTerminalCandidate(raw: string): string {
  // “5时56分”可能被 OCR 误识别成“56开)”并粘到“一北京西站”前。
  // 只有“一”前确实出现数字/时长乱码时才截断，避免误伤“一面坡北站”这类站名。
  const fakeDashIndex = raw.lastIndexOf("一");
  const beforeFakeDash = fakeDashIndex > 0 ? raw.slice(0, fakeDashIndex) : "";
  const withoutDurationNoise = /\d|[时分开（）()]/.test(beforeFakeDash)
    ? raw.slice(fakeDashIndex + 1)
    : raw;
  const afterUnambiguousSeparator =
    withoutDurationNoise.split(/[—–\-→至]/).at(-1) || withoutDurationNoise;
  return afterUnambiguousSeparator.replace(
    /^(?:(?:出发|到达)(?:车站|站|机场)|起飞机场|降落机场|车次|航班号|班次|起飞|到达|出发|抵达|次)+/,
    ""
  );
}

export function parseBookingText(text: string): ParsedBooking {
  const compact = text.replace(/[：]/g, ":");
  const serviceNumber = compact.match(
    /\b(?:[GDCZTK]\s?\d{1,4}|[A-Z0-9]{2}\s?\d{3,4})\b/i
  )?.[0]?.replace(/\s/g, "");
  const times = Array.from(compact.matchAll(/\b([01]?\d|2[0-3]):[0-5]\d\b/g)).map(
    (match) => match[0].padStart(5, "0")
  );
  // 浏览器 OCR 经常把票面上的换行压平，例如：
  // “G318次长沙南站一北京西站”或“北京大兴国际机场长沙黄花国际机场T2”。
  // 先移除已识别的班次，再用非贪婪匹配逐个截断站点，避免把相邻字段吞成一个名称。
  const terminalSource = serviceNumber
    ? compact.replace(new RegExp(serviceNumber, "i"), " ")
    : compact;
  const terminalSuffix =
    "(?:国际机场|机场|高铁站|火车站|南站|北站|东站|西站)(?:T\\d+)?";
  const routeSeparatedTerminalSource = terminalSource
    .replace(
      new RegExp(`(${terminalSuffix})\\s*[—–\\-→至]\\s*(?=[\\u4e00-\\u9fa5])`, "g"),
      "$1 "
    )
    .replace(
      new RegExp(`(${terminalSuffix})一(?=[\\u4e00-\\u9fa5])`, "g"),
      "$1 "
    );
  const terminals = Array.from(
    routeSeparatedTerminalSource.matchAll(
      /[\u4e00-\u9fa5A-Za-z0-9（）()]{2,24}?(?:国际机场|机场|高铁站|火车站|南站|北站|东站|西站)(?:T\d+)?/g
    )
  )
    .map((match) => cleanTerminalCandidate(match[0]))
    .filter((value) => value.length >= 2)
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
