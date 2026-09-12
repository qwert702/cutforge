import { useEffect } from 'react';
import { clipsAtTime } from '../core/select.ts';
import { uid } from '../core/types.ts';
import { editorStore, useEditor } from './hooks/useEditorStore.ts';
import { ChatPanel } from './components/ChatPanel.tsx';
import { MediaLibrary } from './components/MediaLibrary.tsx';
import { Preview } from './components/Preview.tsx';
import { Timeline } from './components/Timeline.tsx';
import { Toolbar } from './components/Toolbar.tsx';

export function App() {
  const { message, playing } = useEditor();

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
      <Toolbar />
      <div className="app-main">
        <MediaLibrary />
        <div className="app-center">
          <Preview />
          <Timeline />
        </div>
        <ChatPanel />
      </div>
      {message && (
        <div className="toast" role="alert" onClick={() => editorStore.clearMessage()}>
          {message}
        </div>
      )}
    </div>
  );
}
