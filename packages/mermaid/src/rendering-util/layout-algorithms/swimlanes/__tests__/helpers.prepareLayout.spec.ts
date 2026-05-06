import { describe, it, expect } from 'vitest';
import type { LayoutData } from '../../../types.js';
import { prepareLayoutForSwimlanes } from '../helpers.js';

describe('prepareLayoutForSwimlanes', () => {
  it('marks group nodes with swimlane cluster shape', () => {
    const layout: LayoutData = {
      nodes: [{ id: 'g1', isGroup: true } as any, { id: 'n1', isGroup: false } as any],
      edges: [],
      // The rest of the properties are not used by prepareLayoutForSwimlanes
      // and can be safely mocked for this unit test.
      config: {} as any,
    };

    prepareLayoutForSwimlanes(layout);

    expect(layout.nodes[0].shape).toBe('swimlane');
    expect((layout.nodes[1] as any).shape).toBeUndefined();
  });
});
