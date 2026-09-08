import { compactLayout } from './compactLayout';
import type { LayoutRequest } from './flowLayout';
self.onmessage = (event: MessageEvent<LayoutRequest>) =>
  self.postMessage(compactLayout(event.data));
