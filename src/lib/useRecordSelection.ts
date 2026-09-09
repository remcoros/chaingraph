import { useRef, useState } from 'react';

type Gesture = { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean };

/** Transient explicit selection. Ranges never reach beyond the supplied displayed rows. */
export function useRecordSelection() {
  const [ids, setIds] = useState<string[]>([]);
  const anchor = useRef<string | undefined>(undefined);
  const choose = (id: string, visible: readonly string[], event: Gesture, toggle = false) => {
    const first = anchor.current ? visible.indexOf(anchor.current) : -1;
    const last = visible.indexOf(id);
    if (event.shiftKey && first >= 0 && last >= 0) {
      const range = visible.slice(Math.min(first, last), Math.max(first, last) + 1);
      setIds((current) =>
        event.ctrlKey || event.metaKey ? [...new Set([...current, ...range])] : [...range],
      );
    } else {
      anchor.current = id;
      setIds((current) =>
        toggle || event.ctrlKey || event.metaKey
          ? current.includes(id)
            ? current.filter((entry) => entry !== id)
            : [...current, id]
          : [id],
      );
    }
  };
  const clear = () => {
    setIds([]);
    anchor.current = undefined;
  };
  return {
    ids,
    setIds,
    choose,
    clear,
    anchorAt: (id: string) => {
      anchor.current = id;
    },
  };
}
