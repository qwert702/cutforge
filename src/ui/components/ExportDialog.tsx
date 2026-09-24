// 导出对话框:WebM / MP4 客户端导出,带进度与取消。

import { useEffect, useRef, useState } from 'react';
import { exportProject, webCodecsAvailable, type ExportFormat, type ExportProgress } from '../../export/exporter.ts';
import { projectDuration } from '../../core/select.ts';
import { useProject } from '../hooks/useEditorStore.ts';

export function ExportDialog(props: { onClose: () => void }) {
  const doc = useProject();
  const [format, setFormat] = useState<ExportFormat>('mp4');
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ sizeBytes: number; hasAudio: boolean; format: ExportFormat } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const supported = webCodecsAvailable();
  const duration = projectDuration(doc);
  const busy = progress !== null;
  const extension = format === 'mp4' ? 'mp4' : 'webm';

  const start = async () => {
    setError(null);
    setDone(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await exportProject(doc, {
        format,
        signal: controller.signal,
        onProgress: setProgress,
      });
      downloadBlob(result.blob, `${doc.name || 'cutforge'}.${extension}`);
      setDone({ sizeBytes: result.blob.size, hasAudio: result.hasAudio, format });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        props.onClose();
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      abortRef.current = null;
      setProgress(null);
    }
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => !busy && e.target === e.currentTarget && props.onClose()}>
      <div className="modal">
        <div className="panel-title">
          导出视频
          <button type="button" className="btn btn-small" onClick={props.onClose} disabled={busy}>关闭</button>
        </div>
        <div className="export-summary">
          {doc.width}×{doc.height} · {doc.fps}fps · {duration.toFixed(2)}s · {doc.clips.length} 个片段
        </div>
        <div className="export-format-row">
          <label className="export-format-option">
            <input type="radio" name="export-format" checked={format === 'mp4'} onChange={() => setFormat('mp4')} disabled={busy} />
            <span>MP4 <small className="export-format-hint">通用格式,适合分享(H.264)</small></span>
          </label>
          <label className="export-format-option">
            <input type="radio" name="export-format" checked={format === 'webm'} onChange={() => setFormat('webm')} disabled={busy} />
            <span>WebM <small className="export-format-hint">开放格式,体积更小(VP9)</small></span>
          </label>
        </div>
        {!supported && (
          <div className="export-warning">此浏览器不支持 WebCodecs,请使用新版 Chrome 或 Edge。</div>
        )}
        {progress && (
          <div className="export-progress">
            <div className="export-progress-label">
              {progress.stage === 'video' ? '渲染视频帧' : progress.stage === 'audio' ? '混音编码' : '封装'}
              {(progress.ratio * 100).toFixed(0)}%
            </div>
            <div className="export-progress-bar">
              <div className="export-progress-fill" style={{ width: `${progress.ratio * 100}%` }} />
            </div>
            <div className="export-progress-hint">逐帧渲染较慢,属正常现象;可随时取消。</div>
          </div>
        )}
        {done && (
          <div className="export-done">
            ✅ 导出完成:{(done.sizeBytes / 1024 / 1024).toFixed(1)} MB
            {done.hasAudio ? '(含音频)' : '(无音轨:素材未能解码)'},已开始下载。
          </div>
        )}
        {error && <div className="export-error">❌ {error}</div>}
        <div className="export-actions">
          {busy ? (
            <button type="button" className="btn" onClick={() => abortRef.current?.abort()}>取消导出</button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={!supported || duration <= 0} onClick={() => void start()}>
              开始导出 {extension.toUpperCase()}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // 延迟 revoke:同步撤销可能在浏览器开始读取前掐断下载
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
