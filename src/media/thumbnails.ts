// 视频缩略图:对视频素材在指定源时间点截帧(JPEG dataURL),按 assetId+时间缓存。
import type { MediaAsset } from '../core/types.ts';
import { seekElement } from '../render/compositor.ts';

const cache = new Map<string, string>();
const THUMB_WIDTH = 160;

/** 截取素材在 sourceTime 的缩略图;失败返回 null(如格式无法解码)。 */
export async function getThumbnail(asset: MediaAsset, sourceTime: number): Promise<string | null> {
  if (asset.kind !== 'video' || !asset.url || asset.width === 0) return null;
  const key = `${asset.id}|${sourceTime.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const video = document.createElement('video');
  video.src = asset.url;
  video.preload = 'auto';
  video.muted = true;
  try {
    await waitReady(video);
    await seekElement(video, Math.max(0, sourceTime));
    if (video.videoWidth === 0) return null;
    const height = Math.max(24, Math.round((THUMB_WIDTH * video.videoHeight) / video.videoWidth));
    const canvas = document.createElement('canvas');
    canvas.width = THUMB_WIDTH;
    canvas.height = height;
    canvas.getContext('2d')?.drawImage(video, 0, 0, THUMB_WIDTH, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.55);
    cache.set(key, dataUrl);
    return dataUrl;
  } catch {
    return null;
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

function waitReady(el: HTMLVideoElement): Promise<void> {
  if (el.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => {
      el.removeEventListener('loadeddata', done);
      el.removeEventListener('error', fail);
      resolve();
    };
    const fail = () => {
      el.removeEventListener('loadeddata', done);
      el.removeEventListener('error', fail);
      reject(new Error('video decode failed'));
    };
    el.addEventListener('loadeddata', done);
    el.addEventListener('error', fail);
  });
}
