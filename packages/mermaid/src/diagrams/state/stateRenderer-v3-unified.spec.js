import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../diagram-api/diagramAPI.js', () => ({
  getConfig: vi.fn(() => ({
    securityLevel: 'loose',
    state: {
      titleTopMargin: 25,
      useMaxWidth: true,
      nodeSpacing: 50,
      rankSpacing: 50,
    },
    layout: 'dagre',
    look: 'classic',
  })),
}));

vi.mock('../../rendering-util/render.js', () => ({
  render: vi.fn((_data, svg) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    node.setAttribute('class', 'node');

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.textContent = 'Google';
    node.appendChild(label);

    svg.node().appendChild(node);
  }),
}));

vi.mock('../../rendering-util/setupViewPortForSVG.js', () => ({
  setupViewPortForSVG: vi.fn(),
}));

import { StateDB } from './stateDb.js';
import { draw } from './stateRenderer-v3-unified.js';

const DIAGRAM_ID = 'state-click-tooltip';

describe('stateRenderer v3 clickable links', () => {
  beforeEach(() => {
    document.body.innerHTML = `<svg id="${DIAGRAM_ID}"></svg>`;
  });

  it('uses mermaidTooltip for state click tooltips', async () => {
    const stateDb = new StateDB(1);
    stateDb.addLink('Google', '"https://google.com"', '"Visit Google"');

    await draw('', DIAGRAM_ID, '1.0.0', {
      type: 'stateDiagram',
      db: stateDb,
    });

    const node = document.querySelector(`svg#${DIAGRAM_ID} a > g.node`);

    expect(node).not.toBeNull();
    expect(node.getAttribute('title')).toBe('Visit Google');

    stateDb.bindFunctions(document.body);

    const tooltip = document.querySelector('.mermaidTooltip');
    expect(tooltip).not.toBeNull();

    node.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));

    expect(tooltip.innerHTML).toBe('Visit Google');
    expect(node.classList.contains('hover')).toBe(true);

    node.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true }));

    expect(node.classList.contains('hover')).toBe(false);
  });
});
