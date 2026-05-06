# Swimlanes Layout Algorithm Implementation Instructions

## Overview

This document provides instructions for implementing the Swimlanes algorithm in Mermaid. The Swimlanes algorithm is based on the Sugiyama layered layout framework.

## Architecture Overview

The layout algorithm follows Mermaid's standard layout pipeline:

1. **createGraphWithElements**: Takes parsed graph data without node/label sizes, inserts elements into DOM to calculate sizes
2. **Layout Step**: Performs the actual layout algorithm on data4Layout (graph with sized nodes/edges)
3. **adjustLayout**: Finalizes the graph according to the layout results

## Implementation Structure

### Core Implementation Steps

#### 1. Update index.ts

The main render function should follow this pattern:

```typescript
export async function render(data4Layout: LayoutData, svg: SVG) {
  const element = svg.select('g') as unknown as D3Selection<SVGElement>;

  // Insert markers and clear previous elements
  insertMarkers(element, data4Layout.markers, data4Layout.type, data4Layout.diagramId);
  clearNodes();
  clearEdges();
  clearClusters();
  clearGraphlib();

  // Create the graph and insert the SVG groups and nodes
  const { groups } = await createGraphWithElements(element, data4Layout);

  // Apply Swimlanes layout algorithm
  await applySwimlanes(data4Layout, getSwimlanesConfig(data4Layout.config));

  // Finalize layout
  await adjustLayout(data4Layout, groups);
}
```

------ Sugiyama details and strategy ------

# AI Code Assistant — Implementation Playbook for the Sugiyama Layered Layout

You’re going to implement the classic Sugiyama framework for layered graph drawing, using **test-first** development in Vitest. This playbook spells out what to do in each phase, the exact function signatures to start with, what tests to write (including edge cases), and how to iterate until green.

> Reference: The Sugiyama method has four core phases—**cycle removal**, **layer assignment**, **vertex ordering**, and **coordinate assignment**—with well-known heuristics/LP variants for each. See the overview, algorithms, and evaluation in the thesis summary at packages/mermaid/src/rendering-util/layout-algorithms/swimlanes.markdown. &#x20;

---

## Ground Rules

- **Language & tests:** TypeScript + Vitest.
- **Style:** Start every phase by emitting **just the function signature(s)**, then add a **Vitest suite that covers normal + edge cases**, then implement until all tests pass.
- **Data model (shared across phases):**

  ```ts
  // Use real Mermaid types from packages/mermaid/src/rendering-util/types.ts

  // Base types
  export type Layout = LayoutData;
  export type Node = Layout['nodes'][number];
  export type MermaidEdge = Layout['edges'][number];
  export type NodeId = Node['id'];

  // Light edge view used by the heuristics (keeps ref to original Mermaid edge)
  export interface EdgeRef {
    id: MermaidEdge['id'];
    src: NodeId; // equals MermaidEdge.start
    dst: NodeId; // equals MermaidEdge.end
    weight?: number;
    ref: MermaidEdge;
  }

  // Graph view used internally by the Sugiyama phases
  export interface Graph {
    nodes: NodeId[];
    edges: EdgeRef[];
    layout: Layout; // gives access to full Node/Edge objects when needed
    nodeById: Map<NodeId, Node>; // convenience map built from layout.nodes
  }

  // After layering:
  export interface Layering {
    layers: NodeId[][]; // top-to-bottom list of layers
    rankOf: Record<NodeId, number>; // node -> layer index
    dummy?: Set<NodeId>; // synthetic ids for proper layering (use naming scheme: "placeholder-<num>")
  }

  // After ordering:
  export interface OrderedLayers {
    layers: NodeId[][]; // each inner array is left-to-right order
  }

  // After coordinates:
  export interface Coordinates {
    x: Record<NodeId, number>;
    y: Record<NodeId, number>;
    // Edge polylines keyed by Mermaid edge id
    edgePoints?: Record<MermaidEdge['id'], { x: number; y: number }[]>;
  }

  // Bridge back to Mermaid:
  // Applies computed layer/order/coordinates to LayoutData in-place
  export interface WriteBackOptions {
    layerGap?: number;
    nodeGap?: number;
  }

  export function writeBackToLayoutData(
    g: Graph,
    ordered: OrderedLayers,
    coords: Coordinates,
    opts?: WriteBackOptions
  ): void; // sets node.layer, node.order, node.x/y and edge.points
  ```

