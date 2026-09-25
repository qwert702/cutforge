// 本地工程库:IndexedDB 持久化工程文档与素材二进制。
// 库名 cutforge,schema v1:
//   projects(store,keyPath=id): { id, name, doc, media: [{assetId, blob}], savedAt, schema }
//   meta(store,keyPath=key):    { key:'lastOpened', value: projectId }
// 单条共享连接;所有 API 独立于 UI,可在无 window 环境安全探测。

import type { ProjectDoc } from '../core/types.ts';

const DB_NAME = 'cutforge';
const DB_VERSION = 1;
const PROJECTS = 'projects';
const META = 'meta';
const SCHEMA = 1;

export interface ProjectRecord {
  readonly id: string;
  readonly name: string;
  readonly doc: ProjectDoc;
  /** 恢复时据此重建 blob: URL */
  readonly media: readonly { assetId: string; blob: Blob }[];
  readonly savedAt: number;
  readonly schema: number;
}

export interface ProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly savedAt: number;
}

export function libraryAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

let dbPromise: Promise<IDBDatabase> | undefined;
function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = undefined; };
      db.onclose = () => { dbPromise = undefined; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveProject(record: Omit<ProjectRecord, 'schema' | 'savedAt'>): Promise<void> {
  if (!libraryAvailable()) return;
  const db = await openDb();
  const tx = db.transaction(PROJECTS, 'readwrite');
  tx.objectStore(PROJECTS).put({ ...record, schema: SCHEMA, savedAt: Date.now() });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listProjects(): Promise<ProjectSummary[]> {
  if (!libraryAvailable()) return [];
  const db = await openDb();
  const all = await requestAsPromise(
    db.transaction(PROJECTS, 'readonly').objectStore(PROJECTS).getAll() as IDBRequest<ProjectRecord[]>,
  );
  return all
    .map((r) => ({ id: r.id, name: r.name, savedAt: r.savedAt }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

export async function loadProject(id: string): Promise<ProjectRecord | null> {
  if (!libraryAvailable()) return null;
  const db = await openDb();
  const record = await requestAsPromise(
    db.transaction(PROJECTS, 'readonly').objectStore(PROJECTS).get(id) as IDBRequest<ProjectRecord | undefined>,
  );
  return record ?? null;
}

export async function deleteProject(id: string): Promise<void> {
  if (!libraryAvailable()) return;
  const db = await openDb();
  const tx = db.transaction(PROJECTS, 'readwrite');
  tx.objectStore(PROJECTS).delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  if ((await getLastOpened()) === id) await setLastOpened(null);
}

export async function setLastOpened(id: string | null): Promise<void> {
  if (!libraryAvailable()) return;
  const db = await openDb();
  const tx = db.transaction(META, 'readwrite');
  if (id === null) tx.objectStore(META).delete('lastOpened');
  else tx.objectStore(META).put({ key: 'lastOpened', value: id });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getLastOpened(): Promise<string | null> {
  if (!libraryAvailable()) return null;
  try {
    const db = await openDb();
    const record = await requestAsPromise(
      db.transaction(META, 'readonly').objectStore(META).get('lastOpened') as IDBRequest<{ value: string } | undefined>,
    );
    return record?.value ?? null;
  } catch {
    return null;
  }
}
