import { NextRequest, NextResponse } from "next/server";
import { resolveCtripHotelUrl } from "@/lib/ctrip-resolver";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    name?: string;
    city?: string;
    address?: string;
  };
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "缺少酒店名称。" }, { status: 400 });
  }
  const url = await resolveCtripHotelUrl(name, {
    city: body.city?.trim() || undefined,
    address: body.address?.trim() || undefined,
  });
  if (!url) {
    return NextResponse.json(
      { error: "暂时没有匹配到这家酒店的携程详情页，请稍后重试。" },
      { status: 404 }
    );
  }
  return NextResponse.json({ url });
}
