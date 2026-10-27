import { useEffect, useId, useRef } from 'preact/hooks';
import { useNow } from '../app/hooks';
import type { ClientRecord, ProjectRecord } from './catalog';
import { type EntryRecord, isRunning, recentDescriptions } from './entries';
import { formatClock, formatHours, type HoursFormat } from './format';
import { totalSeconds } from './stats';

/** Colour swatch for a project; colour is validated before it reaches the style. */
export function Swatch({ color }: { color: string | undefined }) {
  const safe = color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : 'transparent';
  return <span class="swatch" style={{ background: safe }} aria-hidden="true" />;
}

export function ProjectChip({ project, client }: { project: ProjectRecord | undefined; client: ClientRecord | undefined }) {
  if (!project) return null;
  return (
    <span class="project-chip" title={client ? `${project.name} (${client.name})` : project.name}>
      <Swatch color={project.color} />
      <span>{project.name}</span>
      {client && <span class="muted">{client.name}</span>}
    </span>
  );
}

export interface DescriptionFieldProps {
  value: string;
  entries: readonly EntryRecord[];
  placeholder?: string;
  /** Every keystroke. */
  onText?(text: string): void;
  /** Blur or Enter. */
  onCommit?(text: string): void;
  /** A recent description was picked from the suggestions. */
  onPick?(entry: EntryRecord): void;
  onEnter?(text: string): void;
  label?: string;
}

export function DescriptionField({ value, entries, placeholder, onText, onCommit, onPick, onEnter, label = 'Description' }: DescriptionFieldProps) {
  // Uncontrolled on purpose: the browser owns what is being typed, and the prop only replaces it
  // when it changes while the field is not being edited (another device, continue, stop).
  const listId = useId();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = ref.current;
    if (input && input.value !== value && document.activeElement !== input) input.value = value;
  }, [value]);
  const suggestions = recentDescriptions(entries);
  return (
    <>
      <input
        ref={ref}
        type="text"
        class="description"
        aria-label={label}
        placeholder={placeholder ?? 'What are you working on?'}
        list={listId}
        defaultValue={value}
        onInput={(e) => {
          const v = (e.target as HTMLInputElement).value;
          const kind = (e as unknown as InputEvent).inputType;
          onText?.(v);
          if (onPick && (kind === undefined || kind === 'insertReplacementText')) {
            const hit = suggestions.find((s) => s.description === v);
            if (hit) onPick(hit);
          }
        }}
        onChange={(e) => onCommit?.((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const v = (e.target as HTMLInputElement).value;
            if (onEnter) onEnter(v);
            else onCommit?.(v);
          }
        }}
      />
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s.id} value={s.description} />
        ))}
      </datalist>
    </>
  );
}

/** The running timer's clock; the only thing that re-renders every second. */
export function LiveClock({ since }: { since: number }) {
  const now = useNow(1000);
  return <time class="clock">{formatClock((now - since) / 1000)}</time>;
}

/** A total over entries; ticks while any is running. */
export function Total({ entries, format }: { entries: readonly EntryRecord[]; format: HoursFormat }) {
  const running = entries.some(isRunning);
  const now = useNow(running ? 1000 : 3_600_000);
  return <span class="total">{formatHours(totalSeconds(entries, now), format)}</span>;
}

