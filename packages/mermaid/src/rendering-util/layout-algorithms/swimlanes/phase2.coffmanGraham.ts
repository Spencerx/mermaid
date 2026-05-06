import type { Graph, Layering } from './helpers.js';
import { assignLayers_LongestPath } from './phase2.longestPath.js';

/**
 * Placeholder Coffman-Graham layering.
 *
 * For now this simply delegates to longest-path layering while we keep the
 * configuration surface area stable. The widthBound parameter is accepted but
 * ignored.
 */
export function assignLayers_CoffmanGraham(gAcyclic: Graph, _widthBound: number): Layering {
  // TODO: Implement true Coffman-Graham layering with width bound.
  return assignLayers_LongestPath(gAcyclic);
}
