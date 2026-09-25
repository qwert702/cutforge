// 音乐卡点:能量包络 → 起音(onset)峰值 → 卡点切分点。
// 纯函数(音频数据传入),可测;不依赖 DOM。

export interface BeatOptions {
  /** 峰值最小间隔(秒),默认 0.45 */
  readonly minGap?: number;
  /** 起音灵敏度 0-1,默认 0.5(越高要求突变越强) */
  readonly sensitivity?: number;
}

/** 计算 RMS 能量包络。 */
function energyEnvelope(channel: Float32Array, sampleRate: number, windowSeconds = 0.02): { rms: number[]; hop: number } {
  const window = Math.max(1, Math.floor(windowSeconds * sampleRate));
  const frames = Math.floor(channel.length / window);
  const rms: number[] = Array.from({ length: frames }, () => 0);
  for (let f = 0; f < frames; f += 1) {
    let sum = 0;
    const start = f * window;
    for (let i = start; i < start + window; i += 1) {
      sum += channel[i] * channel[i];
    }
    rms[f] = Math.sqrt(sum / window);
  }
  return { rms, hop: windowSeconds };
}

/** 从能量包络里挑起音峰值:局部极大 + 相对前窗均值突变。 */
function pickOnsets(rms: readonly number[], hop: number, options: BeatOptions = {}): number[] {
  const { minGap = 0.45, sensitivity = 0.5 } = options;
  const lookback = 8;
  const onsets: number[] = [];
  let lastTime = -Infinity;
  for (let i = lookback; i < rms.length - 1; i += 1) {
    const prev = rms.slice(i - lookback, i);
    const baseline = prev.reduce((a, b) => a + b, 0) / lookback;
    const threshold = baseline * (1 + 0.8 * (1 - sensitivity) + 0.4) ; // 突变系数 1.2~2.0
    if (
      rms[i] > threshold
      && rms[i] >= rms[i - 1]
      && rms[i] >= rms[i + 1]
      && i * hop - lastTime >= minGap
    ) {
      onsets.push(i * hop);
      lastTime = i * hop;
    }
  }
  return onsets;
}

/** 检测卡点切分点(秒):能量起音峰值。 */
export function detectBeatPoints(channel: Float32Array, sampleRate: number, options?: BeatOptions): number[] {
  const { rms, hop } = energyEnvelope(channel, sampleRate);
  return pickOnsets(rms, hop, options);
}

/** 把连续切分点按密度取样(每 N 个取一个,并保证片段最短时长)。 */
export function beatsToSegments(beats: readonly number[], density: number, minSegment = 0.5): number[] {
  const step = Math.max(1, Math.round(density));
  const picked: number[] = [];
  let last = -Infinity;
  for (let i = 0; i < beats.length; i += step) {
    const beat = beats[i];
    if (beat - last >= minSegment) {
      picked.push(beat);
      last = beat;
    }
  }
  return picked;
}

export interface BeatSegment {
  readonly start: number;
  readonly duration: number;
}

/** 相邻切分点组成片段区间(最后一段补到 totalDuration)。 */
export function segmentsFromBeatPoints(points: readonly number[], totalDuration: number): readonly BeatSegment[] {
  const segments: BeatSegment[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const start = points[i];
    const end = i + 1 < points.length ? points[i + 1] : totalDuration;
    if (end - start >= 0.2) segments.push({ start, duration: end - start });
  }
  return segments;
}
