// cspell:ignore Wybrow Helmers Siebenhaller Hegemann Gladisch raykov
/**
 * DDLT spec for the swimlanes layout of 6-legal-constr-sales.mmd.
 *
 * This fixture exercises routing around a very large obstacle node (J = 232×150)
 * while a sibling edge from the same source (I) must escape past J to reach K
 * and onward to L/M/N in neighbour lanes. See
 * `cypress/platform/dev-diagrams/layout-tests/swimlanes/6-legal-constr-sales.mmd`.
 *
 * Iteration 17 symptom (user, 2026-04-16): edge I→K runs "almost hugging"
 * node J before turning away — aesthetic only, not an L1 violation.
 *
 * Structure mirrors `simple-2.ddlt.spec.ts` — canonical DDLT pattern.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { LayoutData } from '../../types.js';
import { Diagram } from '../../../Diagram.js';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import { preprocessDiagram } from '../../../preprocess.js';
import { toGraphView, writeBackToLayoutData } from './helpers.js';
import { sugiyamaLayout } from './pipeline.js';
import { routeEdgesOrthogonal } from './raykovGemini/raykov.js';
import { applySwimlaneDirectionTransform } from './direction.js';
import { createEdgeLabelNodes } from './edgeLabelNodes.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { loadFreshSizesFixture } from '../ddlt/fixtureSizes.js';

interface FixtureNode {
  id: string;
  width: number;
  height: number;
}

interface SizesFixture {
  nodes: FixtureNode[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURE_PATH = resolve(
  __dirname,
  '../../../../../../cypress/platform/dev-diagrams/layout-tests/swimlanes/6-legal-constr-sales.sizes.json'
);

const MMD_PATH = resolve(
  __dirname,
  '../../../../../../cypress/platform/dev-diagrams/layout-tests/swimlanes/6-legal-constr-sales.mmd'
);

function loadFixture(): SizesFixture {
  return loadFreshSizesFixture(FIXTURE_PATH, MMD_PATH, 'swimlanes/6-legal-constr-sales');
}

function fixtureSizeById(fixture: SizesFixture, id: string) {
  return fixture.nodes.find((n) => n.id === id);
}

async function parseLayout(): Promise<LayoutData> {
  const mmdText = readFileSync(MMD_PATH, 'utf-8');
  const { code } = preprocessDiagram(mmdText);
  const diagram = await Diagram.fromText(code);
  const layoutData = (diagram.db as { getData: () => LayoutData }).getData();

  const getDirection = (diagram.db as { getDirection?: () => string }).getDirection;
  const direction = getDirection?.call(diagram.db) ?? 'TB';
  (layoutData as LayoutData & { direction?: string }).direction = direction;

  const cfg = (layoutData.config ??= {} as LayoutData['config']);
  const flowchartCfg = ((cfg as { flowchart?: Record<string, unknown> }).flowchart ??= {});
  flowchartCfg.nodeSpacing = (flowchartCfg.nodeSpacing as number | undefined) ?? 40;
  flowchartCfg.rankSpacing = (flowchartCfg.rankSpacing as number | undefined) ?? 100;
  flowchartCfg.ignoreCrossLaneEdges = true;
  flowchartCfg.optimizeRanksByCrossings = true;

  return layoutData;
}

function applyCapturedContentSizes(layout: LayoutData, fixture: SizesFixture) {
  for (const node of layout.nodes) {
    if (node.isGroup) {
      continue;
    }
    const size = fixtureSizeById(fixture, node.id);
    if (!size) {
      throw new Error(
        `Fixture is missing size for parser-produced content node "${node.id}". ` +
          `Known fixture ids: ${fixture.nodes.map((n) => n.id).join(', ')}`
      );
    }
    (node as { width: number; height: number }).width = size.width;
    (node as { width: number; height: number }).height = size.height;
  }
}

function applyCapturedLabelSizes(layout: LayoutData, fixture: SizesFixture) {
  for (const node of layout.nodes) {
    if (!(node as { isEdgeLabel?: boolean }).isEdgeLabel) {
      continue;
    }
    const size = fixtureSizeById(fixture, node.id);
    if (!size) {
      throw new Error(
        `Fixture is missing size for parser-produced label node "${node.id}". ` +
          `The fixture must contain edge-label-<start>-<end>-<edgeId> for every ` +
          `labelled edge produced by the parser.`
      );
    }
    (node as { width: number; height: number }).width = size.width;
    (node as { width: number; height: number }).height = size.height;
  }
}

async function runSwimlanes(fixture: SizesFixture): Promise<LayoutData> {
  const parsed = await parseLayout();
  applyCapturedContentSizes(parsed, fixture);

  const { data } = createEdgeLabelNodes(parsed);
  const layout = data;
  (layout as LayoutData & { direction?: string }).direction = (
    parsed as LayoutData & { direction?: string }
  ).direction;
  applyCapturedLabelSizes(layout, fixture);

  const g = toGraphView(layout);
  const nodeGap = layout.config.flowchart?.nodeSpacing ?? 40;
  const layerGap = layout.config.flowchart?.rankSpacing ?? 100;

  const direction = ((layout as LayoutData & { direction?: string }).direction ?? 'TB') as
    | 'TB'
    | 'LR'
    | 'BT'
    | 'RL';

  const { ordered, coordinates } = sugiyamaLayout(g, {
    nodeGap,
    layerGap,
    sweeps: 3,
    useTranspose: true,
    heuristic: 'median',
    cycleHeuristic: 'dfs',
    straightenLongEdges: true,
    ignoreCrossLaneEdges: true,
    optimizeRanksByCrossings: true,
    direction,
  });

  writeBackToLayoutData(g, ordered, coordinates, { nodeGap, layerGap });

  for (const edge of layout.edges ?? []) {
    delete (edge as { points?: unknown }).points;
  }

  routeEdgesOrthogonal(layout, direction);
  applySwimlaneDirectionTransform(layout, direction);

  return layout;
}

describe('Swimlanes DDLT — 6-legal-constr-sales.mmd', () => {
  let fixture: SizesFixture;

  beforeAll(() => {
    addDiagrams();
    fixture = loadFixture();
  });

  it('Level 1: validateLayout — produces a valid orthogonal layout', async () => {
    const layout = await runSwimlanes(fixture);
    const result = validateLayout(layout);
    if (!result.ok) {
      console.log(
        '[LEGAL_CONSTR_DDLT] validateLayout issues:',
        JSON.stringify(result.issues, null, 2)
      );
    }
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('Level 0: baseline telemetry — dump node positions + I-edge polylines', async () => {
    const layout = await runSwimlanes(fixture);
    const nodes = (layout.nodes ?? []).filter(
      (n) => !n.isGroup && !(n as { isEdgeLabel?: boolean }).isEdgeLabel
    );
    const summary = nodes
      .map((n) => {
        const x = (n as { x?: number }).x ?? NaN;
        const y = (n as { y?: number }).y ?? NaN;
        const w = (n as { width?: number }).width ?? NaN;
        const h = (n as { height?: number }).height ?? NaN;
        return {
          id: n.id,
          cx: x,
          cy: y,
          w,
          h,
          left: x - w / 2,
          right: x + w / 2,
          top: y - h / 2,
          bottom: y + h / 2,
        };
      })
      .sort((a, b) => (a.cx === b.cx ? a.cy - b.cy : a.cx - b.cx));

    console.log('[LEGAL_CONSTR_DDLT] nodes:', JSON.stringify(summary, null, 2));
    const edgesOfInterest = (layout.edges ?? []).filter((e) =>
      ['L_I_J_0', 'L_I_K_0', 'L_H_I_0', 'L_K_L_0', 'L_J_E_0'].includes(e.id ?? '')
    );
    const polylines = edgesOfInterest.map((e) => ({
      id: e.id,
      points: (e as { points?: { x: number; y: number }[] }).points,
    }));

    console.log('[LEGAL_CONSTR_DDLT] key polylines:', JSON.stringify(polylines, null, 2));
    expect(true).toBe(true); // diagnostic only
  });

  it('Level 1: L_I_K_0 interior vertical has ≥20u clearance from J.left (iter 17 Wybrow nudge)', async () => {
    // Iter 17 regression pin — Wybrow §Nudging applied as a post-route
    // single-segment nudge (NotebookLM src e8804c93-74b7-4e06-94d0-7e5cf95fe7e3).
    //
    // Baseline geometry:
    //   J: left=571.58, top=590.34, bottom=740.34  (232×150 obstacle)
    //   L_I_K_0 polyline descends at x=566.43, i.e. 5.15u LEFT of J.left.
    //   The vertical segment at x=566.43 runs from y=703.29 to y=804.34,
    //   paralleling J.left (571.58) at only 5.15u over ~37u of J's face.
    //
    // Wybrow: interior segments should sit toward the alley mid-line under
    // ordering + non-crossing constraints. Hegemann & Wolff (b65b3d45)
    // prescribe the same target via channel-centre at construction time.
    // Gladisch (32fe421c) formalises clearance as μ (minimum) + δ (safety).
    //
    // This assertion pins ≥20u clearance on the interior vertical segment
    // that passes J's y-span. The nudge must NOT rewrite first/last stubs.
    const layout = await runSwimlanes(fixture);
    const edge = (layout.edges ?? []).find((e) => e.id === 'L_I_K_0');
    expect(edge).toBeDefined();
    const pts = (edge as { points?: { x: number; y: number }[] }).points ?? [];
    expect(pts.length).toBeGreaterThanOrEqual(4);
    // J's extent
    const jNode = (layout.nodes ?? []).find((n) => n.id === 'J');
    expect(jNode).toBeDefined();
    const jx = (jNode as { x: number }).x;
    const jy = (jNode as { y: number }).y;
    const jw = (jNode as { width: number }).width;
    const jh = (jNode as { height: number }).height;
    const jLeft = jx - jw / 2;
    const jRight = jx + jw / 2;
    const jTop = jy - jh / 2;
    const jBottom = jy + jh / 2;
    // Find axis-aligned vertical segments that span any part of J's y-range.
    const verticals: { x: number; yMin: number; yMax: number; idx: number }[] = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const dx = Math.abs(a.x - b.x);
      const dy = Math.abs(a.y - b.y);
      if (dx < 0.01 && dy > 0.5) {
        verticals.push({
          x: a.x,
          yMin: Math.min(a.y, b.y),
          yMax: Math.max(a.y, b.y),
          idx: i - 1,
        });
      }
    }
    const overlappingJ = verticals.filter((v) => v.yMin < jBottom && v.yMax > jTop);
    // At least one vertical should overlap J's y-range (the detour pass-by).
    expect(overlappingJ.length).toBeGreaterThan(0);
    // Every such vertical must be ≥ MIN_CLEARANCE_BUFFER (20u) from J on whichever
    // side it sits (left or right). Interior segment only — skip if it coincides
    // with an endpoint stub (which anchors at I.right/K.left port geometry).
    const MIN_CLEARANCE = 20;
    const offenders = overlappingJ
      .filter((v) => v.x < jLeft || v.x > jRight) // outside J rect
      .map((v) => ({
        ...v,
        gapLeft: jLeft - v.x, // positive if to the LEFT of J
        gapRight: v.x - jRight, // positive if to the RIGHT of J
      }))
      .filter((v) => {
        const signedGap = v.x < jLeft ? v.gapLeft : v.gapRight;
        return signedGap < MIN_CLEARANCE;
      });
    if (offenders.length > 0) {
      console.log('[LEGAL_CONSTR_DDLT] L_I_K_0 hug offenders:', JSON.stringify(offenders, null, 2));
    }
    expect(offenders).toEqual([]);
  });

  it('Level 2: validateLayout — quality breakdown baseline', async () => {
    const layout = await runSwimlanes(fixture);
    const { breakdown } = validateLayout(layout);
    const totalBends = breakdown.edges.reduce((acc, e) => acc + Math.max(0, e.points - 2), 0);
    const avgBendsPerEdge = breakdown.edgeCount > 0 ? totalBends / breakdown.edgeCount : 0;

    console.log('[LEGAL_CONSTR_DDLT] breakdown:', JSON.stringify(breakdown, null, 2));
    expect.soft(breakdown.crossings).toBe(0);
    expect.soft(avgBendsPerEdge).toBeLessThan(5);
    expect.soft(totalBends).toBeLessThanOrEqual(40);
  });
});
