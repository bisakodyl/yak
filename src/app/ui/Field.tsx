import type { ComponentChildren } from 'preact';
import { cx } from './cx';

export interface FieldProps {
  /** The visible label; the control inside is named by it. */
  label: ComponentChildren;
  /** stacked: label above; inline: muted label beside; split: label left, control right. */
  layout?: 'stacked' | 'inline' | 'split';
  class?: string;
  children: ComponentChildren;
}

/** A label wrapped around one control, so clicking the label focuses it and it has a name. */
export function Field({ label, layout = 'stacked', class: extra, children }: FieldProps) {
  return (
    <label class={cx(`field-${layout}`, extra)}>
      <span class="field-label">{label}</span>
      {children}
    </label>
  );
}
