// 自动保存:编辑器任何变更后防抖 1.5s 写入本地工程库;
// 页面隐藏/关闭时冲刷;启动时恢复上次打开的工程。
import { editorStore } from '../ui/hooks/useEditorStore.ts';
import { emptyProject } from '../core/types.ts';
import { allMediaBlobs, replaceMediaBlobs, retainMediaBlobs } from './mediaRegistry.ts';
import { getLastOpened, libraryAvailable, loadProject, saveProject, setLastOpened } from './projectLibrary.ts';

const SAVE_DEBOUNCE_MS = 1500;

let timer: ReturnType<typeof setTimeout> | undefined;
let initialized = false;

export function initAutosave(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  void restoreLastProject();
  editorStore.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(() => void persistNow(), SAVE_DEBOUNCE_MS);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void persistNow();
  });
  window.addEventListener('pagehide', () => void persistNow());
}

/** 立即把当前工程写入本地库。返回是否实际写入。 */
export async function persistNow(): Promise<boolean> {
  if (!libraryAvailable()) return false;
  const doc = editorStore.get().history.present;
  retainMediaBlobs(new Set(doc.assets.map((a) => a.id)));
  const media = [...allMediaBlobs()].map(([assetId, blob]) => ({ assetId, blob }));
  try {
    await saveProject({ id: editorStore.projectId(), name: doc.name, doc, media });
    await setLastOpened(editorStore.projectId());
    return true;
  } catch {
    return false;
  }
}

async function restoreLastProject(): Promise<void> {
  if (!libraryAvailable()) {
    editorStore.newProject(emptyProject().name);
    return;
  }
  try {
    const current = editorStore.get().history.present;
    const pristine = current.clips.length === 0
      && current.assets.length === 0
      && current.name === emptyProject().name;
    // 打开期间用户(或示例工程)已经动过时间线,绝不能用库里的旧状态覆盖
    if (!pristine) return;
    const id = await getLastOpened();
    if (!id) return;
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
  } catch {
    // 恢复失败静默降级为空白工程
    editorStore.newProject();
  }
}
