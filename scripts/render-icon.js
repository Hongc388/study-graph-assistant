// Renders build/icon.svg to build/icon-1024.png using Electron itself as the
// SVG rasterizer (no extra dependencies). Run: npx electron scripts/render-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SIZE = 1024;
const svgPath = path.join(__dirname, '..', 'build', 'icon.svg');
const outPath = path.join(__dirname, '..', 'build', 'icon-1024.png');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true },
  });
  win.webContents.setFrameRate(1);

  const svg = fs.readFileSync(svgPath, 'utf8');
  const html =
    '<style>html,body{margin:0;background:transparent}</style>' +
    `<div style="width:${SIZE}px;height:${SIZE}px">${svg}</div>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

  // One extra paint tick so the gradient defs are fully composited.
  await new Promise(r => setTimeout(r, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
  fs.writeFileSync(outPath, image.toPNG());
  const px = image.getSize();
  console.log(`ICON_OK ${outPath} ${px.width}x${px.height}`);
  app.exit(0);
}).catch(err => {
  console.error(err);
  app.exit(1);
});
