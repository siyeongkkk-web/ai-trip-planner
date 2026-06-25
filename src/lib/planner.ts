// 纯算法层：地理聚类 + 单日顺序优化。
// 这是"硬活"——确定性计算，绝不交给 LLM。

export interface Pt {
  lng: number;
  lat: number;
}

const R = 6371000; // 地球半径（米）

/** 两点直线距离（米），用于聚类与"步行/打车"模式判断 */
export function haversine(a: Pt, b: Pt): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * 把 N 个点按地理位置分到 days 天。
 * k-means 聚类 + 容量均衡（避免某天挤一堆、某天空着——对应我们讨论的"场景A"）。
 * 返回：每天一组点的下标数组。
 */
export function clusterIntoDays(points: Pt[], days: number): number[][] {
  const n = points.length;
  if (n === 0) return Array.from({ length: days }, () => []);
  if (days <= 1) return [points.map((_, i) => i)];
  const k = Math.min(days, n);

  // 初始质心：k-means++ 简化版，尽量分散
  const centroids: Pt[] = [{ ...points[0] }];
  while (centroids.length < k) {
    let best = -1;
    let bestDist = -1;
    for (let i = 0; i < n; i++) {
      const d = Math.min(...centroids.map((c) => haversine(points[i], c)));
      if (d > bestDist) {
        bestDist = d;
        best = i;
      }
    }
    centroids.push({ ...points[best] });
  }

  let assign = new Array(n).fill(0);
  for (let iter = 0; iter < 20; iter++) {
    // 分配到最近质心
    let changed = false;
    for (let i = 0; i < n; i++) {
      let bi = 0;
      let bd = Infinity;
      for (let c = 0; c < k; c++) {
        const d = haversine(points[i], centroids[c]);
        if (d < bd) {
          bd = d;
          bi = c;
        }
      }
      if (assign[i] !== bi) {
        assign[i] = bi;
        changed = true;
      }
    }
    // 更新质心
    for (let c = 0; c < k; c++) {
      const members = points.filter((_, i) => assign[i] === c);
      if (members.length === 0) continue;
      centroids[c] = {
        lng: members.reduce((s, p) => s + p.lng, 0) / members.length,
        lat: members.reduce((s, p) => s + p.lat, 0) / members.length,
      };
    }
    if (!changed) break;
  }

  // 容量均衡：每天最多 ceil(n/k) 个。
  // 关键：从超员的簇里，挑"挪去别处代价最小"的点搬走（而不是离本簇质心最远的点），
  // 这样被迫拆散时也尽量保持顺路——缓解"地理紧凑 vs 每日均衡"的冲突。
  const cap = Math.ceil(n / k);
  const clusters: number[][] = Array.from({ length: k }, () => []);
  assign.forEach((c, i) => clusters[c].push(i));

  for (let guard = 0; guard < n * k; guard++) {
    const over = clusters.findIndex((cl) => cl.length > cap);
    if (over === -1) break; // 都不超员了

    // 在所有超员簇里，找全局最优的一次迁移：(点, 目标簇) 使该点到目标质心最近
    let bestPi = -1;
    let bestTarget = -1;
    let bestCost = Infinity;
    for (let c = 0; c < k; c++) {
      if (clusters[c].length <= cap) continue;
      for (const pi of clusters[c]) {
        for (let c2 = 0; c2 < k; c2++) {
          if (c2 === c || clusters[c2].length >= cap) continue;
          const cost = haversine(points[pi], centroids[c2]);
          if (cost < bestCost) {
            bestCost = cost;
            bestPi = pi;
            bestTarget = c2;
          }
        }
      }
    }
    if (bestTarget === -1) break; // 没有空位可挪
    const src = clusters.findIndex((cl) => cl.includes(bestPi));
    clusters[src] = clusters[src].filter((x) => x !== bestPi);
    clusters[bestTarget].push(bestPi);
  }

  return clusters;
}

/**
 * 按地理位置 + 时间容量分天：每天能装的不是"固定个数"，而是"固定小时数"。
 * weights = 每个点的游玩分钟数；dayCapMinutes = 单日可游玩分钟预算。
 * 这样环球影城（整天）会独占一天，而拍照点很多个可挤一天。
 * 返回：每天一组点的下标。可能仍有超载（由上层做删除处理）。
 */
