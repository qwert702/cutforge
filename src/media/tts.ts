// AI 配音(文字转语音):用设置中心当前服务商的 OpenAI 兼容 /audio/speech 端点。
// 音频在浏览器内拿到 blob 后走本地素材管线(注册 → 音频轨),文本内容会发送给你选择的服务商。
import { uid, type MediaAsset } from '../core/types.ts';
import { registerMediaBlob } from '../persist/mediaRegistry.ts';
import { getActiveProvider } from '../agent/providers.ts';

export const TTS_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const;
export type TtsVoice = (typeof TTS_VOICES)[number];

export interface TtsOptions {
  readonly input: string;
  readonly voice?: TtsVoice;
  /** 覆盖服务商模型名(默认 tts-1) */
  readonly model?: string;
  readonly signal?: AbortSignal;
}

export class TtsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TtsError';
  }
}

/** 合成语音并注册为素材;无可用服务商时抛 TtsError。 */
export async function synthesizeSpeech(options: TtsOptions): Promise<MediaAsset> {
  const provider = getActiveProvider();
  if (!provider) throw new TtsError('尚未配置模型服务:请到设置中心添加并填入 API Key');
  const input = options.input.trim();
  if (!input) throw new TtsError('请输入要朗读的文本');

  const response = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
    signal: options.signal,
    body: JSON.stringify({
      model: options.model ?? 'tts-1',
      input,
      voice: options.voice ?? 'alloy',
      response_format: 'mp3',
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (response.status === 404) {
      throw new TtsError(`当前服务商(${provider.label})未提供 /audio/speech 语音端点,请换用 OpenAI 或支持 TTS 的服务`);
    }
    throw new TtsError(`语音合成失败 (HTTP ${response.status}):${text.slice(0, 160)}`);
  }
  const blob = await response.blob();
  if (blob.size < 100) throw new TtsError('服务商返回了空音频,请稍后重试');

  const url = URL.createObjectURL(blob);
  const duration = await probeDuration(url);
  const asset: MediaAsset = {
    id: uid('asset'),
    name: `AI 配音:${input.slice(0, 18)}${input.length > 18 ? '…' : ''}`,
    kind: 'audio',
    url,
    durationSeconds: duration,
    width: null,
    height: null,
  };
  registerMediaBlob(asset.id, blob);
  return asset;
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
