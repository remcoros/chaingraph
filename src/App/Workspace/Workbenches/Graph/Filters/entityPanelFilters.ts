import type { GraphFilters } from '../../../graphViewState';
export function entityPanelFiltersFromGraph(filters: GraphFilters): GraphFilters {
  const panelFilters = { ...filters };
  delete panelFilters.excludeIds;
  delete panelFilters.focus;
  delete panelFilters.includeIds;
  delete panelFilters.preserveContext;
  delete panelFilters.showAddresses;
  return panelFilters;
}
