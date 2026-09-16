import { useEffect, useState } from 'react';
import type { Network } from '../Domain/Chain/network';
import { backendNetworks, backendStatus, type BackendStatus } from '../Infra/Bitcoin/api';

/** Discovery is independent of upstream health. Each poll owns its network and cancellation. */
export function useBackendNetworks(refreshToken: number) {
  const [networks, setNetworks] = useState<Network[]>();
  const [statuses, setStatuses] = useState<Partial<Record<Network, BackendStatus>>>({});
  const [discoveryError, setDiscoveryError] = useState('');
  useEffect(() => {
    const lifetime = new AbortController();
    const pending = new Map<Network, AbortController>();
    let supported = new Set<Network>();
    let discovering = false;
    const pollNetwork = (network: Network) => {
      if (pending.has(network)) return;
      const controller = new AbortController();
      pending.set(network, controller);
      void backendStatus(
        network,
        AbortSignal.any([lifetime.signal, controller.signal, AbortSignal.timeout(45000)]),
      )
        .then((status) => {
          if (!lifetime.signal.aborted && !controller.signal.aborted && supported.has(network))
            setStatuses((current) => ({ ...current, [network]: status }));
        })
        .catch(() => {
          if (!lifetime.signal.aborted && !controller.signal.aborted && supported.has(network))
            setStatuses((current) => ({
              ...current,
              [network]: { network, connected: false, error: `${network} backend is unavailable.` },
            }));
        })
        .finally(() => {
          if (pending.get(network) === controller) pending.delete(network);
        });
    };
    const discover = async () => {
      if (discovering) return;
      discovering = true;
      await backendNetworks(AbortSignal.any([lifetime.signal, AbortSignal.timeout(10000)]))
        .then((available) => {
          if (lifetime.signal.aborted) return;
          supported = new Set(available);
          for (const [network, controller] of pending)
            if (!supported.has(network)) {
              controller.abort();
              pending.delete(network);
            }
          setNetworks((current) =>
            JSON.stringify(current) === JSON.stringify(available) ? current : available,
          );
          setStatuses((current) =>
            Object.fromEntries(
              Object.entries(current).filter(([network]) => supported.has(network as Network)),
            ),
          );
          setDiscoveryError('');
          for (const network of available) pollNetwork(network);
        })
        .catch(() => {
          if (!lifetime.signal.aborted)
            setDiscoveryError('Cannot discover supported networks. Check the backend connection.');
        });
      discovering = false;
    };
    void discover();
    const timer = setInterval(() => {
      void discover();
    }, 15000);
    return () => {
      lifetime.abort();
      for (const controller of pending.values()) controller.abort();
      clearInterval(timer);
    };
  }, [refreshToken]);
  return { networks, statuses, discoveryError };
}
