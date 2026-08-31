import assert from "node:assert/strict";
import test from "node:test";
import { parseBookingText } from "../src/lib/booking-parser";

test("OCR 压平高铁班次和相邻站点时仍能正确切分", () => {
  const parsed = parseBookingText("G318次长沙南站一北京西站 07:56 13:35");

  assert.equal(parsed.mode, "train");
  assert.equal(parsed.serviceNumber, "G318");
  assert.equal(parsed.departureTerminal, "长沙南站");
  assert.equal(parsed.arrivalTerminal, "北京西站");
  assert.equal(parsed.departTime, "07:56");
  assert.equal(parsed.arriveTime, "13:35");
});

test("OCR 把两个机场粘在一起时仍能逐个截断", () => {
  const parsed = parseBookingText(
    "MU6589 北京大兴国际机场长沙黄花国际机场T2 20:05 22:25"
  );

  assert.equal(parsed.mode, "flight");
  assert.equal(parsed.serviceNumber, "MU6589");
  assert.equal(parsed.departureTerminal, "北京大兴国际机场");
  assert.equal(parsed.arrivalTerminal, "长沙黄花国际机场T2");
  assert.equal(parsed.departTime, "20:05");
  assert.equal(parsed.arriveTime, "22:25");
});

test("到达站前粘着时长乱码时只保留路线分隔符后的站名", () => {
  const parsed = parseBookingText(
    "G318 长沙南站 56开)一北京西站 07:56 13:35 票价739元"
  );

  assert.equal(parsed.departureTerminal, "长沙南站");
  assert.equal(parsed.arrivalTerminal, "北京西站");
  assert.equal(parsed.price, 739);
});

test("站名本身含一时不把首字误当成路线分隔符", () => {
  const parsed = parseBookingText("D123 长沙南站 一面坡北站 08:10 09:25");

  assert.equal(parsed.departureTerminal, "长沙南站");
  assert.equal(parsed.arrivalTerminal, "一面坡北站");
});
