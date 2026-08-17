import { NextRequest, NextResponse } from "next/server";
import { geocodePOIStrict } from "@/lib/amap";

interface VerifyInput {
  city?: string;
  candidates?: { id?: string; name?: string }[];
}

export async function POST(req: NextRequest) {
  if (!process.env.AMAP_KEY) {
    return NextResponse.json({ error: "未配置高德 AMAP_KEY，暂时不能核对地点。" }, { status: 500 });
  }

  try {
    const input: VerifyInput = await req.json();
    const city = input.city?.trim();
    const rawCandidates = input.candidates || [];
    if (!city || city.length < 2) {
      return NextResponse.json({ error: "请先填写或确认城市，再核对地点。" }, { status: 400 });
    }
    if (!rawCandidates.length || rawCandidates.length > 30) {
      return NextResponse.json({ error: "请一次核对 1 到 30 个地点。" }, { status: 400 });
    }

    const results = await Promise.all(
      rawCandidates.map(async (candidate) => {
        const id = candidate.id?.trim();
        const name = candidate.name?.trim();
        if (!id || !name || name.length > 80) {
          return { id: id || "", status: "not-found" as const, query: name || "" };
        }
        const match = await geocodePOIStrict(name, city);
        return match
          ? {
              id,
              status: "matched" as const,
              query: name,
              matchedName: match.matchedName,
              address: match.address,
              poiId: match.poiId,
              lng: match.lng,
              lat: match.lat,
            }
          : { id, status: "not-found" as const, query: name };
      })
    );
    return NextResponse.json({ results, verifiedAt: new Date().toISOString() });
  } catch (err) {
    console.error("Verify POIs error:", err);
    return NextResponse.json({ error: "地点核对失败，请稍后重试。" }, { status: 500 });
  }
}
