import type { GraphProjectionFilters } from './graphFilters';
import type { GraphFilters } from '../../../../../Core/Workspace/view';
export function entityPanelFiltersFromGraph(filters: GraphProjectionFilters): GraphFilters {
  const panelFilters = { ...filters };
  delete panelFilters.excludeIds;
  delete panelFilters.focus;
  delete panelFilters.includeIds;
  delete panelFilters.preserveContext;
  delete panelFilters.showAddresses;
  return panelFilters;
}
