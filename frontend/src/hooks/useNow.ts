import { useEffect, useState } from 'react';

/**
 * 周期性刷新的「当前时刻」，驱动地图与总览的开放状态实时重算。
 * 默认每 30 秒跳一次；页面隐藏时暂停。
 */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer === null) timer = setInterval(() => setNow(new Date()), intervalMs);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        setNow(new Date());
        start();
      } else {
        stop();
      }
    };
    start();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs]);
  return now;
}
