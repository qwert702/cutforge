// 内置合成音效:WebAudio 离线程序生成,零素材文件、零版权风险。
// 每个音效 = 采样率 48k 的单声道 Float32 → WAV 编码 → 音频素材。

export interface SfxPreset {
  readonly id: string;
  readonly label: string;
  readonly emoji: string;
  readonly durationSeconds: number;
  /** 在 [0, duration] 上填充波形;值域约 -1..1 */
  readonly render: (data: Float32Array, sampleRate: number) => void;
}

const TWO_PI = Math.PI * 2;

export const SFX_PRESETS: readonly SfxPreset[] = [
  {
    id: 'whoosh',
    label: '呼啸',
    emoji: '🌪',
    durationSeconds: 0.7,
    render: (data) => {
      // 带通噪声 + 幅度拱形
      let last = 0;
      for (let i = 0; i < data.length; i += 1) {
        const t = i / data.length;
        const envelope = Math.sin(Math.PI * t) ** 2;
        const noise = Math.random() * 2 - 1;
        last = last * 0.82 + noise * 0.18; // 简易低通让噪声变"风"
        data[i] = last * envelope * 1.6;
      }
    },
  },
  {
    id: 'pop',
    label: '弹跳',
    emoji: '🫧',
    durationSeconds: 0.25,
    render: (data, sr) => {
      for (let i = 0; i < data.length; i += 1) {
        const t = i / data.length;
        const freq = 600 - 420 * t;
        const envelope = Math.exp(-t * 9);
        data[i] = Math.sin(TWO_PI * freq * (i / sr)) * envelope * 0.8;
      }
    },
  },
  {
    id: 'boom',
    label: '低爆',
    emoji: '💥',
    durationSeconds: 0.9,
    render: (data, sr) => {
      for (let i = 0; i < data.length; i += 1) {
        const t = i / sr;
        const envelope = Math.exp(-t * 6);
        const thump = Math.sin(TWO_PI * (85 - 40 * (t / 0.9)) * t) * 0.9;
        const noise = (Math.random() * 2 - 1) * Math.exp(-t * 30) * 0.4;
        data[i] = (thump + noise) * envelope;
      }
    },
  },
  {
    id: 'click',
    label: '咔嗒',
    emoji: '🖱',
    durationSeconds: 0.12,
    render: (data, sr) => {
      for (let i = 0; i < data.length; i += 1) {
        const t = i / data.length;
        const envelope = Math.exp(-t * 45);
        data[i] = Math.sin(TWO_PI * 2000 * (i / sr)) * envelope * 0.7;
      }
    },
  },
  {
    id: 'chime',
    label: '风铃',
    emoji: '🔔',
    durationSeconds: 1.4,
    render: (data, sr) => {
      for (let i = 0; i < data.length; i += 1) {
        const t = i / sr;
        const envelope = Math.exp(-t * 3.2);
        data[i] =
          (Math.sin(TWO_PI * 880 * t) * 0.5 + Math.sin(TWO_PI * 1318.5 * t) * 0.3 + Math.sin(TWO_PI * 1760 * t) * 0.2) * envelope * 0.7;
      }
    },
  },
  {
    id: 'riser',
    label: '上升',
    emoji: '📈',
    durationSeconds: 1.2,
    render: (data, sr) => {
      let phase = 0;
      for (let i = 0; i < data.length; i += 1) {
        const t = i / data.length;
        const freq = 200 + 900 * t * t;
        phase += (TWO_PI * freq) / sr;
        const envelope = t < 0.85 ? t / 0.85 : (1 - t) / 0.15;
        data[i] = Math.sin(phase) * envelope * 0.6;
      }
    },
  },
];

export function sfxById(id: string): SfxPreset | undefined {
  return SFX_PRESETS.find((p) => p.id === id);
}

/** 离线渲染音效为 16bit PCM WAV blob。 */
export async function renderSfxToWav(preset: SfxPreset, sampleRate = 48_000): Promise<Blob> {
  const length = Math.ceil(preset.durationSeconds * sampleRate);
  const data = new Float32Array(length);
  preset.render(data, sampleRate);
  return wavBlob(data, sampleRate);
}

/** 16bit PCM WAV 编码(单声道)。 */
export function wavBlob(samples: Float32Array, sampleRate: number): Blob {
  const dataLength = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);
  const writeStr = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataLength, true);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.min(1, Math.max(-1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
