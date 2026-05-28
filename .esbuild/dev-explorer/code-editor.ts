import { LitElement, html } from 'lit';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap as keyMap,
  lineNumbers,
} from '@codemirror/view';

export class DevCodeEditor extends LitElement {
  static properties = {
    value: { type: String },
  };

  declare value: string;

  #view?: EditorView;
  #syncingExternalValue = false;

  constructor() {
    super();
    this.value = '';
  }

  createRenderRoot() {
    return this;
  }

  firstUpdated() {
    this.#mountEditor();
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has('value')) {
      this.#syncEditorValue();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#view?.destroy();
    this.#view = undefined;
  }

  requestMeasure() {
    this.#view?.requestMeasure();
  }

  #mountEditor() {
    const parent = this.querySelector('.code-editor-mount');
    if (!parent || this.#view) return;

    this.#view = new EditorView({
      doc: this.value,
      root: document,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        EditorState.allowMultipleSelections.of(true),
        highlightActiveLine(),
        keyMap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || this.#syncingExternalValue) return;
          this.dispatchEvent(
            new CustomEvent('code-change', {
              detail: { value: update.state.doc.toString() },
              bubbles: true,
              composed: true,
            })
          );
        }),
        EditorView.domEventHandlers({
          keydown: (event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
              event.preventDefault();
              this.dispatchEvent(new CustomEvent('save-code', { bubbles: true, composed: true }));
              return true;
            }
            return false;
          },
        }),
      ],
      parent,
    });
  }

  #syncEditorValue() {
    if (!this.#view) return;
    const nextValue = this.value ?? '';
    const currentValue = this.#view.state.doc.toString();
    if (currentValue === nextValue) return;

    this.#syncingExternalValue = true;
    this.#view.dispatch({
      changes: {
        from: 0,
        to: this.#view.state.doc.length,
        insert: nextValue,
      },
    });
    this.#syncingExternalValue = false;
  }

  render() {
    return html`<div class="code-editor-mount"></div>`;
  }
}

customElements.define('dev-code-editor', DevCodeEditor);
