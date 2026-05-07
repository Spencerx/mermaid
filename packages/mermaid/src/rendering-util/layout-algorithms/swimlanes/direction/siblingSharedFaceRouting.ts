// cspell:ignore Hegemann Kandinsky Siebenhaller
import { log } from '../../../../logger.js';

const SWIMLANE_DIR_LOG_PREFIX = 'SWIMLANE_DIR';

/**
 * Iter 12 — co-route sibling straight-line rescue.
 *
 * Fires only on the narrow "4-point U-detour around a collinear blocker
 * where the obvious straight line is geometrically clear" shape. For each
 * eligible edge, shifts the source and destination attach points by
 * MIN_PORT_SPACING/2 along the shared face and replaces the polyline
 * with a 2-point straight line. The shift direction is chosen by trying
 * both +delta and -delta and picking whichever doesn't introduce a new
 * edge crossing or leave the node's face span.
 *
 * Paper backing: Hegemann & Wolff "On the smoothing of orthogonal
 * connector layouts" (NotebookLM src b65b3d45) §4.2 / Fig. 11 —
 * joint-feasibility via port distribution rather than face exclusion.
 * Mermaid-specific narrowing: we only rescue the exact 4-point shape to
 * minimize blast radius.
 */
export function straightenCollinearSiblingDetours(edges: any[], nodes: any[]): void {
  const EPS = 1e-6;
  const MIN_PORT_SPACING = 8;
  const PORT_SHIFT = MIN_PORT_SPACING / 2;

  interface RectLite {
    left: number;
    right: number;
    top: number;
    bottom: number;
  }
  interface NodeInfo {
    id: string;
    cx: number;
    cy: number;
    rect: RectLite;
  }

  const nodeInfoById = new Map<string, NodeInfo>();
  const realNodeRects: { id: string; rect: RectLite }[] = [];
  for (const n of nodes) {
    if ((n as { isGroup?: boolean }).isGroup) {
      continue;
    }
    if ((n as { isEdgeLabel?: boolean }).isEdgeLabel) {
      continue;
    }
    const cx = (n as { x?: number }).x ?? 0;
    const cy = (n as { y?: number }).y ?? 0;
    const w = (n as { width?: number }).width ?? 0;
    const h = (n as { height?: number }).height ?? 0;
    if (w <= 0 || h <= 0) {
      continue;
    }
    const id = String((n as { id?: string }).id ?? '');
    const rect: RectLite = {
      left: cx - w / 2,
      right: cx + w / 2,
      top: cy - h / 2,
      bottom: cy + h / 2,
    };
    nodeInfoById.set(id, { id, cx, cy, rect });
    realNodeRects.push({ id, rect });
  }

  const segmentHitsNode = (
    a: { x: number; y: number },
    b: { x: number; y: number },
    excludeIds: string[]
  ): boolean => {
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    for (const n of realNodeRects) {
      if (excludeIds.includes(n.id)) {
        continue;
      }
      if (
        maxX > n.rect.left + 1 &&
        minX < n.rect.right - 1 &&
        maxY > n.rect.top + 1 &&
        minY < n.rect.bottom - 1
      ) {
        return true;
      }
    }
    return false;
  };

  const segmentsCrossOrth = (
    a1: { x: number; y: number },
    b1: { x: number; y: number },
    a2: { x: number; y: number },
    b2: { x: number; y: number }
  ): boolean => {
    const s1H = Math.abs(a1.y - b1.y) < EPS;
    const s1V = Math.abs(a1.x - b1.x) < EPS;
    const s2H = Math.abs(a2.y - b2.y) < EPS;
    const s2V = Math.abs(a2.x - b2.x) < EPS;
    if ((s1H && s2H) || (s1V && s2V)) {
      return false;
    }
    if (!(s1H || s1V) || !(s2H || s2V)) {
      return false;
    }
    const horiz = s1H ? { a: a1, b: b1 } : { a: a2, b: b2 };
    const vert = s1V ? { a: a1, b: b1 } : { a: a2, b: b2 };
    const hY = horiz.a.y;
    const hX1 = Math.min(horiz.a.x, horiz.b.x);
    const hX2 = Math.max(horiz.a.x, horiz.b.x);
    const vX = vert.a.x;
    const vY1 = Math.min(vert.a.y, vert.b.y);
    const vY2 = Math.max(vert.a.y, vert.b.y);
    if (vX < hX1 || vX > hX2 || hY < vY1 || hY > vY2) {
      return false;
    }
    const ix = vX;
    const iy = hY;
    const TOL = 1e-6;
    const matchesHorizEndpoint =
      (Math.abs(ix - horiz.a.x) < TOL && Math.abs(iy - horiz.a.y) < TOL) ||
      (Math.abs(ix - horiz.b.x) < TOL && Math.abs(iy - horiz.b.y) < TOL);
    const matchesVertEndpoint =
      (Math.abs(ix - vert.a.x) < TOL && Math.abs(iy - vert.a.y) < TOL) ||
      (Math.abs(ix - vert.b.x) < TOL && Math.abs(iy - vert.b.y) < TOL);
    return !(matchesHorizEndpoint && matchesVertEndpoint);
  };

  for (const edge of edges) {
    if ((edge as { isLayoutOnly?: boolean }).isLayoutOnly) {
      continue;
    }
    const pts = (edge as { points?: { x: number; y: number }[] }).points;
    if (!pts || pts.length !== 4) {
      continue;
    }
    const [p0, p1, p2, p3] = pts;
    const seg01H = Math.abs(p0.y - p1.y) < EPS && Math.abs(p0.x - p1.x) > EPS;
    const seg12V = Math.abs(p1.x - p2.x) < EPS && Math.abs(p1.y - p2.y) > EPS;
    const seg23H = Math.abs(p2.y - p3.y) < EPS && Math.abs(p2.x - p3.x) > EPS;
    const seg01V = Math.abs(p0.x - p1.x) < EPS && Math.abs(p0.y - p1.y) > EPS;
    const seg12H = Math.abs(p1.y - p2.y) < EPS && Math.abs(p1.x - p2.x) > EPS;
    const seg23V = Math.abs(p2.x - p3.x) < EPS && Math.abs(p2.y - p3.y) > EPS;
    const isHVH = seg01H && seg12V && seg23H;
    const isVHV = seg01V && seg12H && seg23V;
    if (!isHVH && !isVHV) {
      continue;
    }

    const srcId = (edge as { start?: string }).start;
    const dstId = (edge as { end?: string }).end;
    const edgeId = String((edge as { id?: string }).id ?? '');
    if (!srcId || !dstId) {
      continue;
    }
    const srcInfo = nodeInfoById.get(srcId);
    const dstInfo = nodeInfoById.get(dstId);
    if (!srcInfo || !dstInfo) {
      continue;
    }

    const collinearX = Math.abs(srcInfo.cx - dstInfo.cx) < EPS;
    const collinearY = Math.abs(srcInfo.cy - dstInfo.cy) < EPS;
    if (collinearX === collinearY) {
      continue;
    }

    let targetSrc: { x: number; y: number };
    let targetDst: { x: number; y: number };
    if (collinearX) {
      const dstBelow = dstInfo.cy > srcInfo.cy;
      targetSrc = { x: srcInfo.cx, y: dstBelow ? srcInfo.rect.bottom : srcInfo.rect.top };
      targetDst = { x: dstInfo.cx, y: dstBelow ? dstInfo.rect.top : dstInfo.rect.bottom };
    } else {
      const dstEast = dstInfo.cx > srcInfo.cx;
      targetSrc = { x: dstEast ? srcInfo.rect.right : srcInfo.rect.left, y: srcInfo.cy };
      targetDst = { x: dstEast ? dstInfo.rect.left : dstInfo.rect.right, y: dstInfo.cy };
    }

    if (segmentHitsNode(targetSrc, targetDst, [srcId, dstId])) {
      continue;
    }

    const deltas = [0, PORT_SHIFT, -PORT_SHIFT];
    for (const delta of deltas) {
      const shiftedSrc = { ...targetSrc };
      const shiftedDst = { ...targetDst };
      if (collinearX) {
        shiftedSrc.x += delta;
        shiftedDst.x += delta;
        if (shiftedSrc.x <= srcInfo.rect.left || shiftedSrc.x >= srcInfo.rect.right) {
          continue;
        }
        if (shiftedDst.x <= dstInfo.rect.left || shiftedDst.x >= dstInfo.rect.right) {
          continue;
        }
      } else {
        shiftedSrc.y += delta;
        shiftedDst.y += delta;
        if (shiftedSrc.y <= srcInfo.rect.top || shiftedSrc.y >= srcInfo.rect.bottom) {
          continue;
        }
        if (shiftedDst.y <= dstInfo.rect.top || shiftedDst.y >= dstInfo.rect.bottom) {
          continue;
        }
      }

      if (segmentHitsNode(shiftedSrc, shiftedDst, [srcId, dstId])) {
        continue;
      }

      const shiftedIsVertical = Math.abs(shiftedSrc.x - shiftedDst.x) < EPS;
      const shiftedMinX = Math.min(shiftedSrc.x, shiftedDst.x);
      const shiftedMaxX = Math.max(shiftedSrc.x, shiftedDst.x);
      const shiftedMinY = Math.min(shiftedSrc.y, shiftedDst.y);
      const shiftedMaxY = Math.max(shiftedSrc.y, shiftedDst.y);
      let introducesCrossing = false;
      for (const other of edges) {
        if (other === edge) {
          continue;
        }
        if ((other as { isLayoutOnly?: boolean }).isLayoutOnly) {
          continue;
        }
        const opts = (other as { points?: { x: number; y: number }[] }).points;
        if (!opts || opts.length < 2) {
          continue;
        }
        for (let i = 0; i < opts.length - 1; i++) {
          if (segmentsCrossOrth(shiftedSrc, shiftedDst, opts[i], opts[i + 1])) {
            introducesCrossing = true;
            break;
          }
          const oa = opts[i];
          const ob = opts[i + 1];
          const otherIsVertical = Math.abs(oa.x - ob.x) < EPS;
          const otherIsHorizontal = Math.abs(oa.y - ob.y) < EPS;
          if (shiftedIsVertical && otherIsVertical && Math.abs(oa.x - shiftedSrc.x) < EPS) {
            const oMinY = Math.min(oa.y, ob.y);
            const oMaxY = Math.max(oa.y, ob.y);
            if (oMaxY > shiftedMinY + EPS && oMinY < shiftedMaxY - EPS) {
              introducesCrossing = true;
              break;
            }
          } else if (
            !shiftedIsVertical &&
            otherIsHorizontal &&
            Math.abs(oa.y - shiftedSrc.y) < EPS
          ) {
            const oMinX = Math.min(oa.x, ob.x);
            const oMaxX = Math.max(oa.x, ob.x);
            if (oMaxX > shiftedMinX + EPS && oMinX < shiftedMaxX - EPS) {
              introducesCrossing = true;
              break;
            }
          }
        }
        if (introducesCrossing) {
          break;
        }
      }
      if (introducesCrossing) {
        continue;
      }

      (edge as { points?: { x: number; y: number }[] }).points = [shiftedSrc, shiftedDst];
      log.debug(
        SWIMLANE_DIR_LOG_PREFIX,
        `straightenCollinearSiblingDetours: rescued ${edgeId} to 2-point straight at ${collinearX ? 'x' : 'y'}=${collinearX ? shiftedSrc.x : shiftedSrc.y} (delta=${delta})`
      );
      break;
    }
  }
}
