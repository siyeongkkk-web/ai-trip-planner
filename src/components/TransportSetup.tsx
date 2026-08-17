"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { parseBookingText } from "@/lib/booking-parser";
import {
  ConfirmedTransport,
  LongDistanceMode,
  TransportPricing,
  TripPlan,
} from "@/lib/types";
import { savePlan } from "@/lib/storage";

type Draft = Omit<ConfirmedTransport, "source" | "confirmedAt" | "pricePerPerson">;

const EMPTY: Draft = {
  mode: "train",
  serviceNumber: "",
  departureTerminal: "",
  arrivalTerminal: "",
  departTime: "",
  arriveTime: "",
};

function fromSaved(value?: ConfirmedTransport): Draft {
  if (!value) return { ...EMPTY };
  return {
    mode: value.mode,
    serviceNumber: value.serviceNumber,
    departureTerminal: value.departureTerminal,
    arrivalTerminal: value.arrivalTerminal,
    departTime: value.departTime,
    arriveTime: value.arriveTime,
  };
}

function complete(value: Draft) {
  return Boolean(
    value.serviceNumber.trim() &&
      value.departureTerminal.trim() &&
      value.arrivalTerminal.trim() &&
      value.departTime &&
      value.arriveTime
  );
}

function LegEditor({
  title,
  hint,
  value,
  onChange,
  onDetectedPrice,
}: {
  title: string;
  hint: string;
  value: Draft;
  onChange: (value: Draft) => void;
  onDetectedPrice: (price: number, kind: "per-leg" | "round-trip-total") => void;
}) {
  const [ocrMessage, setOcrMessage] = useState("");
  const [recognizing, setRecognizing] = useState(false);
  const set = <K extends keyof Draft>(key: K, next: Draft[K]) =>
    onChange({ ...value, [key]: next });

  const importScreenshot = async (file?: File) => {
    if (!file) return;
    setRecognizing(true);
    setOcrMessage("");
    try {
      const form = new FormData();
      form.append("images", file);
      const response = await fetch("/api/ocr", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) {
        setOcrMessage(data.error || "截图识别失败。");
        return;
      }
      const parsed = parseBookingText(data.text || "");
      onChange({
        ...value,
        mode: parsed.mode || value.mode,
        serviceNumber: parsed.serviceNumber || value.serviceNumber,
        departureTerminal: parsed.departureTerminal || value.departureTerminal,
        arrivalTerminal: parsed.arrivalTerminal || value.arrivalTerminal,
        departTime: parsed.departTime || value.departTime,
        arriveTime: parsed.arriveTime || value.arriveTime,
      });
      if (parsed.price && parsed.priceKind) {
        onDetectedPrice(parsed.price, parsed.priceKind);
      }
      setOcrMessage(
        parsed.price
          ? `已从截图预填班次、时间和价格 ¥${parsed.price}。请确认它是单程单人价还是往返单人总价。`
          : "已从截图预填班次和时间，但没有识别到可信价格；请手动补充并逐项核对。"
      );
    } catch {
      setOcrMessage("截图识别失败，请手动填写。");
    } finally {
      setRecognizing(false);
    }
  };

  return (
    <section className="flow-card leg-editor">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-gray-900">{title}</h2>
          <p className="mt-0.5 text-xs text-gray-500">{hint}</p>
        </div>
        <label className="cursor-pointer rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-medium text-sky-800">
          {recognizing ? "识别中…" : "导入订单截图"}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={recognizing}
            onChange={(event) => importScreenshot(event.target.files?.[0])}
          />
        </label>
      </div>
      {ocrMessage && <p className="mt-2 text-xs text-amber-700">{ocrMessage}</p>}
      <fieldset className="mt-4">
        <legend className="text-xs font-semibold text-gray-600">交通方式</legend>
        <div className="transport-mode-grid mt-2">
          {([
            { mode: "train" as LongDistanceMode, label: "高铁 / 火车", image: "/illustrations/self-mocking-bear/transport-train.png" },
            { mode: "flight" as LongDistanceMode, label: "飞机", image: "/illustrations/self-mocking-bear/transport-plane.png" },
          ]).map((option) => (
            <button
              key={option.mode}
              type="button"
              aria-pressed={value.mode === option.mode}
              onClick={() => set("mode", option.mode)}
              className={`transport-mode ${value.mode === option.mode ? "is-selected" : ""}`}
            >
              <Image unoptimized src={option.image} alt="" width={88} height={68} />
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="text-xs text-gray-600">
          车次/航班号
          <input
            value={value.serviceNumber}
            onChange={(event) => set("serviceNumber", event.target.value)}
            placeholder="如 G84 / CZ3123"
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900"
          />
        </label>
        <label className="text-xs text-gray-600">
          出发车站/机场
          <input
            value={value.departureTerminal}
            onChange={(event) => set("departureTerminal", event.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900"
          />
        </label>
        <label className="text-xs text-gray-600">
          到达车站/机场
          <input
            value={value.arrivalTerminal}
            onChange={(event) => set("arrivalTerminal", event.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900"
          />
        </label>
        <label className="text-xs text-gray-600">
          出发时间
          <input
            type="time"
            value={value.departTime}
            onChange={(event) => set("departTime", event.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900"
          />
        </label>
        <label className="text-xs text-gray-600">
          到达时间
          <input
            type="time"
            value={value.arriveTime}
            onChange={(event) => set("arriveTime", event.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900"
          />
        </label>
      </div>
    </section>
  );
}

export default function TransportSetup({ plan }: { plan: TripPlan }) {
  const router = useRouter();
  const [outbound, setOutbound] = useState(() => fromSaved(plan.outboundTransport));
  const [returnTrip, setReturnTrip] = useState(() => fromSaved(plan.returnTransport));
  const [pricingKind, setPricingKind] = useState<TransportPricing["kind"]>(
    plan.transportPricing?.kind || "per-leg"
  );
  const [outboundPrice, setOutboundPrice] = useState(
    plan.transportPricing?.kind === "per-leg"
      ? plan.transportPricing.outboundPricePerPerson
      : plan.outboundTransport?.pricePerPerson || 0
  );
  const [returnPrice, setReturnPrice] = useState(
    plan.transportPricing?.kind === "per-leg"
      ? plan.transportPricing.returnPricePerPerson
      : plan.returnTransport?.pricePerPerson || 0
  );
  const [roundTripPrice, setRoundTripPrice] = useState(
    plan.transportPricing?.kind === "round-trip-total"
      ? plan.transportPricing.totalPricePerPerson
      : 0
  );
  const [error, setError] = useState("");
  const outboundReady = complete(outbound);
  const returnReady = complete(returnTrip);
  const priceReady = pricingKind === "per-leg"
    ? outboundPrice > 0 && returnPrice > 0
    : roundTripPrice > 0;

  const confirm = () => {
    if (!complete(outbound) || !complete(returnTrip) || !priceReady) {
      setError("请核对往返班次、站点、时间和价格。");
      return;
    }
    const confirmedAt = new Date().toISOString();
    const transportPricing: TransportPricing =
      pricingKind === "per-leg"
        ? {
            kind: "per-leg",
            outboundPricePerPerson: outboundPrice,
            returnPricePerPerson: returnPrice,
          }
        : { kind: "round-trip-total", totalPricePerPerson: roundTripPrice };
    const updated: TripPlan = {
      ...plan,
      outboundTransport: {
        ...outbound,
        pricePerPerson: pricingKind === "per-leg" ? outboundPrice : undefined,
        source: "user-confirmed",
        confirmedAt,
      },
      returnTransport: {
        ...returnTrip,
        pricePerPerson: pricingKind === "per-leg" ? returnPrice : undefined,
        source: "user-confirmed",
        confirmedAt,
      },
      transportPricing,
    };
    savePlan(updated);
    router.push(`/plan/hotel?id=${plan.id}`);
  };

  return (
    <div className="space-y-5">
      <section className="transport-hero flow-card">
        <div className="transport-hero__copy">
          <span className="travel-kicker">第二站 · 把来回先定好</span>
          <h1>确认真实往返交通</h1>
          <p>
          可以手填，也可以导入订单/搜索结果截图预填。截图只在本机识别，保存前必须由你确认。
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a className="flow-link-button" href="https://kyfw.12306.cn/otn/leftTicket/init" target="_blank" rel="noreferrer">打开 12306</a>
            <a className="flow-link-button" href="https://flights.ctrip.com/" target="_blank" rel="noreferrer">打开携程机票</a>
          </div>
        </div>
        <figure className="transport-hero__sticker">
          <Image unoptimized src="/illustrations/self-mocking-bear/pulling-luggage.png" alt="自嘲熊拉着行李准备出发" width={170} height={170} />
          <figcaption>票可以慢慢比，信息要认真核</figcaption>
        </figure>
        <div className="mt-4 grid grid-cols-3 gap-2" aria-label="交通确认进度">
          {[
            { label: "去程信息", ready: outboundReady },
            { label: "返程信息", ready: returnReady },
            { label: "价格", ready: priceReady },
          ].map((item) => (
            <div key={item.label} className={`rounded-lg border px-2 py-2 text-center text-xs font-medium ${item.ready ? "border-emerald-300 bg-white text-emerald-800" : "border-sky-200 bg-white/70 text-sky-800"}`}>
              <span className="mr-1" aria-hidden="true">{item.ready ? "✓" : "○"}</span>{item.label}
            </div>
          ))}
        </div>
        <p className="transport-hero__task">在真实票务平台选定班次 → 回来填写或导入截图 → 核对全部字段后再保存。</p>
      </section>

      <LegEditor
        title={`去程 · ${plan.startDate}`}
        hint={`填写你在平台选择的真实去程信息`}
        value={outbound}
        onChange={setOutbound}
        onDetectedPrice={(price, kind) => {
          if (kind === "round-trip-total") {
            setPricingKind("round-trip-total");
            setRoundTripPrice(price);
          } else {
            setPricingKind("per-leg");
            setOutboundPrice(price);
          }
        }}
      />
      <LegEditor
        title={`返程 · ${plan.endDate}`}
        hint={`填写你在平台选择的真实返程信息`}
        value={returnTrip}
        onChange={setReturnTrip}
        onDetectedPrice={(price, kind) => {
          if (kind === "round-trip-total") {
            setPricingKind("round-trip-total");
            setRoundTripPrice(price);
          } else {
            setPricingKind("per-leg");
            setReturnPrice(price);
          }
        }}
      />

      <section className="flow-card transport-price-card">
        <h2 className="font-semibold text-emerald-950">机票/车票价格怎么记录？</h2>
        <p className="mt-1 text-xs text-emerald-800">
          截图里的价格会自动预填；如果平台只显示往返合计，请选择“只知道往返总价”。
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button onClick={() => setPricingKind("per-leg")} className={`rounded-lg border px-3 py-2 text-sm ${pricingKind === "per-leg" ? "border-emerald-500 bg-white text-emerald-800" : "border-gray-200 bg-white text-gray-500"}`}>知道两段单程价</button>
          <button onClick={() => setPricingKind("round-trip-total")} className={`rounded-lg border px-3 py-2 text-sm ${pricingKind === "round-trip-total" ? "border-emerald-500 bg-white text-emerald-800" : "border-gray-200 bg-white text-gray-500"}`}>只知道往返总价</button>
        </div>
        {pricingKind === "per-leg" ? (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="text-xs text-gray-600">去程单人价<input type="number" min={0} value={outboundPrice || ""} onChange={(event) => setOutboundPrice(Number(event.target.value) || 0)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900" /></label>
            <label className="text-xs text-gray-600">返程单人价<input type="number" min={0} value={returnPrice || ""} onChange={(event) => setReturnPrice(Number(event.target.value) || 0)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900" /></label>
          </div>
        ) : (
          <label className="mt-3 block text-xs text-gray-600">往返单人总价<input type="number" min={0} value={roundTripPrice || ""} onChange={(event) => setRoundTripPrice(Number(event.target.value) || 0)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900" /></label>
        )}
      </section>
      <aside className="taxi-note flow-card">
        <Image unoptimized src="/illustrations/self-mocking-bear/transport-taxi.png" alt="自嘲熊乘坐出租车" width={112} height={92} />
        <div>
          <strong>出租车先不在这里确认</strong>
          <p>这里只保存往返大交通；到站后的市内接驳，会在行程阶段按时间阈值比较公交与打车。</p>
        </div>
      </aside>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <button onClick={confirm} className="flow-primary-button">确认交通，进入酒店选择 →</button>
    </div>
  );
}
