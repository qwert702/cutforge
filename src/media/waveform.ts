// 音频波形:解码音频 → 分桶峰值缓存 → 组件按片段源窗口切片绘制。
import type { MediaAsset } from '../core/types.ts';

const PEAKS_PER_SECOND = 40;
const peaksCache = new Map<string, Promise<number[] | null>>();

/** 计算素材的峰值数组(音量归一);失败返回 null。 */
export function getPeaks(asset: MediaAsset): Promise<number[] | null> {
  const hit = peaksCache.get(asset.id);
  if (hit) return hit;
  const task = (async () => {
    if (asset.kind !== 'audio' && asset.kind !== 'video') return null;
    try {
      const response = await fetch(asset.url);
      const bytes = await response.arrayBuffer();
      const context = new AudioContext({ sampleRate: 8000 });
      try {
        const buffer = await context.decodeAudioData(bytes);
        const channel = buffer.getChannelData(0);
        const buckets = Math.max(1, Math.ceil(buffer.duration * PEAKS_PER_SECOND));
        const size = Math.floor(channel.length / buckets);
        const peaks: number[] = Array.from({ length: buckets }, () => 0);
        for (let b = 0; b < buckets; b += 1) {
          let peak = 0;
          const start = b * size;
          for (let i = start; i < start + size && i < channel.length; i += 1) {
            const value = Math.abs(channel[i]);
            if (value > peak) peak = value;
          }
          peaks[b] = peak;
        }
        // 归一化到 0-1
        const max = Math.max(...peaks, 0.0001);
        return peaks.map((p) => p / max);
      } finally {
        void context.close();
      }
    } catch {
      return null;
    }
  })();
  peaksCache.set(asset.id, task);
  return task;
}

/** 绘制波形切片到画布:srcStart/srcEnd 为秒(源时间)。 */
export function drawPeaks(
  canvas: HTMLCanvasElement,
  peaks: readonly number[],
  srcStart: number,
  srcEnd: number,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  const startBucket = Math.floor(srcStart * PEAKS_PER_SECOND);
  const endBucket = Math.max(startBucket + 1, Math.ceil(srcEnd * PEAKS_PER_SECOND));
  const span = endBucket - startBucket;
  const barWidth = Math.max(1, Math.floor(width / Math.min(span, width)));
  for (let x = 0; x < width; x += barWidth + 1) {
    const bucket = startBucket + Math.floor((x / width) * span);
    const peak = peaks[Math.max(0, Math.min(peaks.length - 1, bucket))] ?? 0;
    const barHeight = Math.max(1, peak * height * 0.92);
    ctx.fillRect(x, (height - barHeight) / 2, barWidth, barHeight);
  }
}
