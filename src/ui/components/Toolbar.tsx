// 工具栏:撤销/重做/分割/删除/播放控制/缩放/导出。快捷键在 App 层统一处理。

import { canRedo, canUndo } from '../../core/history.ts';
import { clipsAtTime } from '../../core/select.ts';
import { uid } from '../../core/types.ts';
import { editorStore, useEditor, useProject } from '../hooks/useEditorStore.ts';
import { useState } from 'react';
import { ExportDialog } from './ExportDialog.tsx';

export function Toolbar() {
  const doc = useProject();
  const { history, selection, playhead, playing, zoom } = useEditor();
  const selectedId = selection[0];
  const [exporting, setExporting] = useState(false);

  const splitAtPlayhead = () => {
    for (const clip of clipsAtTime(doc, playhead)) {
      editorStore.dispatch({ type: 'clip.split', clipId: clip.id, at: playhead, newClipId: uid('clip') }, '分割片段');
    }
  };

  const deleteSelected = () => {
    if (selection.length === 0) return;
    editorStore.dispatchAll(
      selection.map((clipId) => ({ type: 'clip.remove', clipId }) as const),
      '删除片段',
    );
  };

  const togglePlay = () => {
    editorStore.setPlaying(!playing);
  };

  return (
    <div className="toolbar">
      <span className="toolbar-brand">CutForge</span>
      <span className="toolbar-project">{doc.name}</span>
      <div className="toolbar-sep" />
      <button type="button" className="btn" onClick={undo} disabled={!canUndo(history)} title="撤销 (Ctrl+Z)">
        ↶
      </button>
      <button type="button" className="btn" onClick={redo} disabled={!canRedo(history)} title="重做 (Ctrl+Shift+Z)">
        ↷
      </button>
      <div className="toolbar-sep" />
      <button
        type="button"
        className="btn"
        onClick={() => selectedId && editorStore.dispatch({ type: 'clip.duplicate', clipId: selectedId, newClipId: uid('clip') }, '复制片段')}
        disabled={!selectedId}
        title="复制选中片段"
      >
        复制
      </button>
      <button type="button" className="btn" onClick={splitAtPlayhead} title="在播放头分割 (S)">
        分割
      </button>
      <button type="button" className="btn" onClick={deleteSelected} disabled={selection.length === 0} title="删除选中 (Del)">
        删除
      </button>
      <div className="toolbar-sep" />
      <button type="button" className="btn" onClick={togglePlay} title="播放/暂停 (空格)">
        {playing ? '⏸' : '▶'}
      </button>
      <span className="toolbar-time">
        {playhead.toFixed(2)}s / {doc.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0).toFixed(2)}s
      </span>
      <div className="toolbar-spacer" />
      <button type="button" className="btn btn-primary" onClick={() => setExporting(true)} title="导出 WebM">
        导出
      </button>
      <button type="button" className="btn" onClick={() => editorStore.setZoom(zoom / 1.5)} title="缩小">
        −
      </button>
      <button type="button" className="btn" onClick={() => editorStore.setZoom(zoom * 1.5)} title="放大">
        ＋
      </button>
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
    </div>
  );
}

function undo() {
  editorStore.undo();
}
function redo() {
  editorStore.redo();
}
