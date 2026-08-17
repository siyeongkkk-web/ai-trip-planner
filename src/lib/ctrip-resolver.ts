import "server-only";
import { getVerifiedCtripHotelUrl } from "./ctrip-hotels";

export interface CtripHotelLookup {
  name: string;
  city?: string;
  address?: string;
}

// 只缓存已验证成功的结果。失败往往来自临时限流、超时或网页响应变化，
// 缓存 null 会把一次短暂故障放大成整个会话内永远匹配失败。
const verifiedCache = new Map<string, string>();
const inFlight = new Map<string, Promise<string | null>>();

function normalizedName(value: string): string {
  return value.replace(/[（）()\s·\-—]/g, "").toLowerCase();
}

function extractHotelId(value: unknown, hotelName: string): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const text = Object.values(record)
    .filter((item): item is string => typeof item === "string")
    .join(" ");
  const expected = normalizedName(hotelName);
  const actual = normalizedName(text);
  const sameHotel =
    expected.length >= 4 && (actual.includes(expected) || expected.includes(actual));

  if (sameHotel) {
    const urlMatch = text.match(
      /hotels\.ctrip\.com\/hotels\/(?:detail\/)?(\d+)\.html/i
    );
    if (urlMatch) return urlMatch[1];
    for (const [key, item] of Object.entries(record)) {
      if (/^(?:hotel|masterHotel)(?:_?id)?$/i.test(key) && /^\d{4,}$/.test(String(item))) {
        return String(item);
      }
      if (/hotel_?id/i.test(key) && /^\d{4,}$/.test(String(item))) {
        return String(item);
      }
    }
  }

  for (const item of Object.values(record)) {
    if (item && typeof item === "object") {
      const found = extractHotelId(item, hotelName);
      if (found) return found;
    }
  }
  return null;
}

function lookupTerms({ name, city, address }: CtripHotelLookup): string[] {
  const terms = [
    name,
    city ? `${name} ${city}` : "",
    address ? `${name} ${address}` : "",
  ]
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(terms)];
}

async function resolveFromCtrip(
  lookup: CtripHotelLookup,
  signal: AbortSignal
): Promise<string | null> {
  for (const term of lookupTerms(lookup)) {
    const response = await fetch(
      `https://m.ctrip.com/restapi/h5api/searchapp/search?action=onekeyali&keyword=${encodeURIComponent(
        term
      )}`,
      {
        signal,
        headers: {
          Accept: "application/json,text/plain,*/*",
          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
        },
        cache: "no-store",
      }
    );
    if (!response.ok) continue;
    const raw = await response.text();
    const jsonText = raw.trim().startsWith("{")
      ? raw
      : raw.replace(/^[^(]*\(/, "").replace(/\)\s*;?\s*$/, "");
    try {
      const hotelId = extractHotelId(JSON.parse(jsonText), lookup.name);
      if (hotelId) return `https://hotels.ctrip.com/hotels/${hotelId}.html`;
    } catch {
      // 单个查询返回了非 JSON 时，继续尝试带城市或地址的查询。
    }
  }
  return null;
}

async function resolveFromBing(
  lookup: CtripHotelLookup,
  signal: AbortSignal
): Promise<string | null> {
  for (const term of lookupTerms(lookup)) {
    const query = `site:hotels.ctrip.com/hotels "${term}"`;
    const response = await fetch(
      `https://cn.bing.com/search?q=${encodeURIComponent(query)}`,
      {
        signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Safari/537.36",
        },
        cache: "no-store",
      }
    );
    if (!response.ok) continue;
    const html = await response.text();
    const decoded = html
      .replaceAll("&amp;", "&")
      .replaceAll("\\/", "/")
      .replace(/%3A/gi, ":")
      .replace(/%2F/gi, "/");
    const match = decoded.match(
      /https:\/\/hotels\.ctrip\.com\/hotels\/(?:detail\/)?(\d+)\.html/i
    );
    if (!match) continue;

    // 搜索引擎只能帮助定位候选链接，不能单独证明它就是同一家酒店。
    // 再取详情页核对酒店原名，避免同名或相近名误跳。
    const url = `https://hotels.ctrip.com/hotels/${match[1]}.html`;
    const detail = await fetch(url, {
      signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Safari/537.36",
      },
      cache: "no-store",
    });
    if (!detail.ok) continue;
    const detailText = normalizedName(await detail.text());
    if (detailText.includes(normalizedName(lookup.name))) return url;
  }
  return null;
}

async function resolveUncached(lookup: CtripHotelLookup): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const direct = await resolveFromCtrip(lookup, controller.signal).catch(() => null);
    if (direct) return direct;
    return await resolveFromBing(lookup, controller.signal).catch(() => null);
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveCtripHotelUrl(
  name: string,
  context: Omit<CtripHotelLookup, "name"> = {}
): Promise<string | null> {
  const lookup = { name: name.trim(), ...context };
  const verified = getVerifiedCtripHotelUrl(lookup.name);
  if (verified) return verified;

  const cacheKey = [lookup.name, lookup.city || "", lookup.address || ""].join("|");
  const cached = verifiedCache.get(cacheKey);
  if (cached) return cached;

  const existing = inFlight.get(cacheKey);
  if (existing) return existing;

  const request = resolveUncached(lookup)
    .then((url) => {
      if (url) verifiedCache.set(cacheKey, url);
      return url;
    })
    .finally(() => inFlight.delete(cacheKey));
  inFlight.set(cacheKey, request);
  return request;
}
