import type { FacilityType } from './point';

/** ISO 星期编号：1=周一 … 7=周日 */
export const WEEKDAY_LABELS: Record<number, string> = {
  1: '周一',
  2: '周二',
  3: '周三',
  4: '周四',
  5: '周五',
  6: '周六',
  7: '周日',
};

export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 7] as const;

/** 按固定时段开放的设施类型（道路类设施全天开放，不登记时段） */
export const SCHEDULED_FACILITY_TYPES: FacilityType[] = [
  '无障碍电梯',
  '无障碍卫生间',
  '低位服务台',
];

export function isScheduledType(facilityType: FacilityType): boolean {
  return SCHEDULED_FACILITY_TYPES.includes(facilityType);
}

/**
 * 每周开放时段（一条 = 某个星期的一段开放窗口）。
 * close <= open 视为跨夜：开放段按当日开启，结束时刻按次日计算。
 */
export interface WeeklyHour {
  /** 1=周一 … 7=周日 */
  weekday: number;
  /** HH:mm */
  open: string;
  /** HH:mm，早于等于 open 时按次日（跨夜） */
  close: string;
}

/** 例外闭馆日，覆盖当周计划（整日不开放） */
export interface ClosedDate {
  /** YYYY-MM-DD */
  date: string;
  /** 闭馆原因，如 年度维保 / 法定节假日 */
  reason?: string;
}

/** 新建点位时按设施类型给出的默认时段 */
export function defaultWeeklyHours(facilityType: FacilityType): WeeklyHour[] {
  const workday = (open: string, close: string): WeeklyHour[] =>
    WEEKDAY_ORDER.map((weekday) => ({ weekday, open, close }));
  switch (facilityType) {
    case '无障碍电梯':
      return workday('06:00', '23:00');
    case '无障碍卫生间':
      return workday('06:00', '22:00');
    case '低位服务台':
      return [1, 2, 3, 4, 5].map((weekday) => ({ weekday, open: '09:00', close: '17:00' }));
    default:
      return [];
  }
}

/** 跨夜判断：关门时刻不晚于开门时刻（00:00 收市按次日零点） */
export function isOvernight(h: Pick<WeeklyHour, 'open' | 'close'>): boolean {
  return toMinutes(h.close) <= toMinutes(h.open);
}

/** HH:mm → 分钟数 */
export function toMinutes(hhmm: string): number {
  const [h, m] = (hhmm || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
