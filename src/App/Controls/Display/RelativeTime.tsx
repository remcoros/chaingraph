import { useEffect, useState } from 'react';
import { formatRelativeTime } from '../../../Core/Formatting';

/** Only the age text ticks; its containing inspector does not subscribe to a clock. */
export function RelativeTime({ dateTime, active }: { dateTime: string; active: boolean }) {
  const timestamp = Date.parse(dateTime);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || !Number.isFinite(timestamp)) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      const age = Math.abs(current - timestamp);
      const interval = age < 3_600_000 ? 1000 : age < 86_400_000 ? 60_000 : 3_600_000;
      timer = setTimeout(tick, interval);
    };
    tick();
    return () => clearTimeout(timer);
  }, [timestamp, active]);
  return <span>{formatRelativeTime(timestamp, now)}</span>;
}
