import type { LayoutRequest, LayoutResult, Position } from './flowLayout';

/** Visibility changes can restore known coordinates without waiting for a simulation. */
export function cachedLayout(request: LayoutRequest): LayoutResult | undefined {
  const previous = new Map(request.previous);
  const positions: [string, Position][] = [];
  for (const node of request.nodes) {
    const x = node.fx ?? node.x,
      y = node.fy ?? node.y,
      z = node.fz ?? node.z;
    const position =
      Number.isFinite(x) && Number.isFinite(y)
        ? { x: x!, y: y!, z: Number.isFinite(z) ? z! : 0 }
        : previous.get(node.id);
    if (!position) return undefined;
    positions.push([node.id, position]);
  }
  return { revision: request.revision, positions };
}

type LayoutWorker = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror'>;

/** A simulation is CPU-bound inside its worker. Termination is the cancellation
 * boundary; posting a cancel message would only enqueue it behind the old work. */
export class LayoutScheduler {
  private worker?: LayoutWorker;
  private revision?: number;
  private dead = false;

  constructor(
    private createWorker: () => LayoutWorker,
    private accept: (result: LayoutResult) => void,
    private fail: (revision: number) => void,
  ) {}

  request(request: LayoutRequest) {
    if (this.dead) return;
    if (this.revision !== undefined) this.cancel();
    this.revision = request.revision;
    const cached = cachedLayout(request);
    if (cached) {
      this.revision = undefined;
      this.accept(cached);
      return;
    }
    try {
      const worker = (this.worker ??= this.createWorker());
      worker.onmessage = (event: MessageEvent<LayoutResult>) => {
        if (this.dead || worker !== this.worker || this.revision !== event.data.revision) return;
        this.revision = undefined;
        this.accept(event.data);
      };
      worker.onerror = (event) => {
        event.preventDefault();
        if (this.dead || worker !== this.worker || this.revision === undefined) return;
        const revision = this.revision;
        this.cancel();
        this.fail(revision);
      };
      worker.postMessage(request);
    } catch {
      this.cancel();
      this.fail(request.revision);
    }
  }

  private cancel() {
    this.worker?.terminate();
    this.worker = undefined;
    this.revision = undefined;
  }

  dispose() {
    this.dead = true;
    this.cancel();
  }
}