#### Clarifications on types and IDs

- Mermaid edges must expose `start` and `end` node ids. `EdgeRef.src` maps to `MermaidEdge.start`, and `EdgeRef.dst` maps to `MermaidEdge.end`. Validate and throw (or skip) if either is missing.
- Dummy nodes: generate ids using the scheme `placeholder-<num>` and include them in `Layering.dummy`.

### Integration with Mermaid data and the Swimlanes render pipeline

- Build a thin Graph view from LayoutData that the Sugiyama phases consume (helper below):

```ts
export function toGraphView(layout: LayoutData): Graph;
```

- Run the Sugiyama phases, then write results back to LayoutData using writeBackToLayoutData. Integrate this between createGraphWithElements(...) and adjustLayout(...):

```ts
// inside Swimlanes/index.ts render()
const g = toGraphView(data4Layout); // { nodes, edges, layout, nodeById }
const { ordered, coordinates } = sugiyamaLayout(g, getSugiyamaOptions(data4Layout.config));
writeBackToLayoutData(g, ordered, coordinates);
await adjustLayout(data4Layout, groups);
```

### File placement

- Place all swimlanes code under: packages/mermaid/src/rendering-util/layout-algorithms/swimlanes/
- Suggested structure:
  - swimlanes/index.ts (render entry)
  - swimlanes/helpers.ts (toGraphView, writeBackToLayoutData, types re-exports)

Note on undirected inputs: If the input graph is undirected, orient edges first (e.g., using BFS layering or an arbitrary but deterministic rule), then run cycle removal as needed. Document the chosen orientation heuristic.

- swimlanes/phase0.helpers.ts, phase1.cycles.ts, phase2.layering.ts, phase3.ordering.ts, phase4.coordinates.ts
- tests colocated as **tests**/phaseX.\*.spec.ts alongside each phase file

- Node fields updated: node.layer, node.order, node.x, node.y. Edge fields updated: edge.points (polyline). Keep all updates deterministic so downstream rendering and tests are stable.

* **Determinism:** Where heuristics need tie-breakers, use stable, documented rules (e.g., lexicographic node id).

---

## Phase 0 — Input normalization & helpers

### Purpose

- Validate input, detect trivial cases, and provide helpers used throughout the pipeline.

### Start with signatures

```ts
export function normalizeGraph(g: Graph): Graph;
export function isAcyclic(g: Graph): boolean;
export function incoming(g: Graph, v: NodeId): Edge[];
export function outgoing(g: Graph, v: NodeId): Edge[];
export function topoSortIfAcyclic(g: Graph): NodeId[] | null;
```

### Vitest suite (examples & edges)

- empty graph, single node, parallel edges, self-loop, disconnected components.
- `isAcyclic` true for DAGs, false for a simple back-edge.
- `topoSortIfAcyclic` returns null for cycles.

---

## Phase 1 — Cycle Removal (Feedback Arc Set heuristic)

### Context

Make the graph acyclic by temporarily reversing a minimal-ish set of edges. Common heuristics:

- **Berger–Shor** “smaller side” heuristic.
- **Eades et al.** enhanced greedy (process sinks/sources, then pick max |in|-|out|).
- **DFS back-edge** marking (as in Graphviz `dot`) is simple and fast.

> See the method’s description and algorithms 4.1.1–4.1.3, plus the FAS discussion.&#x20;

### Start with signatures

