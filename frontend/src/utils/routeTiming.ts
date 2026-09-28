import type { AccessPoint } from '../types/point';
import type { RouteSegment } from '../types/route';
import { getOpenInfo, type OpenInfo } from './schedule';

/** 轮椅平均推行速度：1.4 m/s（约 5 km/h，含路口减速） */
export const WHEELCHAIR_SPEED_MPS = 1.4;

/** 按路线里程估算通行耗时（分钟，向上取整，不含等候） */
export function travelMinutes(lengthMeters: number): number {
  if (!lengthMeters || lengthMeters <= 0) return 0;
  return Math.ceil(lengthMeters / WHEELCHAIR_SPEED_MPS / 60);
}

/** 出发时刻 + 里程 → 到达时刻 */
export function arriveAt(departAt: Date, lengthMeters: number): Date {
  return new Date(departAt.getTime() + travelMinutes(lengthMeters) * 60000);
}

export interface PointArrival {
  pointId: string;
  order: number;
  /** 预计到达时刻（首点为出发时刻） */
  arriveAt: Date;
  /** 到达时开放信息 */
  info: OpenInfo;
  /** 到达时能否进入（开放或即将关闭均可进入；已关闭不可入链） */
  enterable: boolean;
}

/**
 * 规划中的链：按出发时刻与各段里程顺序推算每个点位的到达时刻与开放状态。
 * lengths[i] 为第 i 段（points[i] → points[i+1]）的里程。
 */
export function planChainArrivals(
  pointIds: string[],
  lengths: number[],
  departAt: Date,
  pointMap: Map<string, AccessPoint>,
): PointArrival[] {
  const out: PointArrival[] = [];
  let cursor = new Date(departAt);
  pointIds.forEach((id, i) => {
    if (i > 0) cursor = arriveAt(cursor, lengths[i - 1] ?? 0);
    const point = pointMap.get(id);
    const info = point ? getOpenInfo(point, cursor) : undefined;
    out.push({
      pointId: id,
      order: i + 1,
      arriveAt: new Date(cursor),
      info: info as OpenInfo,
      enterable: info ? info.state !== 'closed' : true,
    });
  });
  return out;
}

export interface SavedRouteTiming {
  routeName: string;
  departAt: Date | null;
  arrivals: PointArrival[];
  affected: PointArrival[];
}

/** 已保存路线：按落库的出发时刻重算各点到达状态；老数据无出发时刻时返回 null 时刻 */
export function analyzeSavedRoute(
  routeName: string,
  segments: RouteSegment[],
  pointMap: Map<string, AccessPoint>,
): SavedRouteTiming {
  const ordered = [...segments].sort((a, b) => a.order - b.order);
  const depart = ordered[0]?.departAt || '';
  const departAt = depart ? new Date(depart) : null;
  const ids = ordered.length
    ? [ordered[0].fromPointId, ...ordered.map((s) => s.toPointId)]
    : [];
  const lengths = ordered.map((s) => s.length);
  const arrivals = departAt ? planChainArrivals(ids, lengths, departAt, pointMap) : [];
  return {
    routeName,
    departAt,
    arrivals,
    affected: arrivals.filter((a) => !a.enterable),
  };
}

/** 时刻文案：MM-DD HH:mm（跨日带日期） */
export function formatArrival(at: Date): string {
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return `${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** 只在当日内显示 HH:mm，跨日补日期前缀 */
export function formatClock(from: Date, at: Date): string {
  const pad = (n: number) => `${n}`.padStart(2, '0');
  const sameDay = from.toDateString() === at.toDateString();
  return sameDay
    ? `${pad(at.getHours())}:${pad(at.getMinutes())}`
    : `${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}
