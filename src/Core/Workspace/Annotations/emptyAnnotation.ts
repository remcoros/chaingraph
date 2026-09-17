import type { Annotation } from './annotations';

/** An entity with no human annotation yet. */
export const emptyAnnotation: Annotation = {
  label: '',
  note: '',
  icon: '',
  bookmarked: false,
};