```ts
export interface CycleRemovalResult {
  acyclic: Graph;
  reversed: Edge[]; // edges that were reversed; keep original orientation metadata
}

export function removeCycles_DFS(g: Graph): CycleRemovalResult;
export function removeCycles_BergerShor(g: Graph): CycleRemovalResult;
export function removeCycles_Eades(g: Graph): CycleRemovalResult;
```

### Vitest suite (normal & edge cases)

- **No cycles**: returns same edges; `reversed` empty.
- **Single back edge**: exactly one reversed.
- **2-node cycle (A↔B)**: reverses one edge only.
- **Cycle in one component + DAG in another**: only touch the cyclic component.
- **Dense small graph (K_4 with orientations forming cycles)**: result is acyclic.
- **Stability**: tie-breakers deterministic.

---

## Phase 2 — Layer Assignment (Ranking)

### Context

Assign each node a layer index so all edges point downward; insert **dummy nodes** so every edge connects **adjacent layers** (proper layering). Popular choices:

- **Longest-path** layering (minimizes height; fast).
- **Coffman–Graham** layering with width bound **W** (good control over width/height tradeoff).
- **LP minimization** of total edge length (optional extension).

> See §2.4.2 and Algorithms 4.2.1 (Longest Path) and 4.2.2 (Coffman–Graham), incl. transitive reduction note; LP variant in §4.2.3.&#x20;

### Start with signatures

```ts
export interface LayeringOptions {
  widthBound?: number; // if provided, use Coffman-Graham
  preferLongEdgesStraight?: boolean; // hint used later
}

export function assignLayers_LongestPath(gAcyclic: Graph): Layering;

export function assignLayers_CoffmanGraham(gAcyclic: Graph, widthBound: number): Layering;

export function makeProperLayering(
  layering: Layering,
  gAcyclic: Graph
): { layering: Layering; graphWithDummies: Graph };
```

### Vitest suite (normal & edge cases)

- **Chain** A→B→C→D: consecutive layers; no dummies.
- **Long edge** A→D with B, C in between: introduces two dummy nodes.
- **Diamond**: verifies ranks consistent; minimal height for longest-path; respects widthBound=2 for Coffman–Graham.
- **Disconnected** graphs: each component layered independently, y-gaps consistent.
- **Self-loop** (shouldn’t exist post Phase 1): assert rejected or ignored.

---

## Phase 3 — Vertex Ordering (Crossing Minimization)

### Context

Within each layer, order nodes to reduce crossings between adjacent layers. Standard heuristics:

- **Median** or **Barycenter** sweep (top-down, bottom-up, repeat).
- **Transpose** improvement (adjacent swaps lowering crossings).
- Multiple passes; pick best with crossing count.

> See §2.4.3 and Algorithms 4.3.1–4.3.3; complexity & guarantees for TLCM vs. multilayer sweeps.&#x20;

### Start with signatures

```ts
export interface OrderingOptions {
  sweeps?: number; // default 3
  useTranspose?: boolean; // default true
  heuristic?: 'median' | 'barycenter'; // default 'median'
}

export function orderLayers(
  layering: Layering,
  gWithDummies: Graph,
  opts?: OrderingOptions
): OrderedLayers;

export function countCrossingsBetweenAdjacent(
  upper: NodeId[],
  lower: NodeId[],
  edges: Edge[]
): number;

export function totalCrossings(layers: NodeId[][], edges: Edge[]): number;
```

### Vitest suite (normal & edge cases)

- **Two-layer bipartite with known zero-crossing order**: algorithm achieves zero.
- **Small layered graph with multiple valid orders**: total crossings minimal/stable.
- **Stress**: wide layer with many dummies—no crashes; deterministic tie-breaking.
- **Transpose** actually reduces crossings vs. pure median on a crafted case.

---

## Phase 4 — Coordinate Assignment (x/y placement)

### Context

Compute `(x,y)` for nodes: `y` from layer index; `x` to straighten long edges and keep compact width. Common methods:

- **Priority method** (prioritize dummies + high-degree nodes; place by neighbor barycenter, moving only lower priority).
- **LP-based** straightening (minimize |x_u - x_v| along edges with separation constraints).

