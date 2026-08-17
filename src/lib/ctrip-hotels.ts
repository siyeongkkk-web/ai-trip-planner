const VERIFIED_CTRIP_HOTELS: Record<string, string> = {
  人民大会堂宾馆: "2298288",
  "观旗宾馆(北京天安门广场店)": "2870665",
  "升旗宾馆(北京天安门广场前门地铁站店)": "3182529",
  "宜尚酒店(北京天安门广场前门地铁站店)": "99891175",
  "国帅宾馆(北京天安门广场前门地铁站店)": "5249862",
  "北京天安门花间堂·御道": "130908939",
  北京大兴机场丽筠酒店: "113612942",
  "汉庭酒店(北京大兴国际机场航站楼店)": "123894529",
  "骏怡酒店(北京颐和园店)": "128220117",
};

function normalizedHotelName(value: string): string {
  return value.replace(/[（）]/g, (character) => (character === "（" ? "(" : ")")).trim();
}

/**
 * 携程没有公开稳定的“按酒店名直达详情”参数。
 * 只有人工核对过酒店名与携程 hotel id 后才返回详情页，避免把用户带到错误酒店。
 */
export function getVerifiedCtripHotelUrl(name: string): string | undefined {
  const normalized = normalizedHotelName(name);
  const exact = VERIFIED_CTRIP_HOTELS[normalized];
  if (exact) return `https://hotels.ctrip.com/hotels/${exact}.html`;

  const entry = Object.entries(VERIFIED_CTRIP_HOTELS).find(
    ([verifiedName]) =>
      normalizedHotelName(verifiedName).includes(normalized) ||
      normalized.includes(normalizedHotelName(verifiedName))
  );
  return entry ? `https://hotels.ctrip.com/hotels/${entry[1]}.html` : undefined;
}
