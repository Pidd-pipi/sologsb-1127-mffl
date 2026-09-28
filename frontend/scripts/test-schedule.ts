import assert from 'node:assert';
import type { AccessPoint } from '../src/types/point';
import { getOpenInfo, isOpenAt, nextOpenAt, formatNextOpen } from '../src/utils/schedule';
import { planChainArrivals, travelMinutes } from '../src/utils/routeTiming';

function basePoint(partial: Partial<AccessPoint>): AccessPoint {
  return {
    id: 't',
    code: 'T',
    name: 't',
    facilityType: '无障碍电梯',
    lng: 0,
    lat: 0,
    district: '',
    location: '',
    builtYear: 2020,
    maintainUnit: '',
    weeklyHours: [],
    closedDates: [],
    createdAt: '',
    updatedAt: '',
    ...partial,
  };
}

// 2026-09-28 是周一
const mon = new Date(2026, 8, 28);

// 1) 工作日 09:00-17:00：周一 10:00 开放
const desk = basePoint({
  weeklyHours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, open: '09:00', close: '17:00' })),
});
assert.equal(getOpenInfo(desk, new Date(2026, 8, 28, 10)).state, 'open');
assert.equal(getOpenInfo(desk, new Date(2026, 8, 28, 8)).state, 'closed');
// 周一 08:00 最近开放 = 今天 09:00
assert.equal(formatNextOpen(nextOpenAt(desk, new Date(2026, 8, 28, 8)), mon), '今天 09:00');
// 周一 18:00 最近开放 = 明天 09:00
assert.equal(formatNextOpen(nextOpenAt(desk, new Date(2026, 8, 28, 18)), mon), '明天 09:00');
// 周六 10:00 最近开放 = 周一 09:00（间隔 2 天，显示“后天”）
const sat = new Date(2026, 9, 3, 10);
assert.equal(formatNextOpen(nextOpenAt(desk, sat), sat), '后天 09:00');

// 2) 跨夜 22:00-02:00（close < open）
const overnight = basePoint({
  weeklyHours: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, open: '22:00', close: '02:00' })),
});
assert.equal(isOpenAt(overnight, new Date(2026, 8, 28, 23)), true); // 周一深夜
assert.equal(isOpenAt(overnight, new Date(2026, 8, 29, 1)), true); // 周二凌晨（前一日跨夜段）
// 周六跨夜段在周日凌晨有效
assert.equal(isOpenAt(overnight, new Date(2026, 9, 4, 1, 0)), true);
assert.equal(isOpenAt(overnight, new Date(2026, 9, 4, 3, 0)), false); // 周日 03:00 已收

// 3) 闭馆日覆盖周计划：周二闭馆
const closed = basePoint({
  weeklyHours: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, open: '06:00', close: '23:00' })),
  closedDates: [{ date: '2026-09-29', reason: '维保' }],
});
assert.equal(getOpenInfo(closed, new Date(2026, 8, 29, 10)).state, 'closed');
const tue = new Date(2026, 8, 29, 10);
assert.match(getOpenInfo(closed, tue).reason, /维保/);
assert.equal(formatNextOpen(nextOpenAt(closed, tue), tue), '明天 06:00');

// 4) 跨夜段次日为闭馆日：周一 22:00-02:00，周二闭馆 → 周一晚段截到周二 00:00
const cut = basePoint({
  weeklyHours: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, open: '22:00', close: '02:00' })),
  closedDates: [{ date: '2026-09-29', reason: '维保' }],
});
assert.equal(isOpenAt(cut, new Date(2026, 8, 28, 23)), true);
assert.equal(isOpenAt(cut, new Date(2026, 9, 0, 1)), false); // 周二凌晨截断
assert.equal(getOpenInfo(cut, new Date(2026, 8, 28, 23, 40)).state, 'closing-soon');

// 5) 道路类（无时段）全天开放；闭馆日仍生效
const road = basePoint({ facilityType: '盲道', weeklyHours: [] });
assert.equal(getOpenInfo(road, new Date(2026, 8, 28, 3)).state, 'open');
const roadClosed = basePoint({
  facilityType: '盲道',
  weeklyHours: [],
  closedDates: [{ date: '2026-09-29' }],
});
assert.equal(getOpenInfo(roadClosed, new Date(2026, 8, 29, 3)).state, 'closed');

// 6) 路线链：1.4 m/s，1400 m → ceil(1000s)=17 分钟；低位服务台 09:00 出发 09:17 到达可入链
assert.equal(travelMinutes(1400), 17);
const map = new Map<string, AccessPoint>([
  ['a', road],
  ['b', desk],
]);
const arrivals = planChainArrivals(['a', 'b'], [1400], new Date(2026, 8, 28, 9), map);
assert.equal(arrivals[1].enterable, true);
// 08:00 出发 08:17 到达 → 未开
const early = planChainArrivals(['a', 'b'], [1400], new Date(2026, 8, 28, 8), map);
assert.equal(early[1].enterable, false);
assert.equal(formatNextOpen(early[1].info.nextOpen, early[1].arriveAt), '今天 09:00');

console.log('schedule tests passed');