> See §2.4.4 and Algorithm 4.4.1 (Priority method); LP idea in §4.4.2.&#x20;

### Start with signatures

```ts
export interface CoordOptions {
  layerGap?: number; // vertical distance between layers (default e.g. 100)
  nodeGap?: number; // minimal horizontal gap between siblings (default e.g. 40)
  straightenLongEdges?: boolean; // hint; favors dummy alignment
}

export function assignCoordinates(
  ordered: OrderedLayers,
  gWithDummies: Graph,
  opts?: CoordOptions
): Coordinates;

export function mergeDummies(
  coords: Coordinates,
  gWithDummies: Graph,
  original: Graph
): Coordinates; // recompute edge polylines by collapsing dummy chains
```

### Vitest suite (normal & edge cases)

- **Single layer**: monotone increasing x with `nodeGap`; y constant.
- **Long multi-dummy edge**: nearly vertical polyline after `mergeDummies`.
- **Conflicting barycenters**: higher-priority nodes stay; only lower ones shift.
- **Spacing**: no overlaps; nodeGap respected; stable placement for equal cases.

---

## Phase 5 — Pipeline & Post-processing

### Context

Wire the phases; record reversed edges; restore original direction for rendering; produce ready-to-draw points.

### Start with signatures

```ts
export interface LayoutOptions extends LayeringOptions, OrderingOptions, CoordOptions {
  cycleHeuristic?: 'dfs' | 'berger-shor' | 'eades'; // default 'dfs'
}

export interface LayoutResult {
  acyclic: Graph;
  reversed: Edge[];
  layering: Layering;
  ordered: OrderedLayers;
  coordinates: Coordinates;
}

export function sugiyamaLayout(g: Graph, opts?: LayoutOptions): LayoutResult;
```

### Vitest suite

- **End-to-end** on:
  - chain, diamond, two-cycle, and a graph that needs many dummies.
  - Verify: acyclic, proper layering, crossings non-increasing after ordering, spacing respected, reversed edges restored in polyline output.

---

## Developer Experience (what the assistant should output, step-by-step)

For **each** phase, follow this exact sequence:

1. **Emit the function signature(s)** (and exported types if new).
2. **Emit a Vitest file** (e.g., `phase1.removeCycles.spec.ts`) that:
   - Instantiates minimal fixtures.
   - Covers: happy path, tie-breakers, and the edge cases listed above.
   - Is deterministic (use fixed node ids and seeded shuffles if needed).

3. **Run & implement** until the suite is green.
4. **Refactor only after green**, keeping signatures stable unless a test uncovers necessity.

### Testing conventions

- Use human-readable graph fixtures:

  ```ts
  const gCycle: Graph = {
    nodes: ['A', 'B', 'C'],
    edges: [
      { src: 'A', dst: 'B' },
      { src: 'B', dst: 'C' },
      { src: 'C', dst: 'A' },
    ],
  };
  ```

- Utility for edge-set equality that ignores ordering:

  ```ts
  function sameEdges(a: Edge[], b: Edge[]) {
    /* ... */
  }
  ```

- Snapshot only for **coordinates** (and keep tolerances small but non-zero for future layout tweaks).

---

## Performance & determinism notes (baked into tests)

- All heuristics must run in **O(|V|+|E|)** or near-linear per sweep; avoid n² hotspots in inner loops.
- Provide optional `maxSweeps` in ordering; assert `totalCrossings` strictly decreases or plateaus per sweep in a monotone test.
- Deterministic tie-breakers: e.g., when two medians equal, keep current order; when inserting by barycenter, break ties lexicographically.

---

## Optional extensions (behind flags)

- **Coffman–Graham transitive reduction** for better layering behavior (guarded by option).
- **LP modes** for layer/ordering/coordinates (pluggable solvers; skipped by default in tests, or feature-flagged with separate suites).
- **Spline routing** after `mergeDummies` (post-layout nicety).

---

