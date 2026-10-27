import type { ButtonHTMLAttributes, ComponentChildren, InputHTMLAttributes, Ref } from 'preact';
import { cx } from './cx';

type NativeButton = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'class' | 'className' | 'size' | 'ref'>;

/**
 * Levels: `primary` is the filled accent button, at most one per page; `secondary` (the default)
 * is outlined; `quiet` has no outline until hover and is for buttons inside rows; `danger` is an
 * outlined destructive action; `link` reads as a link.
 */
export type ButtonVariant = 'secondary' | 'primary' | 'quiet' | 'danger' | 'link';

export interface ButtonProps extends NativeButton {
  variant?: ButtonVariant;
  /** `lg` is the large start and stop button. */
  size?: 'md' | 'lg';
  /** Extra classes for layout in the module that uses it. */
  class?: string;
  buttonRef?: Ref<HTMLButtonElement>;
}

/** A button. `type` defaults to "button" so it never submits a form by accident. */
export function Button({ variant = 'secondary', size = 'md', class: extra, type = 'button', buttonRef, ...rest }: ButtonProps) {
  return <button ref={buttonRef} type={type} class={cx(variant === 'link' ? 'link' : 'btn', variant !== 'secondary' && variant !== 'link' && variant, size === 'lg' && 'big', extra)} {...rest} />;
}

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'size' | 'aria-label'> {
  /** Accessible name; also the tooltip unless `title` is given. */
  label: string;
  /** An icon from ./icons, or a short glyph. */
  icon: ComponentChildren;
}

/** A compact button showing only an icon; `label` is required so it always has a name. */
/** Icon buttons are quiet by default: they sit in rows and toolbars. */
export function IconButton({ label, icon, title, variant = 'quiet', class: extra, ...rest }: IconButtonProps) {
  return (
    <Button aria-label={label} title={title ?? label} variant={variant} class={cx('icon', extra)} {...rest}>
      {icon}
    </Button>
  );
}

export interface FileButtonProps extends Pick<InputHTMLAttributes<HTMLInputElement>, 'accept' | 'multiple' | 'disabled' | 'onChange'> {
  /** Visible text of the button. */
  label: ComponentChildren;
  /** Accessible name of the file input. */
  inputLabel: string;
  class?: string;
}

/** A file picker that looks like a button: a label around a visually hidden file input. */
export function FileButton({ label, inputLabel, class: extra, ...input }: FileButtonProps) {
  return (
    <label class={cx('btn', 'file-button', extra)}>
      {label}
      <input type="file" aria-label={inputLabel} {...input} />
    </label>
  );
}
