'use strict';
import grapesjs from 'grapesjs';
import { EditorView } from '@codemirror/view';

window.rfEditorBuildCheck = typeof grapesjs.init === 'function' && typeof EditorView === 'function';
