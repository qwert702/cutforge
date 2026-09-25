import { useEffect, useState } from 'react';
import { clipsAtTime } from '../core/select.ts';
import { uid } from '../core/types.ts';
import { initAutosave } from '../persist/autosave.ts';
import { editorStore, useEditor } from './hooks/useEditorStore.ts';
import { ChatPanel } from './components/ChatPanel.tsx';
import { Inspector } from './components/Inspector.tsx';
import { MediaLibrary } from './components/MediaLibrary.tsx';
import { Preview } from './components/Preview.tsx';
import { Timeline } from './components/Timeline.tsx';
import { Toolbar } from './components/Toolbar.tsx';
import { importFiles } from '../media/import.ts';
import { isOnboardingSeen, Onboarding } from './components/Onboarding.tsx';

export function App() {
  const { message, playing } = useEditor();
  const [dragOver, setDragOver] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => !isOnboardingSeen());

  // 自动保存 + 启动恢复
  useEffect(() => initAutosave(), []);

  // Toast 自动消失
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => editorStore.clearMessage(), 3000);
    return () => clearTimeout(timer);
  }, [message]);

  // 拖拽导入
  useEffect(() => {
    const onOver = (event: DragEvent) => {
      if ([...(event.dataTransfer?.types ?? [])].includes('Files')) {
        event.preventDefault();
        setDragOver(true);
      }
    };
    const onLeave = (event: DragEvent) => {
      if (event.relatedTarget === null) setDragOver(false);
    };
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      setDragOver(false);
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length === 0) return;
      void importFiles(files).then(({ assets, errors }) => {
        if (assets.length > 0) {
          editorStore.dispatchAll(
            assets.map((asset) => ({ type: 'asset.add', asset }) as const),
            `拖入素材`,
          );
        }
        editorStore.notify(
          errors.length > 0
            ? `已导入 ${assets.length} 个,${errors.length} 个失败`
            : assets.length > 0
              ? `已导入 ${assets.length} 个素材`
              : '没有可识别的文件',
        );
      });
    };
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  // 全局快捷键
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      const doc = editorStore.get().history.present;
      if (event.code === 'Space') {
        event.preventDefault();
        editorStore.setPlaying(!playing);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        const { selection } = editorStore.get();
        if (selection.length > 0) {
          event.preventDefault();
          editorStore.dispatchAll(selection.map((clipId) => ({ type: 'clip.remove', clipId }) as const), '删除片段');
        }
      } else if (event.key === 's' || event.key === 'S') {
        const time = editorStore.get().playhead;
        for (const clip of clipsAtTime(doc, time)) {
          editorStore.dispatch({ type: 'clip.split', clipId: clip.id, at: time, newClipId: uid('clip') }, '分割片段');
        }
      } else if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key === 'z') {
        event.preventDefault();
        editorStore.undo();
      } else if ((event.ctrlKey || event.metaKey) && (event.key === 'y' || (event.shiftKey && event.key === 'z'))) {
        event.preventDefault();
        editorStore.redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [playing]);

  return (
    <div className="app">
      <Toolbar onShowHelp={() => setShowOnboarding(true)} />
      <div className="app-main">
        <MediaLibrary />
        <div className="app-center">
          <Preview />
          <Inspector />
          <Timeline />
        </div>
        <ChatPanel />
      </div>
      {showOnboarding && <Onboarding onClose={() => setShowOnboarding(false)} />}
      {message && (
        <div className="toast" role="alert" onClick={() => editorStore.clearMessage()}>
          {message}
        </div>
      )}
      {dragOver && (
        <div className="drop-overlay">
          <div className="drop-overlay-card">松开导入素材(视频 / 音频 / 图片)</div>
        </div>
      )}
    </div>
  );
}
