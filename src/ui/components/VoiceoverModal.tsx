// 录音配音弹窗:开始/停止,完成后自动入音频轨(播放头处,轨道不存在则创建)。
import { useEffect, useRef, useState } from 'react';
import type { Command } from '../../core/commands.ts';
import { findFreeStart } from '../../core/select.ts';
import { uid, type MediaAsset, type ProjectDoc, type TrackKind } from '../../core/types.ts';
import { VoiceoverRecorder, voiceoverSupported } from '../../media/voiceover.ts';
import { editorStore, useEditor, useProject } from '../hooks/useEditorStore.ts';

export function VoiceoverModal(props: { onClose: () => void }) {
  const doc = useProject();
  const playhead = useEditor().playhead;
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<VoiceoverRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playheadRef = useRef(playhead);
  playheadRef.current = playhead;

  useEffect(() => () => {
    if (recorderRef.current) void recorderRef.current.stop().catch(() => undefined);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  if (!voiceoverSupported()) {
    return (
      <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
        <div className="modal">
          <div className="panel-title">🎙 录音配音</div>
          <div className="export-warning">此浏览器不支持录音,请使用新版 Chrome/Edge 并允许麦克风权限。</div>
        </div>
      </div>
    );
  }

  const start = async () => {
    setError(null);
    try {
      const recorder = new VoiceoverRecorder();
      await recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((v) => v + 1), 1000);
    } catch (err) {
      setError(err instanceof Error ? `无法访问麦克风:${err.message}` : String(err));
    }
  };

  const stopAndAdd = async () => {
    if (!recorderRef.current) return;
    if (timerRef.current) clearInterval(timerRef.current);
    try {
      const asset: MediaAsset = await recorderRef.current.stop();
      recorderRef.current = null;
      setRecording(false);
      addToTimeline(doc, asset, playheadRef.current);
      props.onClose();
      editorStore.notify('配音已添加到音频轨');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRecording(false);
    }
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !recording && props.onClose()}>
      <div className="modal">
        <div className="panel-title">🎙 录音配音</div>
        <div className="voiceover-status">
          {recording ? (
            <span className="voiceover-recording">● 录音中 {formatSeconds(elapsed)}</span>
          ) : (
            <span className="settings-hint">点「开始录音」后对着麦克风说话,停止后自动添加到音频轨播放头位置。</span>
          )}
        </div>
        {error && <div className="export-error">❌ {error}</div>}
        <div className="proposal-actions">
          {!recording && <button type="button" className="btn btn-primary" onClick={() => void start()}>开始录音</button>}
          {recording && <button type="button" className="btn" onClick={() => void stopAndAdd()}>停止并添加到时间线</button>}
          {!recording && <button type="button" className="btn btn-small" onClick={props.onClose}>取消</button>}
        </div>
      </div>
    </div>
  );
}

function addToTimeline(doc: ProjectDoc, asset: MediaAsset, playhead: number): void {
  const kind: TrackKind = 'audio';
  const commands: Command[] = [];
  let track = doc.tracks.find((t) => t.kind === kind);
  if (!track) {
    track = { id: uid('track'), kind, name: '配音' };
    commands.push({ type: 'track.add', track });
  }
  const duration = asset.durationSeconds ?? 1;
  const start = findFreeStart(doc, track.id, duration, Math.max(0, playhead));
  commands.push({
    type: 'clip.add',
    clip: { id: uid('clip'), trackId: track.id, assetId: asset.id, start, duration, inPoint: 0 },
  });
  editorStore.dispatchAll(commands, '添加配音');
}

function formatSeconds(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
