import type {
  AccessPoint,
  ClosureDay,
  FacilityType,
  WeeklySlot,
  Weekday,
} from '../types/point';
import { WEEKDAY_LABELS } from '../types/point';

/** 即将关闭阈值：距当前营业时段结束 30 分钟内 */
export const SOON_CLOSE_MS = 30 * 60 * 1000;

/** 轮椅平均通行速度：1 m/s（3.6 km/h），用于按里程估算到达时刻 */
export const WHEELCHAIR_SPEED_MPS = 1;

export type OpenStatusKind = 'open' | 'closing' | 'closed';

export interface OpenStatus {
  kind: OpenStatusKind;
  /** 当前开放 / 即将关闭 / 已关闭 */
  label: string;
  /** antd Tag 颜色 */
  color: string;
  /** 命中的例外闭馆原因（若有） */
  closureReason: string;
  /** 最近一次可开放时刻（已开放时为 null） */
  nextOpen: Date | null;
  /** 当前所处时段的结束时刻（用于即将关闭判定） */
  closingAt: Date | null;
}

/* --------------------------------- 基础工具 -------------------------------- */

function pad2(n: number): string {
  return `${n}`.padStart(2, '0');
}

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** JS getDay()：0=周日 → 业务口径 1=周一 … 7=周日 */
export function weekdayOf(d: Date): Weekday {
  return ((d.getDay() + 6) % 7) + 1 as Weekday;
}

export function parseHHmm(v: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec((v || '').trim());
  if (!m) return [0, 0];
  return [Number(m[1]), Number(m[2])];
}

