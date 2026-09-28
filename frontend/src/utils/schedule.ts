import type { AccessPoint } from '../types/point';
import {
  isOvernight,
  toMinutes,
  WEEKDAY_LABELS,
  type WeeklyHour,
} from '../types/schedule';

/** 开放状态：当前开放 / 即将关闭（30 分钟内）/ 已关闭 */
export type OpenState = 'open' | 'closing-soon' | 'closed';

/** 即将关闭阈值（分钟） */
export const CLOSING_SOON_MINUTES = 30;

/** 查找最近开放时间时的最大扫描天数 */
const SCAN_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** JS Date.getDay()（0=周日）→ ISO（1=周一 … 7=周日） */
export function isoWeekday(d: Date): number {
  return d.getDay() === 0 ? 7 : d.getDay();
}

/** 本地日期串 YYYY-MM-DD */
export function dateStr(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 当天 00:00（本地时区） */
function atMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function addDaysDate(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

function closedReasonAt(point: AccessPoint, date: Date): string {
  const key = dateStr(date);
  const hit = point.closedDates.find((c) => c.date === key);
  return hit ? hit.reason || '例外闭馆' : '';
}

/**
 * 某天可能处于开放中的所有区间（本地毫秒时间戳）。
 * 闭馆日覆盖周计划：当天不开放；跨夜段若次日为闭馆日，在次日 00:00 截断。
 */
function intervalsOn(point: AccessPoint, day: Date): Array<{ start: Date; end: Date; hour: WeeklyHour }> {
  if (closedReasonAt(point, day)) return [];
  if (!point.weeklyHours.length) {
    // 未登记时段（道路类设施）视为全天 24h；闭馆日同样生效，已在上面拦截
    const start = atMidnight(day);
    return [{ start, end: addDaysDate(start, 1), hour: { weekday: isoWeekday(day), open: '00:00', close: '00:00' } }];
  }
  const wd = isoWeekday(day);
  const out: Array<{ start: Date; end: Date; hour: WeeklyHour }> = [];
  for (const h of point.weeklyHours.filter((x) => x.weekday === wd)) {
    const start = atMidnight(day);
    start.setMinutes(toMinutes(h.open));
    const end = atMidnight(day);
    if (isOvernight(h)) {
      // 跨夜按次日计算；次日闭馆则截到次日 00:00
      if (closedReasonAt(point, addDaysDate(day, 1))) {
        end.setTime(atMidnight(day).getTime() + MS_PER_DAY);
      } else {
        end.setTime(atMidnight(day).getTime() + MS_PER_DAY + toMinutes(h.close) * 60000);
      }
    } else {
      end.setMinutes(toMinutes(h.close));
    }
    out.push({ start, end, hour: h });
  }
  return out;
}

/** 某一时刻是否处于开放区间内（含跨夜段自前一日延续的部分） */
export function isOpenAt(point: AccessPoint, at: Date): boolean {
  for (const offset of [0, -1]) {
    const day = addDaysDate(at, offset);
    for (const iv of intervalsOn(point, day)) {
      if (at >= iv.start && at < iv.end) return true;
    }
  }
  return false;
}

/**
 * 从 at（含）开始最近的开放时刻：
 * - 已处于开放区间 → at；
 * - 当天为闭馆日/闭馆后 → 扫描后续区间的起点；
 * - 30 天内无可用区间 → null（仅登记时段且长期无可开放日时）。
 */
export function nextOpenAt(point: AccessPoint, at: Date): Date | null {
  if (isOpenAt(point, at)) return new Date(at);
  const base = atMidnight(at);
  for (let i = 0; i <= SCAN_DAYS; i += 1) {
    const day = addDaysDate(base, i);
    const ivs = intervalsOn(point, day)
      .filter((iv) => iv.start >= at)
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    if (ivs.length) return new Date(ivs[0].start);
  }
  return null;
}

/** 所在开放区间的结束时刻；不在开放区间时返回 null */
export function closingAt(point: AccessPoint, at: Date): Date | null {
  for (const offset of [0, -1]) {
    const day = addDaysDate(at, offset);
    for (const iv of intervalsOn(point, day)) {
      if (at >= iv.start && at < iv.end) return new Date(iv.end);
    }
  }
  return null;
}

export interface OpenInfo {
  state: OpenState;
  /** 是否登记了开放时段（false = 全天开放的道路类设施） */
  scheduled: boolean;
  /** 今日/当日闭馆原因（命中例外闭馆日时） */
  closedToday: string;
  /** 最近可开放时刻 */
  nextOpen: Date | null;
  /** 状态简述：开放中 / 30 分钟内关闭 / 已关闭 · 原因 */
  reason: string;
}

function pad(n: number): string {
  return `${n}`.padStart(2, '0');
}

/** 最近可开放时间文案：今天 09:00 / 明天 09:00 / 周三 10-02 09:00 */
export function formatNextOpen(at: Date | null, from: Date): string {
  if (!at) return '近期无开放时段';
  const hm = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const dayDiff = Math.round((atMidnight(at).getTime() - atMidnight(from).getTime()) / MS_PER_DAY);
  if (dayDiff <= 0) return `今天 ${hm}`;
  if (dayDiff === 1) return `明天 ${hm}`;
  if (dayDiff === 2) return `后天 ${hm}`;
  if (dayDiff < 7) return `${WEEKDAY_LABELS[isoWeekday(at)]} ${hm}`;
  return `${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${hm}`;
}

/** 点位在 at 时刻的完整开放信息 */
export function getOpenInfo(point: AccessPoint, at: Date): OpenInfo {
  const scheduled = point.weeklyHours.length > 0;
  const closedToday = closedReasonAt(point, at);
  const open = isOpenAt(point, at);
  if (open) {
    const end = closingAt(point, at);
    const minutesLeft = end ? (end.getTime() - at.getTime()) / 60000 : Number.POSITIVE_INFINITY;
    if (minutesLeft <= CLOSING_SOON_MINUTES) {
      return {
        state: 'closing-soon',
        scheduled,
        closedToday: '',
        nextOpen: end,
        reason: `即将关闭（${pad(end!.getHours())}:${pad(end!.getMinutes())} 闭馆）`,
      };
    }
    return {
      state: 'open',
      scheduled,
      closedToday: '',
      nextOpen: null,
      reason: scheduled ? '开放中' : '全天开放',
    };
  }
  const next = nextOpenAt(point, at);
  let reason: string;
  if (closedToday) {
    reason = `今日闭馆（${closedToday}），${formatNextOpen(next, at)} 开放`;
  } else if (!scheduled) {
    reason = '闭馆中';
  } else {
    reason = `已闭馆，${formatNextOpen(next, at)} 开放`;
  }
  return { state: 'closed', scheduled, closedToday, nextOpen: next, reason };
}

/** 周计划简述：工作日 06:00–23:00 等，连续同一时段合并表述 */
export function describeWeeklyHours(hours: WeeklyHour[]): string {
  if (!hours.length) return '全天开放';
  const groups = new Map<string, number[]>();
  for (const h of [...hours].sort((a, b) => a.weekday - b.weekday || toMinutes(a.open) - toMinutes(b.open))) {
    const key = `${h.open}–${h.close}${isOvernight(h) ? '（次日）' : ''}`;
    const list = groups.get(key) ?? [];
    list.push(h.weekday);
    groups.set(key, list);
  }
  const parts: string[] = [];
  groups.forEach((days, range) => {
    const sorted = [...new Set(days)].sort((a, b) => a - b);
    const isWorkweek = [1, 2, 3, 4, 5].every((d) => sorted.includes(d)) && !sorted.some((d) => d > 5);
    const isEveryday = [1, 2, 3, 4, 5, 6, 7].every((d) => sorted.includes(d));
    const head = isEveryday ? '每天' : isWorkweek ? '工作日' : sorted.map((d) => WEEKDAY_LABELS[d]).join('、');
    parts.push(`${head} ${range}`);
  });
  return parts.join('；');
}

/** 闭馆日简述：2026-10-01（原因）…，最多列 2 条 */
export function describeClosedDates(point: AccessPoint, limit = 2): string {
  if (!point.closedDates.length) return '';
  const items = [...point.closedDates]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(0, limit)
    .map((c) => `${c.date}${c.reason ? ` ${c.reason}` : ''}`);
  const rest = point.closedDates.length - limit;
  return rest > 0 ? `${items.join('；')} 等 ${point.closedDates.length} 天` : items.join('；');
}
