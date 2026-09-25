// 打开工程:列出本地工程库中的工程,支持打开与删除。
import { useEffect, useState } from 'react';
import { editorStore } from '../hooks/useEditorStore.ts';
import { deleteProject, listProjects, loadProject, type ProjectSummary } from '../../persist/projectLibrary.ts';
import { replaceMediaBlobs } from '../../persist/mediaRegistry.ts';
import { persistNow } from '../../persist/autosave.ts';

export function OpenProjectDialog(props: { onClose: () => void }) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void listProjects().then(setProjects);
  }, []);

  const open = async (id: string) => {
    setBusy(true);
    try {
      await persistNow(); // 先保存当前工程再切换
      const record = await loadProject(id);
      if (!record) return;
      const blobs = new Map(record.media.map((m) => [m.assetId, m.blob]));
      replaceMediaBlobs(blobs);
      const urls = new Map([...blobs.keys()].map((assetId) => [assetId, URL.createObjectURL(blobs.get(assetId)!)]));
      const doc = {
        ...record.doc,
        assets: record.doc.assets.map((a) => ({ ...a, url: urls.get(a.id) ?? '' })),
      };
      editorStore.loadProjectRecord(record.id, doc);
      props.onClose();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await deleteProject(id);
    setProjects(await listProjects());
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal">
        <div className="panel-title">
          打开工程
          <button type="button" className="btn btn-small" onClick={props.onClose}>关闭</button>
        </div>
        <div className="project-list">
          {projects === null && <div className="media-empty">读取中…</div>}
          {projects !== null && projects.length === 0 && (
            <div className="media-empty">本地还没有保存的工程</div>
          )}
          {projects?.map((project) => (
            <div key={project.id} className="project-row">
              <button
                type="button"
                className="project-open"
                disabled={busy}
                onClick={() => void open(project.id)}
              >
                <span className="project-name">{project.name}</span>
                <span className="project-time">{new Date(project.savedAt).toLocaleString()}</span>
              </button>
              <button
                type="button"
                className="btn btn-small context-menu-danger"
                disabled={busy}
                title="删除工程"
                onClick={() => void remove(project.id)}
              >
                删除
              </button>
            </div>
          ))}
        </div>
        <div className="chat-settings-hint">工程与素材保存在本机浏览器中,不会上传。</div>
      </div>
    </div>
  );
}
