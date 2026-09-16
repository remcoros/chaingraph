/** Public metadata for one encrypted workspace saved by a persistence adapter. */
export interface SavedWorkspace {
  id: string;
  /** Deliberately public display name. Details remain inside the encrypted workspace. */
  publicName?: string;
  savedAt: string;
}

/** Opaque encrypted contents ready for a user-requested file download. */
export interface WorkspaceExport {
  name: string;
  contents: string;
}
