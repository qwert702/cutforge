// 主题状态:亮色(默认)/ 深色,持久化到 localStorage 并同步到 <html data-theme>。
// index.html 里有早期脚本按同一存储键设置初始属性,避免首帧闪烁。

type Theme = 'light' | 'dark';
type Listener = () => void;

const KEY = 'cutforge.theme';
const listeners = new Set<Listener>();

function current(): Theme {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function apply(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function getTheme(): Theme {
  return current();
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* 忽略 */
  }
  apply(theme);
  listeners.forEach((fn) => fn());
}

export function toggleTheme(): void {
  setTheme(current() === 'light' ? 'dark' : 'light');
}

export function subscribeTheme(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 应用启动时调用:确保 DOM 属性与存储一致(早期脚本兜底的再保险)。 */
export function initTheme(): void {
  apply(current());
}
