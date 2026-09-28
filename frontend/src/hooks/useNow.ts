import { useEffect, useState } from 'react';

/**
 * 当前时刻心跳：开放状态随时间自动翻转（开放中 → 即将关闭 → 已关闭）。
 * 调整出发时间/时段时各页通过 useMemo 立即重算，不依赖心跳。
 */
export function useNow(intervalMs = 30000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
