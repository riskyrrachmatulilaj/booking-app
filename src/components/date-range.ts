import { Temporal } from '@js-temporal/polyfill';
export function businessDateRange(date: string, timezone: string) {
  const day = Temporal.PlainDate.from(date);
  return {
    from: new Date(day.toZonedDateTime(timezone).epochMilliseconds).toISOString(),
    to: new Date(day.add({ days: 30 }).toZonedDateTime(timezone).epochMilliseconds).toISOString(),
  };
}
