// CutForge 桌面壳(Electron 主进程)。
// 开发:CF_DEV_URL=http://localhost:5300 npx electron .
// 冒烟:CF_SMOKE=1 npx electron .  → 加载完成后打印 CF_SMOKE_OK 并退出
// 生产:加载 dist/index.html(相对 base,无需服务器)
import { app, BrowserWindow, Menu } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env.CF_DEV_URL;
const SMOKE = process.env.CF_SMOKE === '1';

async function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'CutForge',
    backgroundColor: '#14161a',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.on('page-title-updated', (event) => event.preventDefault());
  if (SMOKE) {
    win.webContents.on('did-finish-load', () => {
      setTimeout(() => {
        console.log('CF_SMOKE_OK');
        app.quit();
      }, 1500);
    });
  }
  if (DEV_URL) await win.loadURL(DEV_URL);
  else await win.loadFile(path.join(dirname, '../dist/index.html'));
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  void createWindow();
});
app.on('window-all-closed', () => app.quit());
