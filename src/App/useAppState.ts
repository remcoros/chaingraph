import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createChainDataAcquisition } from '../Core/Workspace/Session/chainDataAcquisition';
import type { Workspace } from '../Core/Workspace/workspace';
import { useBackendNetworks } from './useBackendNetworks';
import { useWorkspaces } from './Workspace/Store/useWorkspaces';
import type { SavedWorkspace } from '../Core/Workspace/Persistence';
import { appServices } from './appServices';
export function useAppState() {
  const workspaces = useWorkspaces(appServices.workspaceStore);
  const activeWorkspace = workspaces.active?.data;
  const fetchScope = workspaces.active?.fetchScope;
  const getUnlockedWorkspace = workspaces.getUnlocked;
  const workspaceId = activeWorkspace?.id;
  const workspaceNetwork = activeWorkspace?.network;
  const workspaceDemo = activeWorkspace?.demo;
  const chainDataAcquisition = useMemo(
    () =>
      createChainDataAcquisition({
        activeWorkspace:
          workspaceId && workspaceNetwork
            ? { id: workspaceId, network: workspaceNetwork, demo: !!workspaceDemo }
            : undefined,
        getUnlocked: getUnlockedWorkspace,
        fetchScope,
      }),
    [workspaceId, workspaceNetwork, workspaceDemo, getUnlockedWorkspace, fetchScope],
  );
  const [create, setCreate] = useState<string>();
  const [unlock, setUnlock] = useState<SavedWorkspace>();
  const [fileDialog, setFileDialog] = useState<File>();
  const [aboutOpen, setAboutOpen] = useState<false | 'guide' | 'about' | 'connection'>(false);
  const [connectionCheck, setConnectionCheck] = useState(0);
  const { networks, statuses, discoveryError } = useBackendNetworks(connectionCheck);
  const displayNetwork = activeWorkspace?.network ?? networks?.[0];
  const status = displayNetwork ? statuses[displayNetwork] : undefined;
  const unsupportedNetwork =
    !!activeWorkspace &&
    !activeWorkspace.demo &&
    !!networks &&
    !networks.includes(activeWorkspace.network) &&
    !discoveryError;
  const statusError =
    discoveryError ||
    (unsupportedNetwork
      ? `Backend does not support ${activeWorkspace!.network}.`
      : (status?.error ?? ''));
  const connected = !!status?.connected && !statusError;
  const [deleteEntry, setDeleteEntry] = useState<SavedWorkspace>();
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeSequence, setNoticeSequence] = useState(0);
  useEffect(() => {
    if (!notice || /partial|incomplete|cancelled|could not/i.test(notice)) return;
    const timer = setTimeout(() => setNotice(''), 8000);
    return () => clearTimeout(timer);
  }, [notice, noticeSequence]);
  const [error, setError] = useState('');
  const [pendingGraphWorkspace, setPendingGraphWorkspace] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);
  const workspaceTabs = useRef<HTMLElement>(null);
  useEffect(() => {
    const tabs = workspaceTabs.current;
    const active = tabs?.querySelector<HTMLElement>('.active');
    if (!tabs || !active) return;
    const reveal = () => {
      const bounds = tabs.getBoundingClientRect();
      const item = active.getBoundingClientRect();
      if (item.left < bounds.left) tabs.scrollLeft -= bounds.left - item.left;
      else if (item.right > bounds.right) tabs.scrollLeft += item.right - bounds.right;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(tabs);
    return () => observer.disconnect();
  }, [activeWorkspace?.id, workspaces.unlocked.length]);
  const activeWorkspaceRef = useRef(activeWorkspace);
  // Latest-workspace ref for callbacks (guards of the form "is this still the
  // same workspace?"). Published from a layout effect rather than during render:
  // mutating a ref during render is unsafe under concurrent rendering because
  // React may discard the render, and it also made React Compiler skip this
  // component. useLayoutEffect (not useEffect) keeps the value fresh before
  // paint, so event handlers observe the same value they did before. Declared
  // ahead of every other effect that reads it.
  useLayoutEffect(() => {
    activeWorkspaceRef.current = activeWorkspace;
  });
  const graphFlush = useRef<{ workspaceId: string; flush: () => void } | undefined>(undefined);
  const registerGraphSnapshotFlush = useCallback(
    (workspaceId: string, flush: (() => void) | undefined) => {
      if (flush) graphFlush.current = { workspaceId, flush };
      else if (graphFlush.current?.workspaceId === workspaceId) graphFlush.current = undefined;
    },
    [],
  );
  const flushActiveGraph = useCallback(() => {
    const id = activeWorkspaceRef.current?.id;
    if (id && graphFlush.current?.workspaceId === id) graphFlush.current.flush();
    return id;
  }, []);
  const saveBeforeLeaving = () => {
    const id = flushActiveGraph();
    return id ? (workspaces.getUnlocked(id)?.persist() ?? Promise.resolve()) : Promise.resolve();
  };
  const activateWorkspace = (id?: string) => {
    if (id !== activeWorkspaceRef.current?.id) void saveBeforeLeaving().catch(() => {});
    workspaces.setActiveId(id);
  };
  const openWorkspace = (data: Workspace, password: string) => {
    void saveBeforeLeaving().catch(() => {});
    workspaces.open(data, password);
  };
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const id = flushActiveGraph();
      const session = id ? getUnlockedWorkspace(id) : undefined;
      if (session && session.revision !== session.savedRevision) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [flushActiveGraph, getUnlockedWorkspace]);
  return {
    chainDataAcquisition,
    workspaces,
    activeWorkspace,
    fetchScope,
    getUnlockedWorkspace,
    workspaceId,
    create,
    setCreate,
    unlock,
    setUnlock,
    fileDialog,
    setFileDialog,
    aboutOpen,
    setAboutOpen,
    connectionCheck,
    setConnectionCheck,
    networks,
    statuses,
    discoveryError,
    displayNetwork,
    status,
    unsupportedNetwork,
    statusError,
    connected,
    deleteEntry,
    setDeleteEntry,
    examplesOpen,
    setExamplesOpen,
    notice,
    setNotice,
    noticeSequence,
    setNoticeSequence,
    error,
    setError,
    pendingGraphWorkspace,
    setPendingGraphWorkspace,
    fileInput,
    workspaceTabs,
    activeWorkspaceRef,
    registerGraphSnapshotFlush,
    flushActiveGraph,
    saveBeforeLeaving,
    activateWorkspace,
    openWorkspace,
  };
}

/** App session, navigation, connection and feedback services Workspace consumes. */
export type AppState = ReturnType<typeof useAppState>;