function minuteOf(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function dateOnly(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addCalendarDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function atTime(day: Date, hhmm: string): Date {
  const [h, m] = parseHHmm(hhmm);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
}

/* ------------------------------ 默认周计划 / 闭馆 ----------------------------- */

const ALL_DAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7];
const WEEKDAYS_ONLY: Weekday[] = [1, 2, 3, 4, 5];

function slotsFor(days: Weekday[], start: string, end: string): WeeklySlot[] {
  return days.map((weekday) => ({ weekday, start, end }));
}

/**
 * 各设施类型的默认每周时段：
 * 室内服务设施按固定时段开放，室外道路设施（坡道/盲道）全天开放。
 */
export function defaultWeeklyHours(type: FacilityType): WeeklySlot[] {
  switch (type) {
    case '无障碍电梯':
      return slotsFor(ALL_DAYS, '06:00', '23:00');
    case '无障碍卫生间':
      return slotsFor(ALL_DAYS, '06:30', '22:00');
    case '低位服务台':
      return slotsFor(WEEKDAYS_ONLY, '09:00', '17:00');
    default:
      return [];
  }
}

/** 校验单条时段：时刻合法且起止不相同 */
export function isValidSlot(slot: WeeklySlot): boolean {
  const [sh, sm] = parseHHmm(slot.start);
  const [eh, em] = parseHHmm(slot.end);
  if (Number.isNaN(sh) || Number.isNaN(eh)) return false;
  if (slot.weekday < 1 || slot.weekday > 7) return false;
  return sh * 60 + sm !== eh * 60 + em;
}

export function closureReasonOn(closures: ClosureDay[] | undefined, dateStr: string): string {
  const hit = (closures || []).find((c) => c.date === dateStr);
  return hit ? hit.reason || '闭馆' : '';
}

/* -------------------------------- 开放判定 -------------------------------- */

interface ActiveSession {
  start: Date;
  end: Date;
}

/**
 * 找到 at 时刻所处的营业时段。
 * 跨夜时段（end <= start）按次日规则：到达日当天晚上进入、次日凌晨仍在时段内。
 */
function activeSession(slots: WeeklySlot[], at: Date): ActiveSession | null {
  const day = weekdayOf(at);
  const nowMin = minuteOf(at);
  const today = dateOnly(at);

  for (const slot of slots) {
    const [sh, sm] = parseHHmm(slot.start);
    const [eh, em] = parseHHmm(slot.end);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;

    // 当天开始的时段
    if (slot.weekday === day) {
      if (endMin > startMin) {
        // 同日时段：[start, end)
        if (nowMin >= startMin && nowMin < endMin) {
          return { start: atTime(today, slot.start), end: atTime(today, slot.end) };
        }
      } else if (nowMin >= startMin) {
        // 跨夜时段，到达日为开始日：start 起直到次日 end
        return { start: atTime(today, slot.start), end: atTime(addCalendarDays(today, 1), slot.end) };
      }
    }

    // 前一天开始、延续到当天凌晨的跨夜时段
    const prevDay = (day === 1 ? 7 : day - 1) as Weekday;
    if (slot.weekday === prevDay && endMin <= startMin && nowMin < endMin) {
      return { start: atTime(addCalendarDays(today, -1), slot.start), end: atTime(today, slot.end) };
    }
  }
  return null;
}

/**
 * 任意时刻是否可进入点位。
 * 规则：例外闭馆日覆盖周计划（含跨夜时段的开始日与到达日）；无周计划视为全天开放。
 */
export function isOpenAt(point: Pick<AccessPoint, 'weeklyHours' | 'closureDays'>, at: Date): boolean {
  const arrivalDate = toDateStr(at);
  if (closureReasonOn(point.closureDays, arrivalDate)) return false;

  const slots = point.weeklyHours || [];
  if (!slots.length) return true;

  const session = activeSession(slots, at);
  if (!session) return false;
  // 跨夜时段若在闭馆日当天开始，则整个时段作废
  if (closureReasonOn(point.closureDays, toDateStr(session.start))) return false;
  return true;
}

/**
 * 最近一次可开放时刻（严格晚于 after）。
 * 全天开放设施取下一个非闭馆日 00:00；找不到（31 天内全闭馆）返回 null。
 */
export function nextOpening(
  point: Pick<AccessPoint, 'weeklyHours' | 'closureDays'>,
  after: Date,
  maxDays = 31,
): Date | null {
  const slots = point.weeklyHours || [];
  const base = dateOnly(after);

  if (!slots.length) {
    for (let n = 0; n <= maxDays; n += 1) {
      const day = addCalendarDays(base, n);
      if (closureReasonOn(point.closureDays, toDateStr(day))) continue;
      const candidate = atTime(day, '00:00');
      if (candidate.getTime() > after.getTime()) return candidate;
    }
    return null;
  }

  for (let n = 0; n <= maxDays; n += 1) {
    const day = addCalendarDays(base, n);
    const dayStr = toDateStr(day);
    if (closureReasonOn(point.closureDays, dayStr)) continue;
    const wd = weekdayOf(day);
    for (const slot of slots) {
      if (slot.weekday !== wd) continue;
      const candidate = atTime(day, slot.start);
      if (candidate.getTime() <= after.getTime()) continue;
      return candidate;
    }
  }
  return null;
}

/** 综合开放状态：当前开放 / 即将关闭（30 分钟内）/ 已关闭 */
export function pointOpenStatus(
  point: Pick<AccessPoint, 'weeklyHours' | 'closureDays'>,
  at: Date = new Date(),
): OpenStatus {
  const reason = closureReasonOn(point.closureDays, toDateStr(at));
  const open = isOpenAt(point, at);
  if (open) {
    const session = activeSession(point.weeklyHours || [], at);
    const closingAt = session?.end ?? null;
    const soon = closingAt && closingAt.getTime() - at.getTime() <= SOON_CLOSE_MS;
    return {
      kind: soon ? 'closing' : 'open',
      label: soon ? '即将关闭' : '当前开放',
      color: soon ? 'warning' : 'success',
      closureReason: '',
      nextOpen: null,
      closingAt,
    };
  }
  return {
    kind: 'closed',
    label: reason ? '已关闭·闭馆' : '已关闭',
    color: 'default',
    closureReason: reason,
    nextOpen: nextOpening(point, at),
    closingAt: null,
  };
}

/* -------------------------------- 文案格式化 -------------------------------- */

function formatWeekdayRun(days: Weekday[]): string {
  if (!days.length) return '';
  if (days.length === 1) return WEEKDAY_LABELS[days[0]];
  // 连续区间用「周一至周五」，离散用「周一、周三」
  const runs: Weekday[][] = [];
  let run: Weekday[] = [days[0]];
  for (let i = 1; i < days.length; i += 1) {
    if (days[i] === days[i - 1] + 1) run.push(days[i]);
    else {
      runs.push(run);
      run = [days[i]];
    }
  }
  runs.push(run);
  return runs
    .map((r) => (r.length >= 2 ? `${WEEKDAY_LABELS[r[0]]}至${WEEKDAY_LABELS[r[r.length - 1]]}` : WEEKDAY_LABELS[r[0]]))
    .join('、');
}

/** 周计划摘要，如「周一至周五 09:00–17:00；周六、周日 06:00–23:00」；空计划视为全天开放 */
export function formatWeeklyHours(slots: WeeklySlot[] | undefined): string {
  const list = (slots || []).filter(isValidSlot);
  if (!list.length) return '全天开放';
  const groups = new Map<string, Weekday[]>();
  for (const s of list) {
    const key = `${s.start}|${s.end}`;
    const days = groups.get(key) ?? [];
    days.push(s.weekday);
    groups.set(key, days);
  }
  return [...groups.entries()]
    .map(([key, days]) => {
      const [start, end] = key.split('|');
      const [sh] = parseHHmm(start);
      const [eh] = parseHHmm(end);
      const overnight = eh * 60 + parseHHmm(end)[1] <= sh * 60 + parseHHmm(start)[1];
      days.sort((a, b) => a - b);
      return `${formatWeekdayRun(days)} ${start}–${overnight ? '次日' : ''}${end}`;
    })
    .join('；');
}

/** M月D日(周X) HH:mm */
export function formatNextOpen(d: Date | null): string {
  if (!d) return '近期无开放计划';
  return `${d.getMonth() + 1}月${d.getDate()}日(${WEEKDAY_LABELS[weekdayOf(d)]}) ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 到达时刻短格式：MM-DD HH:mm(周X) */
export function formatArrival(d: Date): string {
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}(${WEEKDAY_LABELS[weekdayOf(d)]})`;
}

/** 已关闭点位的最近开放提示文案 */
export function nextOpenHint(point: Pick<AccessPoint, 'weeklyHours' | 'closureDays'>, at: Date): string {
  const reason = closureReasonOn(point.closureDays, toDateStr(at));
  const next = nextOpening(point, at);
  const prefix = reason ? `当日闭馆（${reason}），` : '';
  return `${prefix}最近可开放 ${formatNextOpen(next)}`;
}