Note: The sections below cover optional/advanced routing and constraint topics. Implement the core Swimlanes (Sugiyama) phases first; treat these as extensions.

## What you (the AI assistant) should print on first run

1. Create `packages/mermaid/src/rendering-util/layout-algorithms/swimlanes/helpers.ts` with shared type aliases and the `toGraphView`/`writeBackToLayoutData` signatures.
2. Add Phase 0 signatures in `packages/mermaid/src/rendering-util/layout-algorithms/swimlanes/phase0.helpers.ts` and tests in `.../swimlanes/phase0.helpers.spec.ts` (failing tests first).
3. Implement helpers until green.
4. Proceed to Phases 1–4 in `.../swimlanes/phaseX.*.ts` with colocated `__tests__` the same way.
5. Finish with `sugiyamaLayout` end-to-end tests under `.../swimlanes/e2e.spec.ts`.

---

## Bibliography pointers you can cite in code comments

- Overview of the four phases and common criteria for “good” layouts, including crossings, layer properties, and coordinate goals.&#x20;
- Concrete algorithms: cycle removal (Algorithms 4.1.1–4.1.3), layering (4.2.1–4.2.2 + proper layering with dummies), ordering (4.3.1–4.3.3 median/barycenter + transpose), coordinates (4.4.1 priority method).&#x20;
- High-level summary of the same, including the observation that choices in earlier steps can improve/worsen later phases, so test end-to-end.&#x20;

------ END Sugiyama details and strategy ------

## Key Implementation Requirements

### 1. Edge Overlap Prevention

Implement edge routing that ensures edges cannot occupy the same space:

- Use grid-based routing with reserved cells
- Implement edge spacing constraints
- Handle parallel edges with proper separation

## Integration Points

1. **Config Integration**: Add Swimlanes config to main Mermaid config schema
2. **Layout Registration**: Register Swimlanes as available layout option
3. **Error Handling**: Implement graceful fallbacks for constraint conflicts

### Edge Overlap Prevention Strategy

```typescript
// Grid-based approach for edge routing
class EdgeRouter {
  private grid: boolean[][];
  private edgeSpacing: number;

  routeEdge(start: Point, end: Point): Point[] {
    // Use A* pathfinding with grid constraints
    // Reserve grid cells for edge segments
    // Maintain minimum spacing between parallel edges
  }

  reserveGridCells(path: Point[]): void {
    // Mark grid cells as occupied
    // Include buffer zones for edge spacing
  }
}
```

### Constraint Conflict Resolution

When constraints conflict, implement priority system:

1. Port/Side constraints (highest priority)
2. Flow constraints
3. Cluster constraints
4. Partition constraints
5. Bimodal constraints (lowest priority)

## Testing Checklist

- [ ] Basic linear graph layout (A->B->C)
- [ ] Diamond pattern layout (A->B,C->D)
- [ ] Complex multi-layer graphs
- [ ] Flow constraint enforcement
- [ ] Bimodal vertex handling
- [ ] Cluster grouping
- [ ] Partition cell placement
- [ ] Port/side constraint adherence
- [ ] Edge overlap prevention
- [ ] Crossing minimization
- [ ] Performance with 100+ nodes
- [ ] Memory usage optimization
- [ ] Error handling for invalid constraints

## Notes

- The algorithm should handle graphs with ~100 vertices and ~200 edges efficiently
- Edge routing must prevent overlaps while minimizing crossings
- All coordinates should be integer-based for grid alignment
- Support both directed and undirected graphs
- Maintain compatibility with existing Mermaid rendering pipeline
- Implement incremental constraint solving for better performance
- Consider using web workers for complex layout computations
- Follow the existing pattern from HOLA and ipsecCola implementations
- Ensure proper TypeScript typing throughout the implementation

Important:

- Each subgraph (group) in the graph corresponds to a swimlane. Swimlanes are separated by vertical lines. Edges between nodes in different swimlanes should be routed vertically.
- Swimlanes can not be nested.
- Swimlanes can have the same height and are placed next wto each other depoending on the direction of the graph.
