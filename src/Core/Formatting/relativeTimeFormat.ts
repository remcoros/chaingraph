/** Compact calendar age, with finer units for recent timestamps. */
export function formatRelativeTime(timestamp: number, now: number): string | undefined {
  const from = new Date(Math.min(timestamp, now));
  const to = new Date(Math.max(timestamp, now));
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) return undefined;
  const seconds = Math.floor((to.getTime() - from.getTime()) / 1000);
  if (seconds < 5) return 'Just now';

  const monthStart = (months: number) => {
    const date = new Date(from);
    date.setUTCDate(1);
    date.setUTCMonth(from.getUTCMonth() + months);
    const end = new Date(date);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
    date.setUTCDate(Math.min(from.getUTCDate(), end.getUTCDate()));
    return date.getTime();
  };
  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth();
  if (monthStart(months) > to.getTime()) months--;
  const days = Math.floor((to.getTime() - monthStart(months)) / 86_400_000);
  const parts: [number, string][] =
    months >= 12
      ? [
          [Math.floor(months / 12), 'y'],
          [months % 12, 'm'],
          [days, 'd'],
        ]
      : months > 0
        ? [
            [months, 'm'],
            [days, 'd'],
          ]
        : seconds >= 86_400
          ? [
              [Math.floor(seconds / 86_400), 'd'],
              [Math.floor((seconds % 86_400) / 3600), 'h'],
            ]
          : seconds >= 3600
            ? [
                [Math.floor(seconds / 3600), 'h'],
                [Math.floor((seconds % 3600) / 60), 'm'],
              ]
            : seconds >= 60
              ? [
                  [Math.floor(seconds / 60), 'm'],
                  [seconds % 60, 's'],
                ]
              : [[seconds, 's']];
  const age = parts
    .filter(([value]) => value > 0)
    .map(([value, unit]) => `${value}${unit}`)
    .join(' ');
  return timestamp > now ? `in ${age}` : `${age} ago`;
}
