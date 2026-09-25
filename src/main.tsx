import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// 仅开发环境的端到端测试桥(生产构建被 import.meta.env.DEV 剔除)
if (import.meta.env.DEV) {
  void (async () => {
    const [{ editorStore }, { executeTool }, { loadDemoProject }] = await Promise.all([
      import('./ui/hooks/useEditorStore.ts'),
      import('./agent/tools.ts'),
      import('./media/demo.ts'),
    ]);
    (window as unknown as Record<string, unknown>).__cf = { editorStore, executeTool, loadDemoProject };
  })();
}
