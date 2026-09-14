// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

afterEach(cleanup);
import { SatoshiBound } from '../src/App/Workspace/Workbenches/Graph/Filters/GraphFilterControls';

/** Mirrors how the filter panel drives the control: it owns the reported value. */
function Host({ initial }: { initial?: number }) {
  const [value, setValue] = useState<number | undefined>(initial);
  return (
    <>
      <SatoshiBound label="Minimum" value={value} onChange={setValue} />
      <button type="button" onClick={() => setValue(500)}>
        set externally
      </button>
      <button type="button" onClick={() => setValue(undefined)}>
        clear externally
      </button>
      <button type="button" onClick={() => setValue(Number.NaN)}>
        report unparsable
      </button>
    </>
  );
}

const field = () => screen.getByLabelText('Minimum') as HTMLInputElement;

describe('SatoshiBound', () => {
  it('shows the value it is given', () => {
    render(<Host initial={42} />);
    expect(field().value).toBe('42');
  });

  it('follows the value when something else changes it', () => {
    render(<Host initial={42} />);
    fireEvent.click(screen.getByText('set externally'));
    expect(field().value).toBe('500');
  });

  it('empties when the bound is cleared elsewhere', () => {
    render(<Host initial={42} />);
    fireEvent.click(screen.getByText('clear externally'));
    expect(field().value).toBe('');
  });

  it('keeps what was typed while the entry does not parse to a number', () => {
    // A partially typed entry reports NaN. Replacing the text with that value
    // would erase the entry as it is being made.
    render(<Host initial={42} />);
    fireEvent.change(field(), { target: { value: '7' } });
    fireEvent.click(screen.getByText('report unparsable'));
    expect(field().value).toBe('7');
  });

  it('reports what was typed', () => {
    render(<Host initial={undefined} />);
    fireEvent.change(field(), { target: { value: '7' } });
    expect(field().value).toBe('7');
  });
});
