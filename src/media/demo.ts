// 示例工程:用 WebCodecs 逐帧编码现场合成两段示例视频,
// 让首次访问者不导入任何文件就能体验时间线与 AI 剪辑。
// 不依赖 rAF / MediaRecorder / 页面可见性 —— 后台标签页同样可用。
// 生成的素材只存在于当前会话(blob: URL),随后被工程库持久化。

import { ArrayBufferTarget, Muxer } from 'webm-muxer';
import { applyCommand } from '../core/reducer.ts';
import { findFreeStart } from '../core/select.ts';
import { uid, type MediaAsset, type ProjectDoc } from '../core/types.ts';
import type { Command } from '../core/commands.ts';
import { registerMediaBlob } from '../persist/mediaRegistry.ts';
import { editorStore } from '../ui/hooks/useEditorStore.ts';

interface GeneratedClipSpec {
  readonly name: string;
  readonly seconds: number;
  readonly draw: (ctx: CanvasRenderingContext2D, t: number, w: number, h: number) => void;
}

const DEMO_SPECS: readonly GeneratedClipSpec[] = [
  {
    name: '示例 · 渐变波纹.mp4',
    seconds: 4,
    draw: (ctx, t, w, h) => {
      const hue = (t * 60) % 360;
      const gradient = ctx.createLinearGradient(0, 0, w, h);
      gradient.addColorStop(0, `hsl(${hue}, 70%, 45%)`);
      gradient.addColorStop(1, `hsl(${(hue + 120) % 360}, 70%, 30%)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 5; i += 1) {
        const phase = t * 2 + i * 0.7;
        const r = (Math.sin(phase) * 0.5 + 0.5) * Math.min(w, h) * 0.35 + 20;
        ctx.beginPath();
        ctx.arc(w * (0.2 + i * 0.15), h * 0.5 + Math.sin(phase * 1.3) * h * 0.2, r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,255,255,${0.28 - i * 0.04})`;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = `${Math.round(h / 12)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('CutForge 示例片段 A', w / 2, h / 2);
    },
  },
  {
    name: '示例 · 数字雨.mp4',
    seconds: 4,
    draw: (ctx, t, w, h) => {
      ctx.fillStyle = '#0b1016';
      ctx.fillRect(0, 0, w, h);
      ctx.font = `${Math.round(h / 16)}px monospace`;
      for (let col = 0; col < 18; col += 1) {
        const x = (col / 18) * w + 6;
        for (let row = 0; row < 14; row += 1) {
          const y = ((row + t * 8 + col * 0.3) % 14) * (h / 14) + h / 16;
          const brightness = Math.max(0, 1 - (row / 14));
          ctx.fillStyle = `rgba(120, 220, 160, ${brightness * 0.9})`;
          ctx.fillText(String(((col * 7 + row * 13 + Math.floor(t * 3)) % 10)), x, y);
        }
      }
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = `${Math.round(h / 12)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('CutForge 示例片段 B', w / 2, h / 2);
    },
  },
];

const DEMO_WIDTH = 960;
const DEMO_HEIGHT = 540;
const DEMO_FPS = 30;

function webCodecsAvailable(): boolean {
  return typeof window !== 'undefined' && 'VideoEncoder' in window && 'VideoFrame' in window;
}

/** 用 WebCodecs 把 canvas 动画逐帧编码为 WebM(WebM 无音频轨)。 */
async function renderClip(spec: GeneratedClipSpec): Promise<MediaAsset> {
  if (!webCodecsAvailable()) throw new Error('此浏览器不支持 WebCodecs,无法生成示例(请用新版 Chrome/Edge)');

  const canvas = document.createElement('canvas');
  canvas.width = DEMO_WIDTH;
  canvas.height = DEMO_HEIGHT;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('无法创建示例画布');

  // VP9 优先,老浏览器回退 VP8
  let codec: string | null = null;
  for (const candidate of ['vp09.00.10.08', 'vp8']) {
    const support = await VideoEncoder.isConfigSupported({
      codec: candidate, width: DEMO_WIDTH, height: DEMO_HEIGHT, bitrate: 2_500_000, framerate: DEMO_FPS,
    });
    if (support.supported) {
      codec = candidate;
      break;
    }
  }
  if (!codec) throw new Error('浏览器不支持 VP9/VP8 编码,无法生成示例');

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'V_VP9', width: DEMO_WIDTH, height: DEMO_HEIGHT, frameRate: DEMO_FPS },
  });

  let encodeError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      encodeError = error instanceof Error ? error : new Error(String(error));
    },
  });
  encoder.configure({ codec, width: DEMO_WIDTH, height: DEMO_HEIGHT, bitrate: 2_500_000, framerate: DEMO_FPS });

  const totalFrames = spec.seconds * DEMO_FPS;
  try {
    for (let frame = 0; frame < totalFrames; frame += 1) {
      if (encodeError) throw encodeError;
      spec.draw(ctx, frame / DEMO_FPS, DEMO_WIDTH, DEMO_HEIGHT);
      const videoFrame = new VideoFrame(canvas, {
        timestamp: Math.round((frame * 1e6) / DEMO_FPS),
        duration: Math.round(1e6 / DEMO_FPS),
      });
      encoder.encode(videoFrame, { keyFrame: frame % (DEMO_FPS * 2) === 0 });
      videoFrame.close();
      if (encoder.encodeQueueSize > 8) {
        // 用 dequeue 事件排空:后台标签页 setTimeout 被节流,不能用定时器等待
        await new Promise<void>((resolve) => {
          const onDequeue = () => {
            if (encoder.encodeQueueSize <= 4) {
              encoder.removeEventListener('dequeue', onDequeue);
              resolve();
            }
          };
          encoder.addEventListener('dequeue', onDequeue);
          onDequeue();
        });
      }
    }
    await encoder.flush();
  } finally {
    encoder.close();
  }
  muxer.finalize();

  const blob = new Blob([target.buffer], { type: 'video/webm' });
  const url = URL.createObjectURL(blob);
  const asset: MediaAsset = {
    id: uid('asset'),
    name: spec.name,
    kind: 'video',
    url,
    durationSeconds: spec.seconds,
    width: DEMO_WIDTH,
    height: DEMO_HEIGHT,
  };
  registerMediaBlob(asset.id, blob);
  return asset;
}

