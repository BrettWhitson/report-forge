'use strict';
// Template preview in its own WebContentsView: same network-blocked session as PDF rendering,
// no preload, sandboxed, and unable to navigate. Template code can never reach the app API.
const { WebContentsView, nativeTheme } = require('electron');
const { getSession } = require('./render-pdf');

const PAGE_WIDTH = 816;

function createPreviewView(win) {
  const view = new WebContentsView({
    webPreferences: { session: getSession(), sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true },
  });
  view.webContents.on('will-navigate', (event) => event.preventDefault());
  view.webContents.on('will-frame-navigate', (event) => { if (!event.isMainFrame || event.url !== view.webContents.getURL()) event.preventDefault(); });
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Matches the .preview-pane background in ui.css for each theme.
  const paintBackground = () => view.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#2b2d33' : '#8a8d99');
  paintBackground();
  nativeTheme.on('updated', paintBackground);
  view.setVisible(false);
  win.contentView.addChildView(view);

  let bounds = null;
  let visible = false;

  function applyZoom() {
    if (!bounds) return;
    const zoom = Math.min(1, Math.max(0.25, (bounds.width - 24) / PAGE_WIDTH));
    view.webContents.setZoomFactor(zoom);
  }

  return {
    view,
    async show(file) {
      await view.webContents.loadFile(file);
      applyZoom();
      view.setVisible(visible || !bounds);
    },
    setBounds(rect, isVisible) {
      bounds = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) };
      visible = Boolean(isVisible);
      view.setBounds(bounds);
      view.setVisible(visible);
      applyZoom();
    },
  };
}

module.exports = { createPreviewView };
