export interface Annotation {
  label: string;
  note: string;
  icon: string;
  bookmarked: boolean;
}

/** A manual grouping, independent of labels and heuristic findings. */
export interface WorkspaceTag {
  id: string;
  name: string;
  color: string;
  description?: string;
  nodeIds: string[];
}
