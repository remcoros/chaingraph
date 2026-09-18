import { describe, expect, it } from 'vitest';
import { visibleMultiSelectFilterGroups, type MultiSelectFilterGroup } from './MultiSelectFilter';

const groups: MultiSelectFilterGroup[] = [
  {
    id: 'visible',
    label: 'Visible group',
    options: [
      { id: 'present', label: 'Present', description: 'Present option', count: 2 },
      { id: 'empty', label: 'Empty', description: 'Empty option', count: 0 },
    ],
  },
  {
    id: 'empty-group',
    label: 'Empty group',
    options: [{ id: 'also-empty', label: 'Also empty', description: 'Empty option', count: 0 }],
  },
];

describe('visibleMultiSelectFilterGroups', () => {
  it('hides empty options and groups by default', () => {
    expect(visibleMultiSelectFilterGroups(groups, false)).toEqual([
      {
        ...groups[0],
        options: [groups[0].options[0]],
      },
    ]);
  });

  it('restores every option and group when showing all', () => {
    expect(visibleMultiSelectFilterGroups(groups, true)).toEqual(groups);
  });
});
