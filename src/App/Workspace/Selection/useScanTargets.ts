import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isScanNodeId } from '../../../Domain/ConnectionScan/connectionScan';
import { prepareCustomScanTargets } from '../../../Domain/ConnectionScan/connectionScanTargets';

/** An in-progress pick, scoped to the workspace and source node it started from. */
export interface ScanTargetDraft {
  workspaceId: string;
  source: string;
  ids: string[];
}

export interface ScanTargets {
  /** Confirmed targets for the next scan. */
  targets: string[];
  draft: ScanTargetDraft | undefined;
  /** True while the draft belongs to this workspace and the canvas can accept picks. */
  picking: boolean;
  /** Prepared target count, or the reason the draft cannot be prepared. */
  preview: { targetCount?: number; error?: string };
  beginPicking: (source: string, invoker: HTMLElement) => void;
  cancelPicking: () => void;
  /** Adds or removes a picked target. The source node itself can never be one. */
  toggle: (id: string) => void;
  /** Ends picking, keeping the draft as the confirmed targets when applied. */
  finish: (apply: boolean) => void;
  removeTarget: (id: string) => void;
  reset: () => void;
}

interface Inputs {
  workspaceId: string | undefined;
  /** Whether the current view can accept picks, from the workbench and tab in view. */
  canPick: boolean;
  onSelectSource: (id: string) => void;
  onShowPanel: (panel: 'graph' | 'right') => void;
}

export function useScanTargets({
  workspaceId,
  canPick,
  onSelectSource,
  onShowPanel,
}: Inputs): ScanTargets {
  const [targets, setTargets] = useState<string[]>([]);
  const [draft, setDraft] = useState<ScanTargetDraft>();
  const invoker = useRef<HTMLElement | null>(null);
  const picking = !!draft && draft.workspaceId === workspaceId && canPick;
  useEffect(() => {
    if (!picking) setDraft(undefined);
  }, [picking]);
  const toggle = useCallback((id: string) => {
    if (!isScanNodeId(id)) return;
    setDraft((current) =>
      !current || id === current.source
        ? current
        : {
            ...current,
            ids: current.ids.includes(id)
              ? current.ids.filter((target) => target !== id)
              : [...current.ids, id],
          },
    );
  }, []);
  const preview = useMemo(() => {
    if (!workspaceId || !draft || draft.workspaceId !== workspaceId) return {};
    try {
      return {
        targetCount: prepareCustomScanTargets({
          pickedNodeIds: draft.ids,
          source: draft.source,
        }).length,
      };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : 'Targets could not be prepared.' };
    }
  }, [draft, workspaceId]);
  return {
    targets,
    draft,
    picking,
    preview,
    beginPicking: (source, element) => {
      if (!workspaceId || !isScanNodeId(source)) return;
      invoker.current = element;
      setDraft({ workspaceId, source, ids: targets.filter((id) => id !== source) });
      onShowPanel('graph');
    },
    cancelPicking: () => setDraft(undefined),
    toggle,
    finish: (apply) => {
      if (apply && draft) setTargets(draft.ids);
      if (draft) onSelectSource(draft.source);
      setDraft(undefined);
      onShowPanel('right');
      // The panel that opened picking regains focus once the toolbar unmounts.
      requestAnimationFrame(() => invoker.current?.focus({ preventScroll: true }));
    },
    removeTarget: (id) => setTargets((ids) => ids.filter((target) => target !== id)),
    reset: () => {
      setTargets([]);
      setDraft(undefined);
    },
  };
}
