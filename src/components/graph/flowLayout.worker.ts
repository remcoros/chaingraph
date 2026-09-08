import { flowLayout, type LayoutRequest } from './flowLayout';
self.onmessage = (event: MessageEvent<LayoutRequest>) => self.postMessage(flowLayout(event.data));
