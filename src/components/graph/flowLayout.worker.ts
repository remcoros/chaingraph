import { layoutGraph } from './compactLayout';
import type { LayoutRequest } from './flowLayout';
self.onmessage = (event: MessageEvent<LayoutRequest>) => self.postMessage(layoutGraph(event.data));
