import { NETWORKS, type Network, type NetworkConfig, type ServerConfig } from './config';
import { CoreClient } from './core';
import { ElectrumClient } from './electrum';
import { SafeError } from './errors';

/** Connection metadata only. Each pair owns its sockets, queues and genesis identity. */
class NetworkPair {
  readonly core: CoreClient;
  readonly electrum: ElectrumClient;
  private cachedGenesis?: string;
  constructor(readonly config: NetworkConfig) {
    this.core = new CoreClient(config);
    this.electrum = new ElectrumClient(config);
  }
  async genesis(signal: AbortSignal): Promise<string> {
    if (this.cachedGenesis) return this.cachedGenesis;
    const result = await this.core.call('getblockhash', [0], signal);
    if (typeof result !== 'string' || !/^[0-9a-f]{64}$/i.test(result))
      throw new SafeError('Invalid Bitcoin genesis block');
    this.cachedGenesis = result.toLowerCase();
    return this.cachedGenesis;
  }
  close() {
    this.core.close();
    this.electrum.close();
  }
}

export class NetworkRegistry {
  private readonly pairs = new Map<Network, NetworkPair>();
  constructor(config: ServerConfig) {
    for (const network of NETWORKS) {
      const pair = config.networks[network];
      if (pair) this.pairs.set(network, new NetworkPair(pair));
    }
  }
  configured(): Network[] {
    return [...this.pairs.keys()];
  }
  get(network: unknown): NetworkPair {
    if (typeof network !== 'string' || !NETWORKS.includes(network as Network))
      throw new SafeError('Specify a supported Bitcoin network', 400);
    const pair = this.pairs.get(network as Network);
    if (!pair)
      throw new SafeError(
        `This backend does not support ${network}`,
        404,
        'network_not_configured',
      );
    return pair;
  }
  close() {
    for (const pair of this.pairs.values()) pair.close();
  }
}
