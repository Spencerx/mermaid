import { describe, expect, it } from 'vitest';
import { getNodeIcon, treeViewIcons } from './icons.js';

describe('icons', () => {
  describe('treeViewIcons pack', () => {
    it('uses the mermaid-treeview prefix', () => {
      expect(treeViewIcons.prefix).toBe('mermaid-treeview');
    });

    it('contains exactly the built-in file and folder icons', () => {
      expect(Object.keys(treeViewIcons.icons).sort()).toEqual(['file', 'folder']);
    });

    it('every icon has a non-empty body that inherits color via currentColor', () => {
      for (const [name, icon] of Object.entries(treeViewIcons.icons)) {
        expect(icon.body.length, `icon "${name}" should have a non-empty body`).toBeGreaterThan(0);
        expect(icon.body, `icon "${name}" should use currentColor`).toContain('currentColor');
      }
    });
  });

  describe('getNodeIcon', () => {
    it('returns the explicit icon regardless of showIcons', () => {
      expect(getNodeIcon('logos:react', 'file', false)).toBe('logos:react');
      expect(getNodeIcon('logos:react', 'file', true)).toBe('logos:react');
    });

    it('returns undefined for none regardless of showIcons', () => {
      expect(getNodeIcon('none', 'file', false)).toBeUndefined();
      expect(getNodeIcon('none', 'directory', true)).toBeUndefined();
    });

    it('returns the default icon by node type when showIcons is true', () => {
      expect(getNodeIcon(undefined, 'directory', true)).toBe('folder');
      expect(getNodeIcon(undefined, 'file', true)).toBe('file');
    });

    it('returns undefined when showIcons is false and no explicit icon is given', () => {
      expect(getNodeIcon(undefined, 'directory', false)).toBeUndefined();
      expect(getNodeIcon(undefined, 'file', false)).toBeUndefined();
    });
  });
});
