import { useId, useState, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export function focusDialogField(input: HTMLInputElement | null) {
  if (!input) return;
  input.focus({ preventScroll: true });
  const modal = input.closest<HTMLElement>('.modal');
  if (!modal) return;
  const fieldBounds = input.getBoundingClientRect();
  const modalBounds = modal.getBoundingClientRect();
  if (fieldBounds.top < modalBounds.top + 16)
    modal.scrollTop += fieldBounds.top - modalBounds.top - 16;
  else if (fieldBounds.bottom > modalBounds.bottom - 16)
    modal.scrollTop += fieldBounds.bottom - modalBounds.bottom + 16;
}

/** Local encryption actions do not submit website sign-in credentials. */
export function PasswordControls({
  children,
  label,
  action,
  disabled,
  onConfirm,
}: {
  children: ReactNode;
  label: string;
  action: ReactNode;
  disabled?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <div
      className="stack"
      role="group"
      aria-label={label}
      onKeyDown={(event) => {
        const input = event.target as HTMLInputElement;
        // Preserve Enter in single-line fields without a native form submission.
        // Textareas, buttons, links and IME composition retain their own behavior.
        if (
          disabled ||
          event.defaultPrevented ||
          event.key !== 'Enter' ||
          event.repeat ||
          event.nativeEvent.isComposing ||
          event.keyCode === 229 ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          input.tagName !== 'INPUT' ||
          !['text', 'password'].includes(input.type) ||
          input.disabled ||
          input.readOnly
        )
          return;
        event.preventDefault();
        void onConfirm();
      }}
    >
      {children}
      <button
        type="button"
        className="primary"
        disabled={disabled}
        onClick={() => void onConfirm()}
      >
        {action}
      </button>
    </div>
  );
}

export function PasswordField({
  label = 'Password',
  value,
  onChange,
  disabled,
  autofocus,
  describedBy,
  invalid,
  inputRef,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autofocus?: boolean;
  describedBy?: string;
  invalid?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-field">
      <label htmlFor={id}>{label}</label>
      <div className="password-input">
        <input
          id={id}
          ref={inputRef}
          type={visible ? 'text' : 'password'}
          autoComplete="off"
          data-autofocus={autofocus || undefined}
          required
          maxLength={1024}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="icon-button"
          aria-label={`${visible ? 'Hide' : 'Show'} ${label === 'Confirm password' ? 'confirmation' : 'password'}`}
          aria-pressed={visible}
          tabIndex={-1}
          title={`${visible ? 'Hide' : 'Show'} ${label === 'Confirm password' ? 'confirmation' : 'password'}`}
          disabled={disabled}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
}
