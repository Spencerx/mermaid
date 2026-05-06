import { describe, it, expect } from 'vitest';
import type { Graph, EdgeRef, NodeId, OrderedLayers } from '../helpers.js';
import { assignLayers_LongestPath } from '../phase2.longestPath.js';
import { makeProperLayering } from '../phase2.dummies.js';
import { assignCoordinates } from '../phase4.coordinates.js';
import { mergeDummies } from '../phase4.mergeDummies.js';

interface TestNode {
  id: string;
  isGroup?: boolean;
  isDummy?: boolean;
}

function mkGraph(nodes: string[], edgePairs: [string, string][]): Graph {
  const layout = {
    nodes: nodes.map((id) => ({ id, isGroup: false }) as TestNode) as any,
    edges: [] as any,
  } as any;
  const nodeById = new Map<NodeId, any>();
  for (const id of nodes) {
    nodeById.set(id, { id, isGroup: false });
  }
  const edges: EdgeRef[] = edgePairs.map(([src, dst], i) => ({
    id: `e${i}`,
    src,
    dst,
    ref: { id: `e${i}`, start: src, end: dst } as any,
  }));
  return { nodes: [...nodes], edges, layout, nodeById };
}

describe('Phase 4 — Coordinate Assignment', () => {
  it('Single layer: monotone increasing x with nodeGap; y constant', () => {
    const g = mkGraph(['A', 'B', 'C'], []);
    const ordered: OrderedLayers = { layers: [['A', 'B', 'C']] };
    const coords = assignCoordinates(ordered, g, { nodeGap: 50, layerGap: 80 });
    expect(coords.y.A).toBe(0);
    expect(coords.y.B).toBe(0);
    expect(coords.y.C).toBe(0);
    // Centered placement within single lane: [-50, 0, 50]
    expect(coords.x.A).toBe(-50);
    expect(coords.x.B).toBe(0);
    expect(coords.x.C).toBe(50);
  });

  it('Long multi-dummy edge yields near-vertical interior polyline points after mergeDummies', () => {
    // A->B->C->D plus long A->D (edge id e3)
    const g = mkGraph(
      ['A', 'B', 'C', 'D'],
      [
        ['A', 'B'],
        ['B', 'C'],
        ['C', 'D'],
        ['A', 'D'],
      ]
    );
    const layering = assignLayers_LongestPath(g);
    const { layering: proper, graphWithDummies } = makeProperLayering(layering, g);
    const ordered: OrderedLayers = { layers: proper.layers };

    const coords0 = assignCoordinates(ordered, graphWithDummies, {
      nodeGap: 40,
      layerGap: 100,
      straightenLongEdges: true,
    });
    const coords = mergeDummies(coords0, graphWithDummies, g);

    const pts = coords.edgePoints?.e3;
    expect(pts).toBeTruthy();
    // interior points (excluding endpoints) should share same x for vertical chain
    const xs = (pts ?? []).slice(1, -1).map((p) => p.x);
    if (xs.length > 1) {
      for (let i = 1; i < xs.length; i++) {
        expect(xs[i]).toBe(xs[0]);
      }
    } else {
      // at least one dummy should exist
      expect(xs.length).toBeGreaterThan(0);
    }
  });
});
