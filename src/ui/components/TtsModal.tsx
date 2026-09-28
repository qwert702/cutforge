// AI 配音弹窗:文本 → 服务商 TTS → 音频轨(播放头处)。
import { useEffect, useRef, useState } from 'react';
import { synthesizeSpeech, TTS_VOICES, type TtsVoice } from '../../media/tts.ts';
import { loadActiveLlmConfig } from '../../agent/providers.ts';
import { placeAudioAtPlayhead } from '../../media/placeAudio.ts';
import { editorStore, useEditor, useProject } from '../hooks/useEditorStore.ts';

export function TtsModal(props: { onClose: () => void }) {
  const doc = useProject();
  const playhead = useEditor().playhead;
  const playheadRef = useRef(playhead);
  playheadRef.current = playhead;
  const [text, setText] = useState('');
  const [voice, setVoice] = useState<TtsVoice>('alloy');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasProvider = loadActiveLlmConfig() !== null;

  useEffect(() => () => abortRef.current?.abort(), []);
  const abortRef = useRef<AbortController | null>(null);

  const generate = async () => {
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const asset = await synthesizeSpeech({ input: text, voice, signal: controller.signal });
      placeAudioAtPlayhead(doc, asset, playheadRef.current);
      props.onClose();
      editorStore.notify(`AI 配音已添加(${asset.durationSeconds?.toFixed(1)}s)`);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        props.onClose();
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && props.onClose()}>
      <div className="modal">
        <div className="panel-title">
          🔊 AI 配音(文字转语音)
          <button type="button" className="btn btn-small" onClick={props.onClose} disabled={busy}>关闭</button>
        </div>
        {!hasProvider && (
          <div className="export-warning">
            尚未配置模型服务:请先到工具栏 ⚙ 设置中心添加一个支持语音合成的服务商(如 OpenAI)。
          </div>
        )}
        <label className="inspector-row">
          朗读文本(将发送给你配置的服务商)
          <textarea
            className="inspector-textarea"
            rows={4}
            value={text}
            placeholder="输入要转成语音的文字…"
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <label className="inspector-row">
          声音
          <select className="settings-input" value={voice} onChange={(e) => setVoice(e.target.value as TtsVoice)} disabled={busy}>
            {TTS_VOICES.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </label>
        {busy && (
          <div className="export-progress-label">正在合成语音…</div>
        )}
        {error && <div className="export-error">❌ {error}</div>}
        <div className="proposal-actions">
          {busy ? (
            <button type="button" className="btn" onClick={() => abortRef.current?.abort()}>取消</button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={!text.trim()} onClick={() => void generate()}>
              生成并添加到音频轨
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
