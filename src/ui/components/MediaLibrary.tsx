// 素材库:本地文件导入 + 素材列表。单击素材把片段放到第一条兼容轨道的空闲位置。

import { useRef, useState } from 'react';
import type { Command } from '../../core/commands.ts';
import { findFreeStart } from '../../core/select.ts';
import { clipEnd, uid, type MediaAsset, type ProjectDoc, type TrackKind } from '../../core/types.ts';
import { loadDemoProject } from '../../media/demo.ts';
import { importFiles } from '../../media/import.ts';
import { editorStore, useProject } from '../hooks/useEditorStore.ts';
import { TemplatePicker } from './TemplatePicker.tsx';
import { VoiceoverModal } from './VoiceoverModal.tsx';
import { BeatSyncModal } from './BeatSyncModal.tsx';

export function MediaLibrary() {
  const doc = useProject();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showVoiceover, setShowVoiceover] = useState(false);
  const [showBeatSync, setShowBeatSync] = useState(false);

  const onPick = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const { assets, errors: probeErrors } = await importFiles([...files]);
      // 一次导入 = 一个撤销点
      editorStore.dispatchAll(assets.map((asset) => ({ type: 'asset.add', asset }) as Command), '导入素材');
      setErrors(probeErrors);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const onDemo = async () => {
    setBusy(true);
    const result = await loadDemoProject();
    setBusy(false);
    if (!result.ok && result.error) setErrors([result.error]);
  };

  return (
    <div className="media-library">
      <div className="panel-title">素材</div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="video/*,audio/*,image/*"
        hidden
        onChange={(e) => void onPick(e.target.files)}
      />
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? '导入中…' : '导入本地素材'}
      </button>
      <button type="button" className="btn" onClick={() => setShowBeatSync(true)} title="分析音乐节拍,自动按拍切分素材">
        🎵 音乐卡点
      </button>
      <button type="button" className="btn" onClick={() => setShowTemplates(true)} title="选一个故事板模板,自动排版成片">
        ✨ 一键成片
      </button>
      <button type="button" className="btn" onClick={() => setShowVoiceover(true)} title="录制麦克风配音并加入音频轨">
        🎙 录音配音
      </button>
      <button type="button" className="btn" disabled={busy} onClick={() => void onDemo()} title="在浏览器里现场生成两段示例视频并铺上时间线">
        {busy ? '生成中…' : '🎬 加载示例工程'}
      </button>
      <button type="button" className="btn" onClick={() => addTextToTimeline(doc)} title="在播放头位置添加一个文字标题">
        ＋ 添加文字
      </button>
      {showTemplates && <TemplatePicker onClose={() => setShowTemplates(false)} />}
      {showVoiceover && <VoiceoverModal onClose={() => setShowVoiceover(false)} />}
      {showBeatSync && <BeatSyncModal onClose={() => setShowBeatSync(false)} />}
      {errors.length > 0 && (
        <div className="media-errors">
          {errors.map((e) => (
            <div key={e} className="media-error">{e}</div>
          ))}
        </div>
      )}
      <div className="media-list">
        {doc.assets.map((asset) => (
          <button
            key={asset.id}
            type="button"
            className="media-item"
            title="点击添加到时间线"
            onClick={() => addAssetToTimeline(doc, asset)}
          >
            <span className={`media-kind media-kind-${asset.kind}`}>
              {asset.kind === 'video' ? '▶' : asset.kind === 'audio' ? '♪' : '▣'}
            </span>
            <span className="media-name">{asset.name}</span>
            <span className="media-dur">
              {asset.durationSeconds !== null ? `${asset.durationSeconds.toFixed(1)}s` : '图片'}
            </span>
          </button>
        ))}
        {doc.assets.length === 0 && <div className="media-empty">导入视频 / 音频 / 图片后,点击素材添加到时间线</div>}
      </div>
    </div>
  );
}

function firstCompatibleTrack(doc: ProjectDoc, kind: MediaAsset['kind']) {
  if (kind === 'audio') return doc.tracks.find((t) => t.kind === 'audio') ?? null;
  return doc.tracks.find((t) => t.kind === 'video') ?? null;
}

/** 在播放头(或时间线末尾)添加一个 3 秒文字片段;视频轨不存在时自动创建。 */
export function addTextToTimeline(doc: ProjectDoc, content = '点击选中后在此编辑文字'): void {
  const commands: Command[] = [];
  let track = doc.tracks.find((t) => t.kind === 'video');
  if (!track) {
    track = { id: uid('track'), kind: 'video', name: '视频 1' };
    commands.push({ type: 'track.add', track });
  }
  const { playhead } = editorStore.get();
  const timelineEnd = doc.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  const duration = 3;
  const start = findFreeStart(doc, track.id, duration, Math.min(playhead, timelineEnd) || 0);
  commands.push({
    type: 'clip.add',
    clip: {
      id: uid('clip'),
      trackId: track.id,
      assetId: '',
      start,
      duration,
      inPoint: 0,
      text: { content, size: 96, color: '#ffffff' },
    },
  });
  editorStore.dispatchAll(commands, '添加文字');
}

/** 把素材作为片段放到第一条兼容轨道的空闲位置(轨道不存在时自动创建)。 */
export function addAssetToTimeline(doc: ProjectDoc, asset: MediaAsset): void {
  const kind: TrackKind = asset.kind === 'audio' ? 'audio' : 'video';
  const commands: Command[] = [];
  let track = firstCompatibleTrack(doc, asset.kind);
  if (!track) {
    track = { id: uid('track'), kind, name: kind === 'audio' ? '音频 1' : '视频 1' };
    commands.push({ type: 'track.add', track });
  }
  const duration = asset.durationSeconds ?? 5;
  const timelineEnd = doc.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  const start = findFreeStart(doc, track.id, duration, timelineEnd);
  commands.push({
    type: 'clip.add',
    clip: { id: uid('clip'), trackId: track.id, assetId: asset.id, start, duration, inPoint: 0 },
  });
  editorStore.dispatchAll(commands, '添加素材');
}
