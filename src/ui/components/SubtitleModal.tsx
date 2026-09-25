// 字幕识别弹窗:选视频/音频素材 → 本地识别 → 字幕轨自动生成(整批一个撤销点)。
import { useEffect, useRef, useState } from 'react';
import type { Command } from '../../core/commands.ts';
import { uid, type MediaAsset, type ProjectDoc } from '../../core/types.ts';
import { transcribeAsset, MODEL_INFO, type AsrProgress, type SubtitleSegment } from '../../asr/subtitles.ts';
import { editorStore, useProject } from '../hooks/useEditorStore.ts';

void MODEL_INFO;

const LANGUAGES: readonly { value: string; label: string }[] = [
  { value: 'auto', label: '自动检测' },
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
];

export function SubtitleModal(props: { onClose: () => void }) {
  const doc = useProject();
  const mediaAssets = doc.assets.filter((a) => a.kind === 'video' || a.kind === 'audio');
  // 默认优先选音频素材(视频可能没有音轨)
  const [assetId, setAssetId] = useState(() => (doc.assets.find((a) => a.kind === 'audio') ?? mediaAssets[0])?.id ?? '');
  const [language, setLanguage] = useState('auto');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<AsrProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [segments, setSegments] = useState<SubtitleSegment[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const asset = doc.assets.find((a) => a.id === assetId);

  const start = async () => {
    if (!asset) return;
    setBusy(true);
    setError(null);
    setSegments(null);
    setProgress({ stage: 'model', ratio: 0, detail: '准备模型…' });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await transcribeAsset(asset, {
        language,
        signal: controller.signal,
        onProgress: setProgress,
      });
      if (result.length === 0) {
        setError('没有识别到语音内容。');
        return;
      }
      setSegments(result);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        props.onClose();
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const apply = () => {
    if (!segments || !asset) return;
    const commands = subtitleCommands(doc, asset, segments);
    const result = editorStore.dispatchAll(commands, '生成字幕');
    if (result.ok) {
      props.onClose();
      editorStore.notify(`已生成 ${segments.length} 条字幕,Ctrl+Z 可撤销`);
    } else {
      setError(result.error ?? '生成字幕失败');
    }
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && props.onClose()}>
      <div className="modal">
        <div className="panel-title">
          💬 字幕识别
          <button type="button" className="btn btn-small" onClick={props.onClose} disabled={busy}>关闭</button>
        </div>
        <div className="settings-hint">
          语音在<b>本机浏览器内</b>识别(Whisper 模型经 hf-mirror 下载一次后缓存,音频不上传任何服务器)。
        </div>
        <label className="inspector-row">
          素材
          <select className="settings-input" value={assetId} onChange={(e) => setAssetId(e.target.value)} disabled={busy}>
            {mediaAssets.map((a) => (
              <option key={a.id} value={a.id}>{a.name}{a.durationSeconds ? ` (${a.durationSeconds.toFixed(1)}s)` : ''}</option>
            ))}
          </select>
        </label>
        <label className="inspector-row">
          语言
          <select className="settings-input" value={language} onChange={(e) => setLanguage(e.target.value)} disabled={busy}>
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </label>
        {progress && (
          <div className="export-progress">
            <div className="export-progress-label">{progress.detail ?? '处理中…'}</div>
            <div className="export-progress-bar">
              <div className="export-progress-fill" style={{ width: `${progress.ratio * 100}%` }} />
            </div>
          </div>
        )}
        {segments && (
          <div className="subtitle-preview">
            {segments.slice(0, 6).map((seg, i) => (
              <div key={i} className="subtitle-preview-row">
                <span className="subtitle-preview-time">{seg.start.toFixed(1)}s</span>
                <span>{seg.text}</span>
              </div>
            ))}
            {segments.length > 6 && <div className="subtitle-preview-row">…共 {segments.length} 条</div>}
          </div>
        )}
        {error && <div className="export-error">❌ {error}</div>}
        <div className="proposal-actions">
          {!segments && !busy && (
            <button type="button" className="btn btn-primary" disabled={!asset} onClick={() => void start()}>
              开始识别
            </button>
          )}
          {busy && (
            <button type="button" className="btn" onClick={() => abortRef.current?.abort()}>取消</button>
          )}
          {segments && (
            <button type="button" className="btn btn-primary" onClick={apply}>
              ✓ 生成字幕轨({segments.length} 条)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 字幕片段 → 命令:独立"字幕"轨,每条一个文字片段(画布底部居中)。
 *  时间基准:源素材若已作为片段铺在时间线上,以其片段起点为偏移。 */
export function subtitleCommands(doc: ProjectDoc, asset: MediaAsset, segments: SubtitleSegment[]): Command[] {
  const commands: Command[] = [];
  const existing = doc.tracks.find((t) => t.name === '字幕');
  const track = existing ?? { id: uid('track'), kind: 'video' as const, name: '字幕' };
  if (!existing) commands.push({ type: 'track.add', track });
  const hostClip = doc.clips.find((c) => c.assetId === asset.id);
  const baseTime = hostClip ? hostClip.start : 0;
  for (const segment of segments) {
    const duration = Math.max(0.8, segment.end - segment.start);
    commands.push({
      type: 'clip.add',
      clip: {
        id: uid('clip'),
        trackId: track.id,
        assetId: '',
        start: baseTime + segment.start,
        duration,
        inPoint: 0,
        text: { content: segment.text, size: 48, color: '#ffffff', y: 0.88 },
      },
    });
  }
  return commands;
}
