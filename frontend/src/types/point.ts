/** 设施类型（六个枚举值，与提示词一致） */
export type FacilityType =
  | '缘石坡道'
  | '盲道'
  | '无障碍电梯'
  | '轮椅坡道'
  | '无障碍卫生间'
  | '低位服务台';

export const FACILITY_TYPES: FacilityType[] = [
  '缘石坡道',
  '盲道',
  '无障碍电梯',
  '轮椅坡道',
  '无障碍卫生间',
  '低位服务台',
];

/** 行政区（北京市主要城区） */
export const DISTRICTS = ['东城区', '西城区', '朝阳区', '海淀区', '丰台区', '石景山区'] as const;

export type District = (typeof DISTRICTS)[number];

/** 星期几：1=周一 … 7=周日 */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7];

export const WEEKDAY_LABELS: Record<number, string> = {
  1: '周一',
  2: '周二',
  3: '周三',
  4: '周四',
  5: '周五',
  6: '周六',
  7: '周日',
};

/**
 * 每周固定开放时段。
 * 同一天可配置多条；end <= start 表示跨夜（按到达日的次日规则判定）。
 */
export interface WeeklySlot {
  weekday: Weekday;
  /** 开始时刻 HH:mm */
  start: string;
  /** 结束时刻 HH:mm，不晚于 start 时视为营业至次日该时刻 */
  end: string;
}

/** 例外闭馆日：优先级高于每周计划，可跨年配置 */
export interface ClosureDay {
  /** YYYY-MM-DD */
  date: string;
  /** 闭馆原因，如 设备检修 / 法定节假日 */
  reason: string;
}

/** 养护单位 */
export const MAINTAIN_UNITS = [
  '市政道路养护一所',
  '市政道路养护二所',
  '轨道交通运营部',
  '园林绿化服务中心',
  '城管委设施科',
] as const;

/** 设施点位 */
export interface AccessPoint {
  id: string;
  /** 点位编号，例：WZ-2024-001 */
  code: string;
  name: string;
  facilityType: FacilityType;
  lng: number;
  lat: number;
  district: string;
  /** 所在道路或建筑 */
  location: string;
  /** 建成年代 */
  builtYear: number;
  maintainUnit: string;
  /** 每周固定开放时段；空数组视为全天开放（室外设施） */
  weeklyHours: WeeklySlot[];
  /** 例外闭馆日；命中当天周计划失效（含跨夜时段的到达日判定） */
  closureDays: ClosureDay[];
  createdAt: string;
  updatedAt: string;
}

export type AccessPointDraft = Omit<AccessPoint, 'id' | 'createdAt' | 'updatedAt'>;
