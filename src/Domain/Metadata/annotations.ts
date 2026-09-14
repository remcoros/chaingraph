import type { Annotation } from '../types';

/** An entity with no human annotation yet. */
export const emptyAnnotation: Annotation = {
  label: '',
  note: '',
  icon: '',
  bookmarked: false,
};
