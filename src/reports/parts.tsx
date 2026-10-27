import type { ComponentChildren } from 'preact';
import { Button, IconChevronDown, IconChevronRight } from '../app/ui';
import type { Amounts, Report } from './aggregate';
import { type HoursFormat, formatAmounts, formatDuration, formatPercent } from './format';

/** Small pieces shared by the three report views. */

const COLOR = /^#[0-9a-f]{3,8}$/i;

/** A project colour dot; ignores anything that is not a hex colour. */
export function ColorDot({ color }: { color: string | null }) {
  if (!color || !COLOR.test(color)) return null;
  return <span class="rp-dot" style={{ backgroundColor: color }} aria-hidden="true" />;
}

export interface ViewData {
  report: Report;
  format: HoursFormat;
}

export function Money({ amounts }: { amounts: Amounts }) {
  return <>{formatAmounts(amounts)}</>;
}

export function Totals({ report, format }: ViewData) {
  const t = report.totals;
  return (
    <dl class="rp-totals">
      <div class="card">
        <dt>Total</dt>
        <dd>{formatDuration(t.ms, format)}</dd>
      </div>
      <div class="card">
        <dt>Billable</dt>
        <dd>
          {formatDuration(t.billableMs, format)} <span class="rp-sub">{formatPercent(t.billableMs, t.ms)}</span>
        </dd>
      </div>
      <div class="card">
        <dt>Amount</dt>
        <dd>
          <Money amounts={t.amounts} />
        </dd>
      </div>
    </dl>
  );
}

export function Scroll({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div class="rp-scroll" tabIndex={0} role="region" aria-label={label}>
      {children}
    </div>
  );
}

export interface DisclosureProps {
  id: string;
  title: ComponentChildren;
  open: boolean;
  onToggle(open: boolean): void;
  /** Shown beside the title while open. */
  actions?: ComponentChildren;
  /** Wrap the title in an `h2`; off for a line that is not a section (the filters). */
  heading?: boolean;
  children?: ComponentChildren;
}

/** The one collapsible style of the page: a chevron button, optional actions, then the body. */
export function Disclosure({ id, title, open, onToggle, actions, heading = true, children }: DisclosureProps) {
  const button = (
    <Button class="rp-fold" aria-expanded={open} aria-controls={`rp-${id}-body`} onClick={() => onToggle(!open)}>
      {open ? <IconChevronDown /> : <IconChevronRight />}
      <span class="rp-fold-text">{title}</span>
    </Button>
  );
  return (
    <section class="rp-section" id={`rp-${id}`} aria-labelledby={heading ? `rp-${id}-h` : undefined}>
      <div class="row rp-section-head">
        {heading ? <h2 id={`rp-${id}-h`}>{button}</h2> : button}
        {open && actions}
      </div>
      {open && <div id={`rp-${id}-body`}>{children}</div>}
    </section>
  );
}
