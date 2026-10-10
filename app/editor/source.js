'use strict';
// Source view: three CodeMirror editors (HTML, CSS, Settings) with error-line highlighting and theme switching.
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';

const LANGS = { html: html(), css: css(), settings: json() };

export function createSourceEditors(container, onChange) {
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  const views = {};
  const themes = {};
  let quiet = false; // set() loads text; only typing counts as a change
  for (const tab of Object.keys(LANGS)) {
    themes[tab] = new Compartment();
    const host = document.createElement('div');
    host.className = `source-${tab}`;
    host.hidden = tab !== 'html';
    host.style.height = '100%';
    container.append(host);
    views[tab] = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: '',
        extensions: [
          basicSetup,
          LANGS[tab],
          themes[tab].of(dark.matches ? oneDark : []),
          EditorView.updateListener.of((u) => { if (u.docChanged && !quiet) onChange(tab); }),
        ],
      }),
    });
  }
  dark.addEventListener('change', () => {
    for (const tab of Object.keys(views)) views[tab].dispatch({ effects: themes[tab].reconfigure(dark.matches ? oneDark : []) });
  });

  return {
    show(tab) {
      for (const [name, view] of Object.entries(views)) view.dom.parentElement.hidden = name !== tab;
      views[tab].focus();
    },
    get(tab) {
      return views[tab].state.doc.toString();
    },
    set(tab, text) {
      const view = views[tab];
      quiet = true;
      try {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      } finally {
        quiet = false;
      }
    },
    highlightLine(tab, line) {
      const view = views[tab];
      const target = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines));
      view.dispatch({ selection: { anchor: target.from, head: target.to }, scrollIntoView: true });
      view.focus();
    },
  };
}
