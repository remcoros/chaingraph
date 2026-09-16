import { useEffect, useRef } from 'react';

export function useWorkspaceRead(onClose: () => void) {
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  return {
    start: () => {
      pending.current?.abort();
      const controller = new AbortController();
      pending.current = controller;
      return controller.signal;
    },
    close: () => {
      pending.current?.abort();
      onClose();
    },
  };
}
