// 工程文件(.cforge)导出/导入:zip 容器(project.json + media/<assetId>.<ext>)。
// 用于分享工程或跨设备续剪;素材 blob 打包进文件,不含任何外部引用。
import { strToU8, unzipSync, zipSync } from 'fflate';
import type { Command } from '../core/commands.ts';
import type { MediaAsset, ProjectDoc } from '../core/types.ts';
import { uid } from '../core/types.ts';

const SCHEMA = 1;
const EXTENSION = '.cforge';

interface ProjectJson {
  schema: number;
  doc: ProjectDoc;
}

export interface LoadedProjectFile {
  readonly doc: ProjectDoc;
  /** assetId → blob(调用方负责 createObjectURL 与注册) */
  readonly media: Map<string, Blob>;
}

export async function exportProjectFile(doc: ProjectDoc, blobs: ReadonlyMap<string, Blob>): Promise<Blob> {
  const mediaFiles: Record<string, Uint8Array> = {};
  for (const asset of doc.assets) {
    if (asset.kind === 'text') continue;
    const blob = blobs.get(asset.id);
    if (!blob) continue;
    mediaFiles[`${asset.id}.${extOf(asset)}`] = new Uint8Array(await blob.arrayBuffer());
  }
  const projectJson: ProjectJson = { schema: SCHEMA, doc };
  const zipped = zipSync({
    'project.json': strToU8(JSON.stringify(projectJson)),
    ...mediaFiles,
  });
  return new Blob([zipped.buffer as ArrayBuffer], { type: 'application/octet-stream' });
}

export function projectFileName(name: string): string {
  const safe = (name || '工程').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
  return `${safe}${EXTENSION}`;
}

/** 解析 .cforge 文件;损坏/版本不符时抛出可读错误。 */
export async function importProjectFile(file: File): Promise<LoadedProjectFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = await unzipSync(bytes);
  } catch {
    throw new Error('无法读取工程文件(可能已损坏或不是 .cforge 文件)');
  }
  const projectRaw = unzipped['project.json'];
  if (!projectRaw) throw new Error('工程文件缺少 project.json');
  let project: ProjectJson;
  try {
    project = JSON.parse(new TextDecoder().decode(projectRaw)) as ProjectJson;
  } catch {
    throw new Error('project.json 解析失败,文件可能已损坏');
  }
  if (project.schema !== SCHEMA || !project.doc || !Array.isArray(project.doc.assets)) {
    throw new Error(`不支持的工程文件版本(${(project as { schema?: number }).schema ?? '未知'})`);
  }
  const media = new Map<string, Blob>();
  for (const asset of project.doc.assets) {
    if (asset.kind === 'text') continue;
    const entry = Object.entries(unzipped).find(([key]) => key.startsWith(`${asset.id}.`));
    if (entry) media.set(asset.id, new Blob([entry[1].buffer as ArrayBuffer]));
  }
  return { doc: project.doc, media };
}

/** 导入命令:asset.add 全量(媒体 url 由调用方在导入时重建)。 */
export function assetAddCommands(doc: ProjectDoc): Command[] {
  return doc.assets.map((asset) => ({ type: 'asset.add', asset }) as Command);
}

function extOf(asset: MediaAsset): string {
  const fromName = asset.name.includes('.') ? asset.name.split('.').pop() : undefined;
  if (fromName && /^[a-z0-9]{1,5}$/i.test(fromName)) return fromName.toLowerCase();
  return asset.kind === 'audio' ? 'webm' : 'bin';
}

// uid 重导出避免调用方额外导入(新工程 id 生成)
export { uid as newProjectId };
