import type { AccessPoint } from '../types/point';
import type { RouteSegment } from '../types/route';
import { haversineMeters } from './geo';
import { isOpenAt, pointOpenStatus, WHEELCHAIR_SPEED_MPS, type OpenStatus } from './hours';

/** 一段路段（草稿或已保存） */
export interface ChainLeg {
  fromPointId: string;
  toPointId: string;
  /** 长度 m */
  length: number;
}

/** 单个链上点位的预计到达时刻 */
export interface PointArrival {
  pointId: string;
  /** 点位在链中的顺序，从 1 开始 */
  order: number;
  /** 从起点累计里程 m */
  travelM: number;
  arriveAt: Date;
}

/**
 * 按路线里程估算各点位到达时刻。
 * 起点到达时刻即出发时刻；之后按轮椅平均通行速度（1 m/s）逐段累加。
 */
export function estimateArrivals(chainPointIds: string[], legs: ChainLeg[], departure: Date): PointArrival[] {
  const result: PointArrival[] = [];
  let travel = 0;
  let cursor = new Date(departure);
  chainPointIds.forEach((pointId, i) => {
    if (i > 0) {
      const leg = legs.find(
        (l) => l.fromPointId === chainPointIds[i - 1] && l.toPointId === pointId,
      );
      const length = Number(leg?.length) || 0;
      travel += length;
      cursor = new Date(cursor.getTime() + Math.round((length / WHEELCHAIR_SPEED_MPS) * 1000));
    }
    result.push({ pointId, order: i + 1, travelM: Math.round(travel * 10) / 10, arriveAt: new Date(cursor) });
  });
  return result;
}

/** 尚未串联路段时，用经纬度大圆距离生成默认路段长度 */
export function geoLegs(points: AccessPoint[], chain: string[]): ChainLeg[] {
  const byId = new Map(points.map((p) => [p.id, p]));
  const legs: ChainLeg[] = [];
  for (let i = 1; i < chain.length; i += 1) {
    const from = byId.get(chain[i - 1]);
    const to = byId.get(chain[i]);
    if (!from || !to) continue;
    legs.push({
      fromPointId: from.id,
      toPointId: to.id,
      length: Math.round(haversineMeters({ lng: from.lng, lat: from.lat }, { lng: to.lng, lat: to.lat }) * 10) / 10,
    });
  }
  return legs;
}

export interface ChainPointTiming extends PointArrival {
  point?: AccessPoint;
  open: boolean;
  status: OpenStatus | null;
}

/** 链上每个点位在预计到达时刻的开放情况 */
export function chainTimings(
  points: AccessPoint[],
  chain: string[],
  legs: ChainLeg[],
  departure: Date,
): ChainPointTiming[] {
  const byId = new Map(points.map((p) => [p.id, p]));
  return estimateArrivals(chain, legs, departure).map((a) => {
    const point = byId.get(a.pointId);
    if (!point) return { ...a, open: false, status: null };
    return { ...a, point, open: isOpenAt(point, a.arriveAt), status: pointOpenStatus(point, a.arriveAt) };
  });
}

/** 已保存路线的单段影响分析 */
export interface SegmentImpact {
  segment: RouteSegment;
  order: number;
  /** 到达终点的时刻 */
  arriveAt: Date;
  travelM: number;
  toPoint?: AccessPoint;
  toOpen: boolean;
  toStatus: OpenStatus | null;
  /** 受影响：到达终点时该点位不开放 */
  affected: boolean;
}

export interface RouteImpact {
  routeName: string;
  departure: Date;
  segmentImpacts: SegmentImpact[];
  totalLength: number;
  affectedCount: number;
  affected: boolean;
}

/** 对已保存路线按出发时刻重算，标出时段外无法进入的受影响段 */
export function analyzeRoute(
  routeName: string,
  segments: RouteSegment[],
  pointMap: Map<string, AccessPoint>,
  departure: Date,
): RouteImpact {
  const ordered = [...segments].sort((a, b) => a.order - b.order);
  const legs: ChainLeg[] = ordered.map((s) => ({
    fromPointId: s.fromPointId,
    toPointId: s.toPointId,
    length: Number(s.length) || 0,
  }));
  const chain = ordered.length ? [ordered[0].fromPointId, ...ordered.map((s) => s.toPointId)] : [];
  const arrivals = estimateArrivals(chain, legs, departure);
  const arrivalOf = new Map(arrivals.map((a) => [a.pointId, a]));

  let totalLength = 0;
  const segmentImpacts: SegmentImpact[] = ordered.map((segment) => {
    totalLength += Number(segment.length) || 0;
    const arrival = arrivalOf.get(segment.toPointId);
    const toPoint = pointMap.get(segment.toPointId);
    const arriveAt = arrival?.arriveAt ?? new Date(departure);
    const open = toPoint ? isOpenAt(toPoint, arriveAt) : false;
    return {
      segment,
      order: segment.order,
      arriveAt,
      travelM: arrival?.travelM ?? 0,
      toPoint,
      toOpen: open,
      toStatus: toPoint ? pointOpenStatus(toPoint, arriveAt) : null,
      affected: !open,
    };
  });
  const affectedCount = segmentImpacts.filter((s) => s.affected).length;
  return {
    routeName,
    departure,
    segmentImpacts,
    totalLength: Math.round(totalLength * 10) / 10,
    affectedCount,
    affected: affectedCount > 0,
  };
}
