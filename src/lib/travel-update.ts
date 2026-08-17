import { getCityWeather, getTrafficAround } from "./amap";
import { ActivityBlock, TravelUpdateIssue, TravelUpdateReport, TripPlan } from "./types";

export interface TravelUpdateDependencies {
  getWeather: typeof getCityWeather;
  getTraffic: typeof getTrafficAround;
}

const DEFAULT_TRAVEL_UPDATE_DEPENDENCIES: TravelUpdateDependencies = {
  getWeather: getCityWeather,
  getTraffic: getTrafficAround,
};

function dateForDay(plan: TripPlan, dayIndex: number): string | null {
  if (!plan.startDate) return null;
  const start = new Date(`${plan.startDate}T12:00:00`);
  if (Number.isNaN(start.getTime())) return null;
  start.setDate(start.getDate() + dayIndex);
  return start.toISOString().slice(0, 10);
}

function firstMappableActivity(plan: TripPlan, dayIndex: number): ActivityBlock | null {
  return (
    plan.dailyPlans[dayIndex]?.blocks.find(
      (block): block is ActivityBlock =>
        block.type === "activity" &&
        block.activityKind !== "flexible" &&
        Number.isFinite(block.lng) &&
        Number.isFinite(block.lat)
    ) || null
  );
}

function hasSevereWeather(text: string): boolean {
  return /雨|雪|雷|冰雹|台风/.test(text);
}

/**
 * 读取外部事实后生成待确认项。没有预报、没有坐标、或接口失败都不会被包装成“无风险”。
 */
export async function buildTravelUpdateReport(
  plan: TripPlan,
  dayIndex: number,
  dependencies: Partial<TravelUpdateDependencies> = {}
): Promise<TravelUpdateReport> {
  const deps = { ...DEFAULT_TRAVEL_UPDATE_DEPENDENCIES, ...dependencies };
  const safeDayIndex = Math.min(Math.max(dayIndex, 0), Math.max(plan.dailyPlans.length - 1, 0));
  const [weather, traffic] = await Promise.all([
    deps.getWeather(plan.destination),
    (() => {
      const activity = firstMappableActivity(plan, safeDayIndex);
      return activity ? deps.getTraffic({ lng: activity.lng!, lat: activity.lat! }) : Promise.resolve(null);
    })(),
  ]);
  const issues: TravelUpdateIssue[] = [];
  const travelDate = dateForDay(plan, safeDayIndex);
  const weatherForDay = travelDate ? weather?.forecasts.find((cast) => cast.date === travelDate) : undefined;
  if (weather && weatherForDay && hasSevereWeather(`${weatherForDay.dayWeather} ${weatherForDay.nightWeather}`)) {
    const weatherText = `${weatherForDay.dayWeather}/${weatherForDay.nightWeather}`;
    issues.push({
      id: `weather-${safeDayIndex}-${weatherForDay.date}`,
      severity: "risk",
      title: `${plan.dailyPlans[safeDayIndex]?.dayLabel || `第${safeDayIndex + 1}天`}可能有${weatherText}`,
      detail: `高德在 ${weather.reportTime || "本次检查"} 返回该日天气为 ${weatherText}。请在出发前复核，并仅为受影响的户外活动比较已核对的室内替代。`,
      dayIndex: safeDayIndex,
      actionLabel: "让助手准备替代候选",
      suggestedPrompt: `请针对第${safeDayIndex + 1}天可能出现的${weatherText}，只为当天户外活动寻找附近、已地图核对的室内替代候选；先列出候选与营业时间核对状态，不要直接修改行程。`,
    });
  }
  if (!weatherForDay && travelDate) {
    issues.push({
      id: `weather-unavailable-${safeDayIndex}`,
      severity: "attention",
      title: "该日暂无可用天气预报",
      detail: "高德当前返回的预报日期不覆盖这一天，或接口暂未返回结果；这不表示当天晴朗。临近出行时请重新检查。",
      dayIndex: safeDayIndex,
      actionLabel: "临近出行时复查",
      suggestedPrompt: `请先检查第${safeDayIndex + 1}天的天气是否已有可用预报；在没有事实依据前，不要替换当天地点。`,
    });
  }
  if (traffic && (traffic.congestedRoadCount > 0 || traffic.blockedRoadCount > 0)) {
    issues.push({
      id: `traffic-${safeDayIndex}`,
      severity: traffic.blockedRoadCount > 0 ? "risk" : "attention",
      title: "当天首个已核对地点周边存在拥堵路段",
      detail: `高德区域交通态势：${traffic.description || "检测到拥堵信息"}。这只反映该地点周边范围，不等于整天路线不可达。`,
      dayIndex: safeDayIndex,
      actionLabel: "让助手比较当天路线",
      suggestedPrompt: `请重新比较第${safeDayIndex + 1}天的已确认路线，优先保留已锁定地点；只把有高德路线结果的时间差异列为待确认方案，不要直接改动行程。`,
    });
  }
  const unavailable = !weather && !traffic;
  const summary = unavailable
    ? "天气与区域交通暂时都未取到，当前不把它当作“无风险”。"
    : issues.length
      ? `发现 ${issues.length} 项需要确认的出行信息；不会自动改动你的行程。`
      : "已检查可用天气与当天首个已核对地点周边路况，暂未发现明确风险信号。";
  return {
    status: unavailable ? "unavailable" : issues.length ? "needs-attention" : "clear",
    summary,
    checkedAt: new Date().toISOString(),
    weatherSource: weather ? "checked" : "unavailable",
    trafficSource: traffic ? "checked" : "unavailable",
    issues,
  };
}
