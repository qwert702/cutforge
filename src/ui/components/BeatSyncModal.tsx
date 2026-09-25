// 音乐卡点弹窗:选一段音乐 → 检测节拍 → 视觉素材按卡点自动切分铺满。
import { useState } from 'react';
import type { Command } from '../../core/commands.ts';
import { uid } from '../../core/types.ts';
import { beatsToSegments, detectBeatPoints, segmentsFromBeatPoints } from '../../media/beats.ts';
import { editorStore, useProject } from '../hooks/useEditorStore.ts';

export function BeatSyncModal(props: { onClose: () => void }) {
  const doc = useProject();
  const [musicId, setMusicId] = useState(() => doc.assets.find((a) => a.kind === 'audio')?.id ?? '');
  const [density, setDensity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioAssets = doc.assets.filter((a) => a.kind === 'audio');
  const visualAssets = doc.assets.filter((a) => a.kind === 'video' || a.kind === 'image');

  const generate = async () => {
    const music = doc.assets.find((a) => a.id === musicId);
    if (!music) {
      setError('请选择一段音乐');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(music.url);
      const bytes = await response.arrayBuffer();
      const context = new AudioContext();
      let channel: Float32Array;
      let sampleRate: number;
      try {
        const buffer = await context.decodeAudioData(bytes);
        channel = buffer.getChannelData(0);
        sampleRate = buffer.sampleRate;
        void context.close();
      } catch {
        void context.close();
        throw new Error('音乐无法解码');
      }
      const beats = detectBeatPoints(channel, sampleRate, { minGap: 0.4 });
      if (beats.length < 2) {
        throw new Error('没有检测到明显的节拍,试试换一段节奏更强的音乐');
      }
      const musicDuration = music.durationSeconds ?? beats[beats.length - 1] + 1;
      const sampled = beatsToSegments(beats, density);
      const segments = segmentsFromBeatPoints(sampled, musicDuration);
      if (segments.length === 0) throw new Error('未能生成卡点片段');

      const commands: Command[] = [];
      const track = { id: uid('track'), kind: 'video' as const, name: '卡点画面' };
      commands.push({ type: 'track.add', track });
      segments.forEach((segment, index) => {
        const asset = visualAssets[index % visualAssets.length];
        const maxSource = asset.durationSeconds ?? Infinity;
        const duration = Math.min(segment.duration, maxSource);
        if (duration < 0.2) return;
        commands.push({
          type: 'clip.add',
          clip: { id: uid('clip'), trackId: track.id, assetId: asset.id, start: segment.start, duration, inPoint: 0 },
        });
      });
      const result = editorStore.dispatchAll(commands, '音乐卡点');
      if (!result.ok) {
        setError(result.error ?? '生成失败');
        return;
      }
      props.onClose();
      editorStore.notify(`已按 ${segments.length} 个卡点生成画面`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal">
        <div className="panel-title">
          🎵 音乐卡点
          <button type="button" className="btn btn-small" onClick={props.onClose}>关闭</button>
        </div>
        {audioAssets.length === 0 ? (
          <div className="export-warning">素材库里没有音频:先导入一段音乐。</div>
        ) : visualAssets.length === 0 ? (
          <div className="export-warning">没有视频/图片素材可供卡点排列,请先导入或加载示例。</div>
        ) : (
          <>
            <label className="inspector-row">
              选择音乐
              <select className="settings-input" value={musicId} onChange={(e) => setMusicId(e.target.value)}>
                <option value="">— 选择 —</option>
                {audioAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>{asset.name}</option>
                ))}
              </select>
            </label>
            <div className="inspector-row inspector-fadetype">
              节奏:
              <label><input type="radio" name="beat-density" checked={density === 1} onChange={() => setDensity(1)} />每个节拍</label>
              <label><input type="radio" name="beat-density" checked={density === 2} onChange={() => setDensity(2)} />每两拍</label>
            </div>
            <div className="settings-hint">
              将用 {visualAssets.length} 个视频/图片素材按节拍循环铺满音乐时长,生成后可继续手动微调。
            </div>
            <div className="proposal-actions">
              <button type="button" className="btn btn-primary" disabled={busy || !musicId} onClick={() => void generate()}>
                {busy ? '分析节拍中…' : '生成卡点画面'}
              </button>
            </div>
          </>
        )}
        {error && <div className="export-error">❌ {error}</div>}
      </div>
    </div>
  );
}
