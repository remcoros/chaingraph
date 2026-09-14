import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type Workspace } from '../Domain/types';
import { useBackendNetworks } from './useBackendNetworks';
import { useWorkspaces, type SavedWorkspace } from './Workspace/useWorkspaces';
export function useAppState() {
  const ws = useWorkspaces();
  const w = ws.active?.data;
  const fetchScope = ws.active?.fetchScope;
  const updateWorkspace = ws.update;
  const getWorkspaceSession = ws.getSession;
  const persistWorkspace = ws.persist;
  const workspaceId = w?.id;
  const [create, setCreate] = useState<string>();
  const [unlock, setUnlock] = useState<SavedWorkspace>();
  const [fileDialog, setFileDialog] = useState<File>();
  const [aboutOpen, setAboutOpen] = useState<false | 'guide' | 'about' | 'connection'>(false);
  const [connectionCheck, setConnectionCheck] = useState(0);
  const { networks, statuses, discoveryError } = useBackendNetworks(connectionCheck);
  const displayNetwork = w?.network ?? networks?.[0];
  const status = displayNetwork ? statuses[displayNetwork] : undefined;
  const unsupportedNetwork =
    !!w && !w.demo && !!networks && !networks.includes(w.network) && !discoveryError;
  const statusError =
    discoveryError ||
    (unsupportedNetwork ? `Backend does not support ${w!.network}.` : (status?.error ?? ''));
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
  }, [w?.id, ws.sessions.length]);
  const wRef = useRef(w);
  // Latest-workspace ref for callbacks (guards of the form "is this still the
  // same workspace?"). Published from a layout effect rather than during render:
  // mutating a ref during render is unsafe under concurrent rendering because
  // React may discard the render, and it also made React Compiler skip this
  // component. useLayoutEffect (not useEffect) keeps the value fresh before
  // paint, so event handlers observe the same value they did before. Declared
  // ahead of every other effect that reads it.
  useLayoutEffect(() => {
    wRef.current = w;
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
    const id = wRef.current?.id;
    if (id && graphFlush.current?.workspaceId === id) graphFlush.current.flush();
    return id;
  }, []);
  const saveBeforeLeaving = () => {
    const id = flushActiveGraph();
    return id ? persistWorkspace(id) : Promise.resolve();
  };
  const activateWorkspace = (id?: string) => {
    if (id !== wRef.current?.id) void saveBeforeLeaving().catch(() => {});
    ws.setActiveId(id);
  };
  const openWorkspace = (data: Workspace, password: string) => {
    void saveBeforeLeaving().catch(() => {});
    ws.open(data, password);
  };
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const id = flushActiveGraph();
      const session = id ? getWorkspaceSession(id) : undefined;
      if (session && session.revision !== session.savedRevision) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [flushActiveGraph, getWorkspaceSession]);
  return {
    ws,
    w,
    fetchScope,
    updateWorkspace,
    getWorkspaceSession,
    persistWorkspace,
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
    wRef,
    registerGraphSnapshotFlush,
    flushActiveGraph,
    saveBeforeLeaving,
    activateWorkspace,
    openWorkspace,
  };
}
