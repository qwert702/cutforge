// 工具栏:工程菜单(新建/打开/重命名)+ 撤销重做 + 剪辑操作 + 播放 + 导出 + 缩放。
// 快捷键在 App 层统一处理。

import { useEffect, useRef, useState } from 'react';
import { canRedo, canUndo } from '../../core/history.ts';
import { clipsAtTime, projectDuration } from '../../core/select.ts';
import { uid } from '../../core/types.ts';
import { persistNow } from '../../persist/autosave.ts';
import { allMediaBlobs } from '../../persist/mediaRegistry.ts';
import { exportProjectFile, importProjectFile, newProjectId, projectFileName } from '../../persist/projectFile.ts';
import { editorStore, useEditor, useProject } from '../hooks/useEditorStore.ts';
import { getTheme, subscribeTheme, toggleTheme } from '../theme.ts';
import { ExportDialog } from './ExportDialog.tsx';
import { ModalPortal } from './ModalPortal.tsx';
import { OpenProjectDialog } from './OpenProjectDialog.tsx';
import { useSyncExternalStore } from 'react';

export function Toolbar(props: { onShowHelp: () => void; onOpenSettings: () => void }) {
  const doc = useProject();
  const { history, selection, playhead, playing, zoom } = useEditor();
  const selectedId = selection[0];
  const [exporting, setExporting] = useState(false);
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getTheme);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [openDialogVisible, setOpenDialogVisible] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!projectMenuOpen) return;
    const close = (event: PointerEvent) => {
      if (!projectMenuRef.current?.contains(event.target as Node)) setProjectMenuOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [projectMenuOpen]);

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

  const fitZoom = () => {
    const duration = projectDuration(doc);
    if (duration <= 0) return;
    const lanes = document.querySelector('.timeline-scroll');
    const width = (lanes?.clientWidth ?? 800) - 24;
    editorStore.setZoom(width / duration);
  };

  const commitRename = (name: string) => {
    setRenaming(false);
    const trimmed = name.trim();
    if (trimmed && trimmed !== doc.name) {
      editorStore.dispatch({ type: 'project.rename', name: trimmed }, '重命名工程');
    }
  };

  const exportProjectToFile = async () => {
    setProjectMenuOpen(false);
    await persistNow(); // 确保工程与注册表最新
    try {
      const file = await exportProjectFile(
        editorStore.get().history.present,
        allMediaBlobs(),
      );
      const url = URL.createObjectURL(file);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = projectFileName(editorStore.get().history.present.name);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      editorStore.notify('工程文件已导出(含素材,可分享或换机续剪)');
    } catch (error) {
      editorStore.notify(`导出失败:${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const importProjectFromFile = async (file: File) => {
    await persistNow(); // 先保存当前工程再切换
    try {
      const loaded = await importProjectFile(file);
      const blobs = loaded.media;
      const urls = new Map([...blobs.keys()].map((assetId) => [assetId, URL.createObjectURL(blobs.get(assetId)!)]));
      const restoredDoc = {
        ...loaded.doc,
        assets: loaded.doc.assets.map((a) => ({ ...a, url: urls.get(a.id) ?? '' })),
      };
      editorStore.loadProjectRecord(newProjectId('proj'), restoredDoc);
      await persistNow();
      editorStore.notify(`已导入工程「${restoredDoc.name}」`);
    } catch (error) {
      editorStore.notify(`导入失败:${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <div className="toolbar">
      <span className="toolbar-brand">CutForge</span>
      <div className="toolbar-project-wrap" ref={projectMenuRef}>
        {renaming ? (
          <input
            className="toolbar-project-input"
            autoFocus
            defaultValue={doc.name}
            onBlur={(e) => commitRename(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename(e.currentTarget.value);
              if (e.key === 'Escape') setRenaming(false);
            }}
          />
        ) : (
          <button
            type="button"
            className="toolbar-project"
            title="点击修改工程名"
            onClick={() => setRenaming(true)}
          >
            {doc.name}
          </button>
        )}
        <button
          type="button"
          className="btn btn-small"
          title="工程菜单"
          onClick={() => setProjectMenuOpen(!projectMenuOpen)}
        >
          ▾
        </button>
        {projectMenuOpen && (
          <div className="project-menu">
            <button type="button" className="project-menu-item" onClick={() => { editorStore.newProject(); setProjectMenuOpen(false); }}>
              新建工程
            </button>
            <button
              type="button"
              className="project-menu-item"
              onClick={async () => {
                setProjectMenuOpen(false);
                await persistNow(); // 打开列表前冲刷当前工程
                setOpenDialogVisible(true);
              }}
            >
              打开工程…
            </button>
            <button type="button" className="project-menu-item" onClick={() => setRenaming(true)}>
              重命名
            </button>
            <button type="button" className="project-menu-item" onClick={() => void exportProjectToFile()}>
              导出工程文件
            </button>
            <button type="button" className="project-menu-item" onClick={() => importInputRef.current?.click()}>
              导入工程文件
            </button>
          </div>
        )}
        <input
          ref={importInputRef}
          type="file"
          accept=".cforge"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importProjectFromFile(file);
            e.target.value = '';
          }}
        />
      </div>
      <div className="toolbar-sep" />
      <button type="button" className="btn" onClick={() => editorStore.undo()} disabled={!canUndo(history)} title="撤销 (Ctrl+Z)">
        ↶
      </button>
      <button type="button" className="btn" onClick={() => editorStore.redo()} disabled={!canRedo(history)} title="重做 (Ctrl+Shift+Z)">
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
      <button type="button" className="btn" onClick={() => editorStore.setPlaying(!playing)} title="播放/暂停 (空格)">
        {playing ? '⏸' : '▶'}
      </button>
      <span className="toolbar-time">
        {playhead.toFixed(2)}s / {projectDuration(doc).toFixed(2)}s
      </span>
      <div className="toolbar-spacer" />
      <button
        type="button"
        className="btn"
        onClick={toggleTheme}
        title={theme === 'light' ? '切换到深色主题' : '切换到亮色主题'}
      >
        {theme === 'light' ? '🌙' : '☀️'}
      </button>
      <button type="button" className="btn" onClick={props.onOpenSettings} title="设置(模型服务/快捷键)">
        ⚙
      </button>
      <button type="button" className="btn btn-primary" onClick={() => setExporting(true)} title="导出视频">
        导出
      </button>
      <button type="button" className="btn" onClick={fitZoom} title="缩放适配工程时长">
        适配
      </button>
      <button type="button" className="btn" onClick={props.onShowHelp} title="引导与快捷键 (?)">
        ?
      </button>
      <button type="button" className="btn" onClick={() => editorStore.setZoom(zoom / 1.5)} title="缩小">
        −
      </button>
      <button type="button" className="btn" onClick={() => editorStore.setZoom(zoom * 1.5)} title="放大">
        ＋
      </button>
      {exporting && <ModalPortal><ExportDialog onClose={() => setExporting(false)} /></ModalPortal>}
      {openDialogVisible && <ModalPortal><OpenProjectDialog onClose={() => setOpenDialogVisible(false)} /></ModalPortal>}
    </div>
  );
}
