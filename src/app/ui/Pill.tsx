import type { ComponentChildren, HTMLAttributes } from 'preact';
import { cx } from './cx';

export type PillTone = 'quiet' | 'outline' | 'neutral' | 'current';

export interface PillProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'class' | 'className'> {
  /** quiet: filled; outline: bordered; neutral: filled and bordered; current: bordered in the text colour. */
  tone?: PillTone;
  /** Muted text (default), or the surrounding text colour. */
  muted?: boolean;
  class?: string;
  children?: ComponentChildren;
}

/** A small rounded label: a status, a tag, a badge. */
export function Pill({ tone = 'neutral', muted = tone !== 'current', class: extra, ...rest }: PillProps) {
  return <span class={cx('pill', `pill-${tone}`, muted && 'pill-muted', extra)} {...rest} />;
}
