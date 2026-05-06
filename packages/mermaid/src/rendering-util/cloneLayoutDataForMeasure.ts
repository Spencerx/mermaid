import type { LayoutData, Node } from './types.js';

/**
 * Shallow-safe clone for a DOM measurement pass: strips function fields that break `structuredClone`.
 * Used so `createGraphWithElements` can mutate a throwaway graph while results are copied back to canonical `LayoutData`.
 */
export function cloneLayoutDataForDomMeasure(layout: LayoutData): LayoutData {
  const nodes = layout.nodes.map((node) => {
    const { intersect, calcIntersect, ...rest } = node as Node & {
      intersect?: unknown;
      calcIntersect?: unknown;
    };
    return { ...rest } as Node;
  });
  const edges = layout.edges.map((e) => ({ ...e }));
  // `layout.config` may hold theme callables; `structuredClone` throws (e.g. jsdom Company tests).
  const config = { ...(layout.config as object) } as LayoutData['config'];
  return {
    ...layout,
    nodes,
    edges,
    config,
  };
}

/**
 * Copy nodes + edges produced by measurement from `measured` onto `canonical`.
 * Keeps the original `canonical.config` object so diagram/parser-owned config
 * references (and non-enumerable fields) stay intact.
 */
export function copyMeasuredGraphOntoCanonical(canonical: LayoutData, measured: LayoutData): void {
  canonical.nodes = measured.nodes;
  canonical.edges = measured.edges;
}
