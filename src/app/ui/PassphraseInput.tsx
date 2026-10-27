import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { passphraseHint } from '../../core/passphrase-rules';
import { cx } from './cx';

export interface PassphraseInputProps {
  value: string;
  onInput(value: string): void;
  /** The field's accessible name. */
  label: string;
  autocomplete?: 'new-password' | 'current-password' | 'off';
  onEnter?(): void;
  /** Show the live length hint under the field: for fields that set a passphrase, never for unlocking. */
  hint?: boolean;
  class?: string;
}

/** A passphrase field with a "Show" switch (F-309); with `hint`, the live length hint underneath. Nothing is sent anywhere. */
export function PassphraseInput({ value, onInput, label, autocomplete = 'off', onEnter, hint, class: extra }: PassphraseInputProps): JSX.Element {
  const [shown, setShown] = useState(false);
  const h = hint ? passphraseHint(value) : undefined;
  return (
    <span class={cx('passphrase-input', extra)}>
      <input
        type={(shown ? 'text' : 'password') as 'password'}
        aria-label={label}
        autocomplete={autocomplete}
        spellcheck={false}
        autocapitalize="off"
        value={value}
        onInput={(e) => onInput((e.target as HTMLInputElement).value)}
        onKeyDown={onEnter ? (e) => e.key === 'Enter' && onEnter() : undefined}
      />
      <label class="passphrase-show">
        <input type="checkbox" checked={shown} onChange={(e) => setShown((e.target as HTMLInputElement).checked)} /> Show
      </label>
      {h ? (
        <span class={cx('passphrase-hint', h.level)} role="status">
          {h.text}
        </span>
      ) : null}
    </span>
  );
}