export function clusterIntoDaysWeighted(
  points: Pt[],
  weights: number[],
  days: number,
  dayCapMinutes: number
): number[][] {
  const n = points.length;
  if (n === 0) return Array.from({ length: days }, () => []);
  if (days <= 1) return [points.map((_, i) => i)];
  const k = Math.min(days, n);

  // k-means++ 简化初始化（分散）
  const centroids: Pt[] = [{ ...points[0] }];
  while (centroids.length < k) {
    let best = -1;
    let bestDist = -1;
    for (let i = 0; i < n; i++) {
      const dmin = Math.min(...centroids.map((c) => haversine(points[i], c)));
      if (dmin > bestDist) {
        bestDist = dmin;
        best = i;
      }
    }
    centroids.push({ ...points[best] });
  }

  const assign = new Array(n).fill(0);
  for (let iter = 0; iter < 20; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let bi = 0;
      let bd = Infinity;
      for (let c = 0; c < k; c++) {
        const d = haversine(points[i], centroids[c]);
        if (d < bd) {
          bd = d;
          bi = c;
        }
      }
      if (assign[i] !== bi) {
        assign[i] = bi;
        changed = true;
      }
    }
    for (let c = 0; c < k; c++) {
      const members = points.filter((_, i) => assign[i] === c);
      if (members.length === 0) continue;
      centroids[c] = {
        lng: members.reduce((s, p) => s + p.lng, 0) / members.length,
        lat: members.reduce((s, p) => s + p.lat, 0) / members.length,
      };
    }
    if (!changed) break;
  }

  const clusters: number[][] = Array.from({ length: k }, () => []);
  assign.forEach((c, i) => clusters[c].push(i));
  const load = (cl: number[]) => cl.reduce((s, i) => s + weights[i], 0);

  // 容量均衡（按时间）：超载簇里挑"挪去别处代价最小"的点搬到有空位的簇
  for (let guard = 0; guard < n * k * 2; guard++) {
    const over = clusters.findIndex(
      (cl) => load(cl) > dayCapMinutes && cl.length > 1
    );
    if (over === -1) break;
    let bestPi = -1;
    let bestTarget = -1;
    let bestCost = Infinity;
    for (let c = 0; c < k; c++) {
      if (load(clusters[c]) <= dayCapMinutes || clusters[c].length <= 1) continue;
      for (const pi of clusters[c]) {
        for (let c2 = 0; c2 < k; c2++) {
          if (c2 === c) continue;
          if (load(clusters[c2]) + weights[pi] > dayCapMinutes) continue;
          const cost = haversine(points[pi], centroids[c2]);
          if (cost < bestCost) {
            bestCost = cost;
            bestPi = pi;
            bestTarget = c2;
          }
        }
      }
    }
    if (bestTarget === -1) break;
    const src = clusters.findIndex((cl) => cl.includes(bestPi));
    clusters[src] = clusters[src].filter((x) => x !== bestPi);
    clusters[bestTarget].push(bestPi);
  }

  return clusters;
}

/** 一组点的几何中心（用于推荐酒店区域） */
export function centroid(points: Pt[]): Pt {
  const n = points.length || 1;
  return {
    lng: points.reduce((s, p) => s + p.lng, 0) / n,
    lat: points.reduce((s, p) => s + p.lat, 0) / n,
  };
}

// ===== 时间轴 + 费用 的启发式（"软估计"，确定性、不编造）=====

export function hmToMin(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}
export function minToHm(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** 按景点类型估计游玩时长（分钟） */
export function estimateVisitMinutes(category?: string): number {
  switch (category) {
    case "博物馆":
      return 150;
    case "景点":
      return 120;
    case "公园":
      return 90;
    case "购物":
      return 90;
    case "咖啡":
      return 60;
    case "拍照点":
      return 45;
    case "美食":
      return 75;
    default:
      return 90;
  }
}

/** 门票/消费粗估（单人，元） */
export function estimateTicketCost(category?: string): number {
  switch (category) {
    case "景点":
      return 60;
    case "博物馆":
      return 0;
    case "公园":
      return 10;
    case "咖啡":
      return 45;
    case "购物":
      return 0;
    case "拍照点":
      return 0;
    default:
      return 30;
  }
}

/** 单顿正餐花费（按住宿档次近似消费水平） */
export function mealCost(tier: string): number {
  return tier === "豪华" ? 150 : tier === "舒适" ? 80 : 45;
}

/** 每晚住宿价（单人估，按档次） */
export function hotelNightCost(tier: string): number {
  return tier === "豪华" ? 900 : tier === "舒适" ? 450 : 200;
}

/** 单段交通花费（元）：步行0，公交地铁≈4，打车按距离 */
export function legCost(mode: string, distanceMeters: number): number {
  if (mode === "walking") return 0;
  if (mode === "transit") return 4;
  return Math.round((distanceMeters / 1000) * 2.3 + 13); // 打车
}

/**
 * 单日内排顺序：最近邻启发式（TSP 的简化解）。
 * startNear 给定时（如酒店坐标），从离它最近的点开始。
 * 返回：排好序的点下标（相对传入数组）。
 */
export function orderByNearestNeighbor(
  points: Pt[],
  startNear?: Pt
): number[] {
  const n = points.length;
  if (n <= 2) return points.map((_, i) => i);

  const visited = new Array(n).fill(false);
  const order: number[] = [];

  // 起点：离 startNear 最近的点；没给就用第 0 个
  let cur = 0;
  if (startNear) {
    let bd = Infinity;
    for (let i = 0; i < n; i++) {
      const d = haversine(points[i], startNear);
      if (d < bd) {
        bd = d;
        cur = i;
      }
    }
  }
  visited[cur] = true;
  order.push(cur);

  for (let step = 1; step < n; step++) {
    let next = -1;
    let bd = Infinity;
    for (let i = 0; i < n; i++) {
      if (visited[i]) continue;
      const d = haversine(points[order[order.length - 1]], points[i]);
      if (d < bd) {
        bd = d;
        next = i;
      }
    }
    visited[next] = true;
    order.push(next);
  }
  return order;
}
