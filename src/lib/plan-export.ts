import { Block, TripPlan } from "./types";
import { calculateTripCostEstimate } from "./cost-estimate";

type ExportLine = { text: string; kind: "title" | "heading" | "normal" | "muted" };

function safeFilename(plan: TripPlan): string {
  return `${plan.destination || "旅行"}-${plan.days}日游行程`;
}

function transportText(block: Extract<Block, { type: "transport" }>): string {
  return `→ ${block.description}（${block.duration}）`;
}

function activityText(block: Extract<Block, { type: "activity" }>): string[] {
  const lines = [`${block.startTime}–${block.endTime}  ${block.title}`, `时长：${block.duration}　费用：${block.cost}`];
  if (block.address) lines.push(`地址：${block.address}`);
  if (block.highlights?.length) lines.push(`推荐：${block.highlights.join(" · ")}`);
  if (block.tip) lines.push(`提示：${block.tip}`);
  return lines;
}

function exportLines(plan: TripPlan): ExportLine[] {
  const lines: ExportLine[] = [
    { text: `${plan.destination} ${plan.days}日游`, kind: "title" },
    {
      text: `${plan.departureCity}出发 · ${plan.travelers || 1}人${
        plan.startDate && plan.endDate ? ` · ${plan.startDate} 至 ${plan.endDate}` : ""
      }`,
      kind: "muted",
    },
  ];
  if (plan.outboundTransport) {
    lines.push({
      text: `去程：${plan.outboundTransport.serviceNumber} ${plan.outboundTransport.departureTerminal} ${plan.outboundTransport.departTime} → ${plan.outboundTransport.arrivalTerminal} ${plan.outboundTransport.arriveTime}`,
      kind: "normal",
    });
  }
  if (plan.returnTransport) {
    lines.push({
      text: `返程：${plan.returnTransport.serviceNumber} ${plan.returnTransport.departureTerminal} ${plan.returnTransport.departTime} → ${plan.returnTransport.arrivalTerminal} ${plan.returnTransport.arriveTime}`,
      kind: "normal",
    });
  }
  if (plan.selectedHotel) {
    lines.push({ text: `住宿：${plan.selectedHotel.name} · 总价 ¥${plan.selectedHotel.totalPrice}`, kind: "normal" });
  }
  const estimate = calculateTripCostEstimate(plan);
  lines.push({ text: `最低预估：¥${estimate.minimumPerPerson}/人`, kind: "heading" });
  lines.push({ text: `建议准备：¥${estimate.minimumPerPerson}–¥${estimate.suggestedHighPerPerson}/人`, kind: "normal" });
  estimate.lines.forEach((line) =>
    lines.push({ text: `${line.label} ¥${line.amount}（${line.note}）`, kind: "muted" })
  );
  if (estimate.excludedTicketNames.length) {
    lines.push({ text: `未计入最低预估的待核实门票：${estimate.excludedTicketNames.join("、")}；建议准备中预留 ¥${estimate.unverifiedTicketReserve}`, kind: "muted" });
  }
  plan.dailyPlans.forEach((day) => {
    lines.push({ text: day.dayLabel, kind: "heading" });
    day.blocks.forEach((block) => {
      if (block.type === "transport") {
        lines.push({ text: transportText(block), kind: "muted" });
      } else {
        activityText(block).forEach((text, index) =>
          lines.push({ text, kind: index === 0 ? "normal" : "muted" })
        );
      }
    });
  });
  lines.push({ text: "大交通和酒店为你确认的价格；市内交通以高德路线为准，餐饮与门票请出行前复核。", kind: "muted" });
  return lines;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function blockHtml(block: Block): string {
  if (block.type === "transport") {
    return `<p class="transport">${escapeHtml(transportText(block))}</p>`;
  }
  return `<article><h3>${escapeHtml(`${block.startTime}–${block.endTime}  ${block.title}`)}</h3>
    <p>时长：${escapeHtml(block.duration)}　费用：${escapeHtml(block.cost)}</p>
    ${block.address ? `<p>地址：${escapeHtml(block.address)}</p>` : ""}
    ${block.highlights?.length ? `<p>推荐：${escapeHtml(block.highlights.join(" · "))}</p>` : ""}
    ${block.tip ? `<p>提示：${escapeHtml(block.tip)}</p>` : ""}
  </article>`;
}

export function exportPlanAsPdf(plan: TripPlan): void {
  const windowForPrint = window.open("", "_blank");
  if (!windowForPrint) {
    throw new Error("浏览器阻止了导出窗口，请允许弹窗后再试。");
  }
  const daysHtml = plan.dailyPlans
    .map(
      (day) => `<section><h2>${escapeHtml(day.dayLabel)}</h2>${day.blocks.map(blockHtml).join("")}</section>`
    )
    .join("");
  const transportHtml = [plan.outboundTransport, plan.returnTransport]
    .filter(Boolean)
    .map((item, index) => {
      const transport = item!;
      const label = index === 0 ? "去程" : "返程";
      return `<p>${label}：${escapeHtml(`${transport.serviceNumber} ${transport.departureTerminal} ${transport.departTime} → ${transport.arrivalTerminal} ${transport.arriveTime}`)}</p>`;
    })
    .join("");
  const estimate = calculateTripCostEstimate(plan);
  const estimateHtml = `<section><h2>费用预估（单人）</h2>
    <p><strong>最低预估：¥${estimate.minimumPerPerson}</strong>　建议准备：¥${estimate.minimumPerPerson}–¥${estimate.suggestedHighPerPerson}</p>
    ${estimate.lines.map((line) => `<p>${escapeHtml(`${line.label}：¥${line.amount}（${line.note}）`)}</p>`).join("")}
    ${estimate.excludedTicketNames.length ? `<p>${escapeHtml(`未计入最低预估的待核实门票：${estimate.excludedTicketNames.join("、")}；建议准备中预留 ¥${estimate.unverifiedTicketReserve}`)}</p>` : ""}
  </section>`;
  windowForPrint.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(safeFilename(plan))}</title>
    <style>@page{size:A4;margin:15mm}body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#17242b;line-height:1.55}h1{font-size:25px;margin:0 0 4px}h2{font-size:18px;border-bottom:2px solid #0f6f63;padding-bottom:5px;margin:24px 0 10px}h3{font-size:14px;margin:0 0 3px}p{font-size:12px;margin:3px 0;color:#405158}article{border:1px solid #d4dad8;border-radius:8px;padding:9px 11px;margin:8px 0;break-inside:avoid}.transport{padding:5px 10px;color:#0f6f63}.meta{color:#5d6e74}.note{margin-top:20px;color:#5d6e74;font-size:11px}</style></head><body>
    <h1>${escapeHtml(`${plan.destination} ${plan.days}日游`)}</h1><p class="meta">${escapeHtml(`${plan.departureCity}出发 · ${plan.travelers || 1}人${plan.startDate && plan.endDate ? ` · ${plan.startDate} 至 ${plan.endDate}` : ""}`)}</p>
    ${transportHtml}${plan.selectedHotel ? `<p>住宿：${escapeHtml(`${plan.selectedHotel.name} · 总价 ¥${plan.selectedHotel.totalPrice}`)}</p>` : ""}${estimateHtml}${daysHtml}
    <p class="note">最低预估默认按公共交通计算；大交通和酒店为你确认的价格，地图参考价与基础餐标请在出行前复核。</p>
    <script>window.onload=()=>window.print()<\/script></body></html>`);
  windowForPrint.document.close();
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const rows: string[] = [];
  let row = "";
  for (const character of Array.from(text)) {
    if (context.measureText(row + character).width > maxWidth && row) {
      rows.push(row);
      row = character;
    } else {
      row += character;
    }
  }
  if (row) rows.push(row);
  return rows;
}

export async function exportPlanAsJpg(plan: TripPlan): Promise<void> {
  await document.fonts?.ready;
  const preview = document.createElement("canvas");
  const context = preview.getContext("2d");
  if (!context) throw new Error("当前浏览器不支持图片导出。");
  const width = 1200;
  const padding = 64;
  const styles = {
    title: { font: '700 42px "PingFang SC", sans-serif', color: "#17242b", lineHeight: 58 },
    heading: { font: '700 29px "PingFang SC", sans-serif', color: "#0f6f63", lineHeight: 42 },
    normal: { font: '500 23px "PingFang SC", sans-serif', color: "#17242b", lineHeight: 34 },
    muted: { font: '400 20px "PingFang SC", sans-serif', color: "#5d6e74", lineHeight: 31 },
  } as const;
  const laidOut = exportLines(plan).map((line) => {
    const style = styles[line.kind];
    context.font = style.font;
    return { ...line, style, rows: wrapText(context, line.text, width - padding * 2) };
  });
  const height = Math.max(
    1000,
    laidOut.reduce((total, line) => total + line.rows.length * line.style.lineHeight + 18, padding * 2)
  );
  preview.width = width;
  preview.height = height;
  const draw = preview.getContext("2d");
  if (!draw) throw new Error("当前浏览器不支持图片导出。");
  draw.fillStyle = "#ffffff";
  draw.fillRect(0, 0, width, height);
  let y = padding;
  for (const line of laidOut) {
    draw.font = line.style.font;
    draw.fillStyle = line.style.color;
    line.rows.forEach((row) => {
      draw.fillText(row, padding, y + line.style.lineHeight - 8);
      y += line.style.lineHeight;
    });
    y += 18;
  }
  const link = document.createElement("a");
  link.href = preview.toDataURL("image/jpeg", 0.92);
  link.download = `${safeFilename(plan)}.jpg`;
  link.click();
}
