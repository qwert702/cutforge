// 麦克风录音配音:录制为音频素材,自动入音频轨(播放头处)。
import { uid, type MediaAsset } from '../core/types.ts';
import { registerMediaBlob } from '../persist/mediaRegistry.ts';

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

function pickMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return MIME_CANDIDATES.find((mime) => MediaRecorder.isTypeSupported(mime)) ?? null;
}

export function voiceoverSupported(): boolean {
  return typeof navigator !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia
    && pickMime() !== null;
}

export class VoiceoverRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;

  async start(): Promise<void> {
    const mime = pickMime();
    if (!mime) throw new Error('此浏览器不支持录音');
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream, { mimeType: mime });
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.start(200);
  }

  /** 停止录音并产出音频素材(已注册 blob;时长通过元数据探测)。 */
  async stop(): Promise<MediaAsset> {
    const recorder = this.recorder;
    if (!recorder) throw new Error('没有进行中的录音');
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.stop();
    await stopped;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.recorder = null;

    const blob = new Blob(this.chunks, { type: recorder.mimeType });
    const url = URL.createObjectURL(blob);
    const duration = await probeDuration(url);
    const asset: MediaAsset = {
      id: uid('asset'),
      name: `配音 ${new Date().toLocaleTimeString()}`,
      kind: 'audio',
      url,
      durationSeconds: duration,
      width: null,
      height: null,
    };
    registerMediaBlob(asset.id, blob);
    return asset;
  }
}

function probeDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement('audio');
    el.preload = 'metadata';
    el.onloadedmetadata = () => resolve(Number.isFinite(el.duration) ? el.duration : 1);
    el.onerror = () => resolve(1);
    el.src = url;
  });
}
