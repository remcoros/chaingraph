import type { GraphAdapterFactory } from './adapter';
import { FlowRenderer } from './FlowRenderer';
// This isolated experiment changes only the renderer composition point.
export const createDefaultAdapter: GraphAdapterFactory = (container, events) =>
  new FlowRenderer(container, events);