/** 生成示例素材并铺成两轨时间线;整批一个撤销点。 */
export async function loadDemoProject(): Promise<{ ok: boolean; error?: string }> {
  try {
    const assets: MediaAsset[] = [];
    for (const spec of DEMO_SPECS) {
      assets.push(await renderClip(spec));
    }
    let doc: ProjectDoc = editorStore.get().history.present;
    const trackA = { id: uid('track'), kind: 'video' as const, name: '视频 1' };
    const trackB = { id: uid('track'), kind: 'video' as const, name: '视频 2' };
    const setup: Command[] = [
      { type: 'track.add', track: trackA },
      { type: 'track.add', track: trackB },
      ...assets.map((asset) => ({ type: 'asset.add', asset }) as Command),
    ];
    doc = applyAll(doc, setup);

    // 片段几何:两段交替铺在两条轨上,最后轨道 1 接一段 2 秒复制体
    const newClips: Command[] = [];
    let cursor = 0;
    assets.forEach((asset, index) => {
      const track = index % 2 === 0 ? trackA : trackB;
      const duration = asset.durationSeconds ?? 4;
      const start = findFreeStart(doc, track.id, duration, cursor);
      const clip = { id: uid('clip'), trackId: track.id, assetId: asset.id, start, duration, inPoint: 0 };
      const result = applyCommand(doc, { type: 'clip.add', clip });
      if (result.ok) {
        doc = result.doc;
        newClips.push({ type: 'clip.add', clip });
      }
      cursor = start + duration;
    });
    const first = assets[0];
    if (first) {
      const duration = Math.min(2, first.durationSeconds ?? 2);
      const start = findFreeStart(doc, trackA.id, duration, doc.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0));
      const clip = { id: uid('clip'), trackId: trackA.id, assetId: first.id, start, duration, inPoint: 0 };
      const result = applyCommand(doc, { type: 'clip.add', clip });
      if (result.ok) newClips.push({ type: 'clip.add', clip });
    }
    // 建轨/素材/片段整体一个撤销点
    const dispatch = editorStore.dispatchAll([...setup, ...newClips], '加载示例工程');
    return dispatch.ok ? { ok: true } : { ok: false, error: dispatch.error };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function applyAll(doc: ProjectDoc, commands: readonly Command[]): ProjectDoc {
  let next = doc;
  for (const command of commands) {
    const result = applyCommand(next, command);
    if (result.ok) next = result.doc;
  }
  return next;
}
