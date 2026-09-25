// 音乐卡点切分的回归测试:合成已知节奏的音频,验证切分点落在鼓点上。
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { beatsToSegments, detectBeatPoints, segmentsFromBeatPoints } from './beats.ts';

const SAMPLE_RATE = 48_000;

/** 合成测试音频:每隔 interval 秒一个短促"鼓点"(150Hz 衰减正弦),其余为静音底噪。 */
function synthBeatAudio(interval: number, totalSeconds: number): Float32Array {
  const length = Math.floor(totalSeconds * SAMPLE_RATE);
  const channel = new Float32Array(length);
  for (let i = 0; i < length; i += 1) channel[i] = (Math.random() - 0.5) * 0.004; // 底噪
  const beatSamples = Math.floor(0.12 * SAMPLE_RATE);
  for (let beat = 0; beat * interval < totalSeconds; beat += 1) {
    const start = Math.floor(beat * interval * SAMPLE_RATE);
    for (let i = 0; i < beatSamples && start + i < length; i += 1) {
      const envelope = Math.exp(-i / (SAMPLE_RATE * 0.03));
      channel[start + i] += Math.sin((2 * Math.PI * 150 * i) / SAMPLE_RATE) * 0.8 * envelope;
    }
  }
  return channel;
}

describe('音乐卡点检测', () => {
  it('每 1 秒一个鼓点的音频,切分点应接近整秒', () => {
    const audio = synthBeatAudio(1, 8);
    const points = detectBeatPoints(audio, SAMPLE_RATE);
    assert.ok(points.length >= 5, `至少检出 5 个点,实际 ${points.length}`);
    for (const point of points) {
      const nearestSecond = Math.round(point);
      assert.ok(Math.abs(point - nearestSecond) < 0.12, `切分点 ${point} 应贴近整秒`);
    }
  });

  it('密度取样:每 2 个取 1 个且保证最短片段', () => {
    const audio = synthBeatAudio(0.5, 6);
    const points = detectBeatPoints(audio, SAMPLE_RATE);
    const sampled = beatsToSegments(points, 2);
    for (let i = 1; i < sampled.length; i += 1) {
      assert.ok(sampled[i] - sampled[i - 1] >= 0.5);
    }
  });

  it('片段区间:最后一段补齐到总时长', () => {
    const segments = segmentsFromBeatPoints([0, 1.2, 2.4], 4);
    assert.equal(segments.length, 3);
    assert.equal(segments[2].start, 2.4);
    assert.equal(segments[2].duration, 1.6);
  });

  it('静音音频不产生切分点(无假阳性)', () => {
    const silence = new Float32Array(SAMPLE_RATE * 5);
    assert.deepEqual(detectBeatPoints(silence, SAMPLE_RATE), []);
  });
});
