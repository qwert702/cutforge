// 本地素材导入:探测时长/分辨率后登记为工程素材。
// 视频用 <video>、音频用 <audio>、图片用 <img> 探测元数据。

import { uid, type AssetKind, type MediaAsset } from '../core/types.ts';

function probe(kind: AssetKind, url: string): Promise<{ duration: number | null; width: number | null; height: number | null }> {
  if (kind === 'image') {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ duration: null, width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error('图片解码失败'));
      img.src = url;
    });
  }
  return new Promise((resolve, reject) => {
    const el = document.createElement(kind === 'video' ? 'video' : 'audio');
    el.preload = 'metadata';
    el.onloadedmetadata = () =>
      resolve({
        duration: Number.isFinite(el.duration) ? el.duration : null,
        width: kind === 'video' ? (el as HTMLVideoElement).videoWidth : null,
        height: kind === 'video' ? (el as HTMLVideoElement).videoHeight : null,
      });
    el.onerror = () => reject(new Error('媒体解码失败(格式可能不受支持)'));
    el.src = url;
  });
}

const KIND_BY_MIME: Record<string, AssetKind> = {
  'video/': 'video',
  'audio/': 'audio',
  'image/': 'image',
};

function kindOf(file: File): AssetKind | null {
  if (file.type) {
    const prefix = Object.keys(KIND_BY_MIME).find((p) => file.type.startsWith(p));
    if (prefix) return KIND_BY_MIME[prefix];
  }
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (['mp4', 'webm', 'mov', 'm4v', 'mkv'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'flac'].includes(ext)) return 'audio';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg'].includes(ext)) return 'image';
  return null;
}

export async function importFiles(files: readonly File[]): Promise<{ assets: MediaAsset[]; errors: string[] }> {
  const assets: MediaAsset[] = [];
  const errors: string[] = [];
  for (const file of files) {
    const kind = kindOf(file);
    if (!kind) {
      errors.push(`${file.name}:不支持的格式`);
      continue;
    }
    const url = URL.createObjectURL(file);
    try {
      const meta = await probe(kind, url);
      assets.push({
        id: uid('asset'),
        name: file.name,
        kind,
        url,
        durationSeconds: meta.duration,
        width: meta.width,
        height: meta.height,
      });
    } catch (error) {
      URL.revokeObjectURL(url);
      errors.push(`${file.name}:${error instanceof Error ? error.message : '探测失败'}`);
    }
  }
  return { assets, errors };
}
