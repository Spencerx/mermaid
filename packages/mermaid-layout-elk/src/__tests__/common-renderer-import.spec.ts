import { describe, expect, it } from 'vitest';
import {
  createCommonLayoutRenderer,
  paintLayoutData,
  type CommonLayoutRendererDefinition,
} from '../../../mermaid/src/mermaid.js';

describe('Mermaid common layout renderer source export', () => {
  it('is importable from the ELK layout package source tests', () => {
    const definition: CommonLayoutRendererDefinition = {
      runLayoutCore: () => undefined,
      paintLayout: () => undefined,
    };

    expect(typeof createCommonLayoutRenderer).toBe('function');
    expect(typeof createCommonLayoutRenderer(definition)).toBe('function');
    expect(typeof paintLayoutData).toBe('function');
  });
});
