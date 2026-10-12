import { useState, type SetStateAction } from 'react';

type Gesture = { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean };

export interface RecordSelection {
  ids: string[];
  anchor?: string;
}

/** Ranges remain bounded to displayed records, including when an anchor is hidden. */
export function chooseRecords(
  current: RecordSelection,
  id: string,
  visible: readonly string[],
  event: Gesture,
  toggle = false,
): RecordSelection {
  const first = current.anchor ? visible.indexOf(current.anchor) : -1;
  const last = visible.indexOf(id);
  if (event.shiftKey && first >= 0 && last >= 0) {
    const range = visible.slice(Math.min(first, last), Math.max(first, last) + 1);
    return {
      ...current,
      ids: event.ctrlKey || event.metaKey ? [...new Set([...current.ids, ...range])] : [...range],
    };
  }
  return {
    anchor: id,
    ids:
      toggle || event.ctrlKey || event.metaKey
        ? current.ids.includes(id)
          ? current.ids.filter((entry) => entry !== id)
          : [...current.ids, id]
        : [id],
  };
}

/** Transient explicit selection. Ranges never reach beyond the supplied displayed rows. */
export function useRecordSelection() {
  const [selection, setSelection] = useState<RecordSelection>({ ids: [] });
  const choose = (id: string, visible: readonly string[], event: Gesture, toggle = false) => {
    setSelection((current) => chooseRecords(current, id, visible, event, toggle));
  };
  const clear = () => {
    setSelection((current) => (current.ids.length || current.anchor ? { ids: [] } : current));
  };
  return {
    ids: selection.ids,
    setIds: (next: SetStateAction<string[]>) =>
      setSelection((current) => ({
        ...current,
        ids: typeof next === 'function' ? next(current.ids) : next,
      })),
    choose,
    clear,
    anchorAt: (id: string) => {
      setSelection((current) => ({ ...current, anchor: id }));
    },
  };
}
