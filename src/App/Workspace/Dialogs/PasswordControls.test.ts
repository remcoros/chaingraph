import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type KeyboardEvent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog';
import { ImportWorkspaceDialog } from './ImportWorkspaceDialog';
import { PasswordControls } from './PasswordControls';
import { UnlockWorkspaceDialog } from './UnlockWorkspaceDialog';

beforeEach(() => vi.stubGlobal('document', { activeElement: null }));
afterEach(() => vi.unstubAllGlobals());

function keyboardEvent(changes: Record<string, unknown> = {}) {
  return {
    key: 'Enter',
    keyCode: 13,
    repeat: false,
    defaultPrevented: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    nativeEvent: { isComposing: false },
    target: { tagName: 'INPUT', type: 'password', disabled: false, readOnly: false },
    preventDefault: vi.fn(),
    ...changes,
  } as unknown as KeyboardEvent<HTMLDivElement>;
}
function controls(disabled = false) {
  const confirm = vi.fn();
  const element = PasswordControls({
    label: 'Local encryption',
    action: 'Unlock workspace',
    children: null,
    disabled,
    onConfirm: confirm,
  });
  return {
    confirm,
    key: element.props.onKeyDown as (event: KeyboardEvent<HTMLDivElement>) => void,
    element,
  };
}

describe('local workspace password actions', () => {
  it('routes Enter in a password field to the explicit action without form submission', () => {
    const s = controls();
    const event = keyboardEvent();
    s.key(event);
    expect(s.confirm).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(s.element.type).toBe('div');
    expect(s.element.props.role).toBe('group');
    expect(s.element.props.onSubmit).toBeUndefined();
  });
  it('preserves Enter from the workspace name field', () => {
    const s = controls();
    s.key(keyboardEvent({ target: { tagName: 'INPUT', type: 'text' } }));
    expect(s.confirm).toHaveBeenCalledOnce();
  });
  it.each([
    ['multiline description', { target: { tagName: 'TEXTAREA' } }],
    ['navigation link', { target: { tagName: 'A' } }],
    ['reveal or action button', { target: { tagName: 'BUTTON' } }],
    ['network selection', { target: { tagName: 'SELECT' } }],
    ['read-only field', { target: { tagName: 'INPUT', type: 'text', readOnly: true } }],
    ['disabled field', { target: { tagName: 'INPUT', type: 'password', disabled: true } }],
    ['IME composition', { nativeEvent: { isComposing: true } }],
    ['IME compatibility key', { keyCode: 229 }],
    ['held Enter', { repeat: true }],
    ['modified Enter', { ctrlKey: true }],
    ['already handled key', { defaultPrevented: true }],
  ])('does not run encryption from %s', (_label, changes) => {
    const s = controls();
    const event = keyboardEvent(changes);
    s.key(event);
    expect(s.confirm).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
  it('does not run an unavailable or busy action from Enter', () => {
    const s = controls(true);
    s.key(keyboardEvent());
    expect(s.confirm).not.toHaveBeenCalled();
  });
  it('uses the same action for explicit button activation', () => {
    const s = controls();
    const button = s.element.props.children.at(-1);
    expect(button.props.type).toBe('button');
    button.props.onClick();
    expect(s.confirm).toHaveBeenCalledOnce();
  });
});

describe('password dialog markup without a browser', () => {
  const dialogs = [
    [
      'create',
      () =>
        createElement(CreateWorkspaceDialog, {
          networks: ['testnet4'],
          onCreate: vi.fn(),
          onClose: vi.fn(),
        }),
      2,
    ],
    [
      'unlock',
      () =>
        createElement(UnlockWorkspaceDialog, {
          entry: { id: 'public-fixture', savedAt: '2026-09-10T00:00:00Z' },
          onUnlock: vi.fn().mockResolvedValue(undefined),
          onClose: vi.fn(),
        }),
      1,
    ],
    [
      'import',
      () =>
        createElement(ImportWorkspaceDialog, {
          file: new File(['public synthetic bytes'], 'public-workspace.json'),
          onImport: vi.fn(),
          onClose: vi.fn(),
        }),
      1,
    ],
  ] as const;
  it.each(dialogs)(
    '%s keeps labelled, masked password controls without a native credential submit route',
    (_name, render, count) => {
      const html = renderToStaticMarkup(render());
      expect(html).toContain('role="dialog"');
      expect(html).toContain('role="group"');
      expect(html).not.toMatch(/<form\b/);
      const passwords = [...html.matchAll(/<input\b[^>]*type="password"[^>]*>/g)].map(
        ([value]) => value,
      );
      expect(passwords).toHaveLength(count);
      for (const field of passwords) {
        expect(field).toContain('autoComplete="off"');
        const id = /id="([^"]+)"/.exec(field)![1];
        expect(html).toContain(`for="${id}"`);
      }
      const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map(([value]) => value);
      expect(buttons.length).toBeGreaterThan(count);
      expect(buttons.every((button) => button.includes('type="button"'))).toBe(true);
    },
  );
});
