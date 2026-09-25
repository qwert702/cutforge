// 片段内的视觉元素:视频缩略图条 / 音频波形。
import { useEffect, useRef, useState } from 'react';
import type { MediaAsset } from '../../core/types.ts';
import { getThumbnail } from '../../media/thumbnails.ts';
import { drawPeaks, getPeaks } from '../../media/waveform.ts';

/** 视频片段缩略图条:按源窗口均匀取 5 帧。 */
export function ClipThumbs(props: { asset: MediaAsset; srcStart: number; srcSpan: number }) {
  const { asset, srcStart, srcSpan } = props;
  const [thumbs, setThumbs] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const count = 5;
      const urls: string[] = [];
      for (let i = 0; i < count; i += 1) {
        const time = srcStart + ((i + 0.5) / count) * srcSpan;
        const url = await getThumbnail(asset, time);
        if (cancelled) return;
        if (url) urls.push(url);
      }
      if (urls.length > 0) setThumbs(urls);
    })();
    return () => {
      cancelled = true;
    };
  }, [asset.id, srcStart, srcSpan]);
  if (thumbs.length === 0) return null;
  return (
    <div className="clip-thumbs">
      {thumbs.map((url, i) => (
        <img key={i} src={url} alt="" draggable={false} />
      ))}
    </div>
  );
}

/** 音频波形(含视频轨音轨的简化显示)。 */
export function ClipWaveform(props: { asset: MediaAsset; srcStart: number; srcSpan: number }) {
  const { asset, srcStart, srcSpan } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<readonly number[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getPeaks(asset).then((result) => {
      if (!cancelled) setPeaks(result);
    });
    return () => {
      cancelled = true;
    };
  }, [asset.id]);
  useEffect(() => {
    if (!peaks || !canvasRef.current) return;
    drawPeaks(canvasRef.current, peaks, srcStart, srcStart + srcSpan);
  }, [peaks, srcStart, srcSpan]);
  if (peaks === null) return null;
  return <canvas ref={canvasRef} className="clip-waveform" width={600} height={36} />;
}
