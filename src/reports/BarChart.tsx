import type { RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Granularity, TimeBucket } from './aggregate';
import { dayShortLabel } from './dates';
import { type HoursFormat, formatDuration } from './format';
import { labelStride, niceScale, tickLabel } from './chart';
import { Disclosure } from './parts';

const H = 3_600_000;
const HEIGHT = 220;
const MARGIN = { top: 10, right: 8, bottom: 26, left: 52 };

/** Width of the element in pixels, tracked with a ResizeObserver when the browser has one. */
function useWidth(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => {
      const w = Math.floor(el.clientWidth);
      if (w > 0) setWidth(w);
    };
    measure();
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  return [ref, width];
}

export interface BarChartProps {
  buckets: TimeBucket[];
  granularity: Granularity;
  format: HoursFormat;
  /** Describes the range for the accessible name, for example `2025-03-03 to 2025-03-09`. */
  rangeText: string;
}

const UNIT: Record<Granularity, string> = { day: 'day', week: 'week', month: 'month' };

/**
 * Hand-drawn SVG: stacked bars (billable, other) per day, week or month. No chart library.
 * The picture is one image for screen readers; the same numbers are available as a table below it.
 */
export function BarChart({ buckets, granularity, format, rangeText }: BarChartProps) {
  const [dataOpen, setDataOpen] = useState(false);
  const [ref, width] = useWidth();
  const maxMs = buckets.reduce((m, b) => Math.max(m, b.ms), 0);
  const scale = niceScale(maxMs);
  const plotW = Math.max(width - MARGIN.left - MARGIN.right, 40);
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const slot = plotW / Math.max(buckets.length, 1);
  const barW = Math.max(Math.min(slot * 0.72, 48), 1);
  const yOf = (hours: number): number => MARGIN.top + plotH - (hours / scale.max) * plotH;
  const useWeekdays = granularity === 'day' && buckets.length <= 10;
  const stride = labelStride(buckets.length, plotW, useWeekdays ? 52 : granularity === 'day' ? 22 : 56);
  const total = buckets.reduce((a, b) => a + b.ms, 0);
  const title = `Hours per ${UNIT[granularity]}, ${rangeText}`;
  const desc = `Stacked bars of billable and other time. Total ${formatDuration(total, format)}. The same numbers are in the table below the chart.`;

  return (
    <div class="rp-chart" ref={ref}>
      <svg class="rp-svg" width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-labelledby="rp-chart-title rp-chart-desc">
        <title id="rp-chart-title">{title}</title>
        <desc id="rp-chart-desc">{desc}</desc>
        {scale.ticks.map((t) => (
          <g key={t}>
            <line class="rp-grid" x1={MARGIN.left} x2={MARGIN.left + plotW} y1={yOf(t)} y2={yOf(t)} />
            <text class="rp-axis-text" x={MARGIN.left - 6} y={yOf(t)} text-anchor="end" dominant-baseline="middle">
              {tickLabel(t, format)}
            </text>
          </g>
        ))}
        {buckets.map((b, i) => {
          const x = MARGIN.left + i * slot + (slot - barW) / 2;
          const billH = (b.billableMs / H / scale.max) * plotH;
          const totalH = (b.ms / H / scale.max) * plotH;
          const otherH = Math.max(totalH - billH, 0);
          const base = MARGIN.top + plotH;
          const label = granularity === 'day' && useWeekdays ? dayShortLabel(b.key) : b.short;
          return (
            <g key={b.key}>
              <title>{`${b.label}: ${formatDuration(b.ms, format)}, billable ${formatDuration(b.billableMs, format)}`}</title>
              {billH > 0 && <rect class="rp-bar-billable" x={x} y={base - billH} width={barW} height={billH} />}
              {otherH > 0 && <rect class="rp-bar-other" x={x} y={base - billH - otherH} width={barW} height={otherH} />}
              {i % stride === 0 && (
                <text class="rp-axis-text" x={x + barW / 2} y={HEIGHT - 8} text-anchor="middle">
                  {label}
                </text>
              )}
            </g>
          );
        })}
        <line class="rp-axis-line" x1={MARGIN.left} x2={MARGIN.left + plotW} y1={MARGIN.top + plotH} y2={MARGIN.top + plotH} />
      </svg>
      <p class="rp-legend" aria-hidden="true">
        <span class="rp-swatch rp-swatch-billable" /> Billable <span class="rp-swatch rp-swatch-other" /> Not billable
      </p>
      <Disclosure id="chart-data" title="Chart data as a table" heading={false} open={dataOpen} onToggle={setDataOpen}>
        <div class="rp-scroll" tabIndex={0} role="region" aria-label="Chart data table">
          <table>
            <caption class="rp-sr">{title}</caption>
            <thead>
              <tr>
                <th scope="col">{granularity === 'day' ? 'Day' : granularity === 'week' ? 'Week' : 'Month'}</th>
                <th scope="col" class="rp-num">Total</th>
                <th scope="col" class="rp-num">Billable</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => (
                <tr key={b.key}>
                  <th scope="row">{b.label}</th>
                  <td class="rp-num">{formatDuration(b.ms, format)}</td>
                  <td class="rp-num">{formatDuration(b.billableMs, format)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Disclosure>
    </div>
  );
}
