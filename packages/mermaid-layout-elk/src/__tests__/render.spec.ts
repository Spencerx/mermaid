import { describe, it, expect } from 'vitest';
import {
  buildElkGraphFromLayoutData,
  buildSubgraphLayoutOptions,
  dir2ElkDirection,
} from '../render.js';

describe('buildSubgraphLayoutOptions', () => {
  it('propagates mergeEdges to subgraphs without an explicit direction', () => {
    const opts = buildSubgraphLayoutOptions({}, { mergeEdges: true }, 'layered');
    expect(opts['elk.layered.mergeEdges']).toBe(true);
  });

  it('propagates mergeEdges to subgraphs with an explicit direction', () => {
    const opts = buildSubgraphLayoutOptions({ dir: 'LR' }, { mergeEdges: true }, 'layered');
    expect(opts['elk.layered.mergeEdges']).toBe(true);
    expect(opts['elk.direction']).toBe('RIGHT');
    expect(opts['elk.algorithm']).toBe('layered');
    expect(opts['elk.hierarchyHandling']).toBe('SEPARATE_CHILDREN');
  });

  it('omits direction-specific options when node has no dir', () => {
    const opts = buildSubgraphLayoutOptions({}, { mergeEdges: true }, 'layered');
    expect(opts['elk.algorithm']).toBeUndefined();
    expect(opts['elk.direction']).toBeUndefined();
    expect(opts['elk.hierarchyHandling']).toBeUndefined();
  });

  it('passes through nodePlacementStrategy from config', () => {
    const opts = buildSubgraphLayoutOptions(
      {},
      { nodePlacementStrategy: 'BRANDES_KOEPF' },
      'layered'
    );
    expect(opts['nodePlacement.strategy']).toBe('BRANDES_KOEPF');
  });

  it('handles undefined elkConfig gracefully', () => {
    const opts = buildSubgraphLayoutOptions({}, undefined, 'layered');
    expect(opts['elk.layered.mergeEdges']).toBeUndefined();
    expect(opts['nodePlacement.strategy']).toBeUndefined();
  });
});

describe('dir2ElkDirection', () => {
  it('maps LR to RIGHT', () => expect(dir2ElkDirection('LR')).toBe('RIGHT'));
  it('maps RL to LEFT', () => expect(dir2ElkDirection('RL')).toBe('LEFT'));
  it('maps TB and TD to DOWN', () => {
    expect(dir2ElkDirection('TB')).toBe('DOWN');
    expect(dir2ElkDirection('TD')).toBe('DOWN');
  });
  it('maps BT to UP', () => expect(dir2ElkDirection('BT')).toBe('UP'));
  it('defaults to DOWN for unknown', () => expect(dir2ElkDirection('xyz')).toBe('DOWN'));
});

describe('buildElkGraphFromLayoutData', () => {
  it('builds an ELK graph from measured layout data without DOM handles', () => {
    const data = {
      direction: 'LR',
      config: { elk: { mergeEdges: true } },
      nodes: [
        {
          id: 'group',
          isGroup: true,
          label: 'Group',
          padding: 12,
          labelBBox: { width: 44, height: 16 },
        },
        { id: 'A', isGroup: false, parentId: 'group', width: 50, height: 20, label: 'A' },
        { id: 'B', isGroup: false, width: 60, height: 24, label: 'B' },
      ],
      edges: [
        {
          id: 'edge-A-B',
          start: 'A',
          end: 'B',
          label: 'go',
          width: 22,
          height: 10,
          type: 'arrow_point',
        },
      ],
    } as any;

    const log = {
      debug: () => undefined,
      error: () => undefined,
      info: () => undefined,
      warn: () => undefined,
    };

    const state = buildElkGraphFromLayoutData(data, {
      algorithm: 'layered',
      common: { lineBreakRegex: /<br\s*\/?>/gi },
      getConfig: () => ({ flowchart: { wrappingWidth: 100 } }),
      interpolateToCurve: (curve: unknown) => curve,
      log,
    } as any);

    expect(state.elkGraph.layoutOptions['elk.direction']).toBe('RIGHT');
    expect(state.elkGraph.children).toHaveLength(2);

    const group = state.nodeDb.group;
    expect(group.children).toHaveLength(1);
    expect(group.labels?.[0]).toMatchObject({ text: 'Group', width: 44, height: 14 });
    expect((group as { domId?: unknown }).domId).toBeUndefined();

    const edge = state.elkGraph.edges[0];
    expect(edge.labels[0]).toMatchObject({ width: 22, height: 10, text: 'go' });
    expect(edge.labelEl).toBeUndefined();
  });
});
