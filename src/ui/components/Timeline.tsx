// 时间线:标尺 + 轨道行 + 片段块。支持:
//   - 标尺点击/拖动定位播放头
//   - 片段拖拽移动(可跨同类型轨道,自动吸附到 0/播放头/其他片段边缘)
//   - 片段左右边缘裁剪(trim)
//   - 点击选中 / Shift 多选 / 右键菜单
//   - 轨道管理:双击重命名、删除、底部快速新建
// 拖拽过程中在本地推导预览几何,松手才派发命令(reducer 拒绝则回弹)。

import { useCallback, useEffect, useRef, useState } from 'react';
import { clipById } from '../../core/select.ts';
import { clipEnd, snapToFrame, uid, type Clip, type ProjectDoc, type TrackKind } from '../../core/types.ts';
import { editorStore, useEditor, useProject } from '../hooks/useEditorStore.ts';
import { ContextMenu, type MenuItem } from './ContextMenu.tsx';
import { ClipThumbs, ClipWaveform } from './ClipVisuals.tsx';
import { loadDemoProject } from '../../media/demo.ts';
import { addTextToTimeline } from './MediaLibrary.tsx';

const TRACK_HEIGHT = 56;
const SNAP_PX = 8;

interface DragState {
  kind: 'move' | 'trim-start' | 'trim-end';
  clipId: string;
  originX: number;
  origStart: number;
  origDuration: number;
  origInPoint: number;
  origTrackId: string;
  /** move 时根据指针悬停的轨道实时更新 */
  hoverTrackId: string | null;
  dt: number;
  /** 吸附参考线的时间位置(无吸附时为 null) */
  snapAt: number | null;
}

export function Timeline() {
  const doc = useProject();
  const { playhead, zoom, selection } = useEditor();
  const [drag, setDrag] = useState<DragState | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [renamingTrack, setRenamingTrack] = useState<string | null>(null);
  const [emptyBusy, setEmptyBusy] = useState(false);
  const rulerInnerRef = useRef<HTMLDivElement>(null);

  const duration = Math.max(10, doc.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0) + 10);
  const step = zoom >= 160 ? 0.5 : zoom >= 80 ? 1 : zoom >= 40 ? 2 : zoom >= 20 ? 5 : 10;
  const ticks = Math.ceil(duration / step) + 1;

  const timeAtClientX = useCallback(
    (clientX: number): number => {
      const lanes = document.querySelector('.timeline-lanes');
      if (!lanes) return 0;
      const left = lanes.getBoundingClientRect().left;
      return Math.max(0, snapToFrame((clientX - left) / zoom, doc.fps));
    },
    [zoom, doc.fps],
  );

  // 轨道横向滚动时,标尺同步平移
  const syncRuler = useCallback((target: HTMLElement) => {
    if (rulerInnerRef.current) rulerInnerRef.current.style.transform = `translateX(${-target.scrollLeft}px)`;
  }, []);

  // 吸附:把移动后的起点/终点贴到候选时间(0、播放头、其他片段边缘)
  const snapDt = useCallback(
    (d: DragState, rawDt: number): { dt: number; snapAt: number | null } => {
      const fps = doc.fps;
      const threshold = SNAP_PX / zoom;
      const candidates: number[] = [0, playhead];
      for (const clip of doc.clips) {
        if (clip.id === d.clipId) continue;
        candidates.push(clip.start, clipEnd(clip));
      }
      const start = d.origStart + rawDt;
      const end = start + d.origDuration;
      let bestDt = rawDt;
      let bestDist = threshold;
      let snapAt: number | null = null;
      for (const candidate of candidates) {
        const distStart = Math.abs(start - candidate);
        if (distStart < bestDist) {
          bestDist = distStart;
          bestDt = snapToFrame(candidate - d.origStart, fps);
          snapAt = candidate;
        }
        const distEnd = Math.abs(end - candidate);
        if (distEnd < bestDist) {
          bestDist = distEnd;
          bestDt = snapToFrame(candidate - d.origDuration - d.origStart, fps);
          snapAt = candidate;
        }
      }
      return { dt: bestDt, snapAt };
    },
    [doc.clips, doc.fps, playhead, zoom],
  );

  // 拖拽手势:window 级 pointermove/up,松手提交
  useEffect(() => {
    if (!drag) return;
    const onMove = (event: PointerEvent) => {
      const rawDt = snapToFrame((event.clientX - drag.originX) / zoom, doc.fps);
      const hoverTrackId = drag.kind === 'move' ? trackIdAtClientY(doc, event.clientY) : null;
      if (drag.kind === 'move') {
        const { dt, snapAt } = snapDt(drag, rawDt);
        setDrag({ ...drag, dt, hoverTrackId, snapAt });
      } else {
        setDrag({ ...drag, dt: rawDt, hoverTrackId, snapAt: null });
      }
    };
    const onUp = () => {
      commitDrag(doc, drag);
      setDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, zoom, doc, snapDt]); // eslint-disable-line react-hooks/exhaustive-deps

  const startDrag = (kind: DragState['kind'], event: React.PointerEvent, clip: Clip) => {
    event.stopPropagation();
    editorStore.selectOnly(clip.id);
    setDrag({
      kind,
      clipId: clip.id,
      originX: event.clientX,
      origStart: clip.start,
      origDuration: clip.duration,
      origInPoint: clip.inPoint,
      origTrackId: clip.trackId,
      hoverTrackId: clip.trackId,
      dt: 0,
      snapAt: null,
    });
  };

  const seekFromClientX = useCallback(
    (clientX: number) => editorStore.seek(timeAtClientX(clientX)),
    [timeAtClientX],
  );

  const openClipMenu = (clip: Clip, event: React.MouseEvent) => {
    event.preventDefault();
    editorStore.selectOnly(clip.id);
    const inside = playhead > clip.start && playhead < clipEnd(clip);
    const items: MenuItem[] = [
      { label: '复制片段', onSelect: () => editorStore.dispatch({ type: 'clip.duplicate', clipId: clip.id, newClipId: uid('clip') }, '复制片段') },
      {
        label: '在播放头处分割',
        disabled: !inside,
        onSelect: () => editorStore.dispatch({ type: 'clip.split', clipId: clip.id, at: playhead, newClipId: uid('clip') }, '分割片段'),
      },
      { label: '删除', danger: true, onSelect: () => editorStore.dispatch({ type: 'clip.remove', clipId: clip.id }, '删除片段') },
    ];
    setMenu({ x: event.clientX, y: event.clientY, items });
  };

  const addTrack = (kind: TrackKind) => {
    const count = doc.tracks.filter((t) => t.kind === kind).length;
    const track = { id: uid('track'), kind, name: `${kind === 'video' ? '视频' : '音频'} ${count + 1}` };
    editorStore.dispatch({ type: 'track.add', track }, '新建轨道');
  };

  const removeTrack = (trackId: string) => {
    const track = doc.tracks.find((t) => t.id === trackId);
    const clipCount = doc.clips.filter((c) => c.trackId === trackId).length;
    if (track && clipCount > 0 && !window.confirm(`删除轨道「${track.name}」将同时删除其上 ${clipCount} 个片段,继续?`)) return;
    editorStore.dispatch({ type: 'track.remove', trackId }, '删除轨道');
  };

  // 片段 → 展示轨道(move 跨轨时实时跟着指针走)
  const viewTrackIdOf = (clip: Clip): string => {
    if (!drag || drag.clipId !== clip.id || drag.kind !== 'move') return clip.trackId;
    return compatibleTrack(doc, clip, drag.hoverTrackId ?? drag.origTrackId);
  };

  return (
    <div className="timeline">
      <div className="timeline-corner" />
      <div
        className="timeline-ruler"
        onPointerDown={(e) => {
          seekFromClientX(e.clientX);
          const onMove = (ev: PointerEvent) => seekFromClientX(ev.clientX);
          const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
          };
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
        }}
      >
        <div className="timeline-ruler-inner" ref={rulerInnerRef} style={{ width: duration * zoom }}>
          {Array.from({ length: ticks }, (_, i) => (
            <span key={i} className="ruler-tick" style={{ left: i * step * zoom }}>
              {formatTime(i * step)}
            </span>
          ))}
        </div>
      </div>

      <div className="timeline-headers">
        {doc.tracks.map((track) => (
          <div key={track.id} className="track-header" style={{ height: TRACK_HEIGHT }}>
            <span className={`track-kind track-kind-${track.kind}`}>{track.kind === 'video' ? '视' : '音'}</span>
            {renamingTrack === track.id ? (
              <input
                className="track-rename-input"
                autoFocus
                defaultValue={track.name}
                onBlur={(e) => {
                  setRenamingTrack(null);
                  const name = e.target.value.trim();
                  if (name && name !== track.name) {
                    editorStore.dispatch({ type: 'track.rename', trackId: track.id, name }, '重命名轨道');
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') setRenamingTrack(null);
                }}
              />
            ) : (
              <span
                className="track-name"
                title={track.name}
                onDoubleClick={() => setRenamingTrack(track.id)}
              >
                {track.name}
              </span>
            )}
            <button
              type="button"
              className="track-delete"
              title={`删除轨道 ${track.name}`}
              onClick={() => removeTrack(track.id)}
            >
              ×
            </button>
          </div>
        ))}
        {doc.tracks.length === 0 && (
          <div className="track-header track-header-empty" style={{ height: TRACK_HEIGHT }}>
            先导入素材或新建轨道
          </div>
        )}
        <div className="track-add-row">
          <button type="button" className="track-add" onClick={() => addTrack('video')}>＋ 视频轨</button>
          <button type="button" className="track-add" onClick={() => addTrack('audio')}>＋ 音频轨</button>
        </div>
      </div>

      <div className="timeline-scroll" onScroll={(e) => syncRuler(e.currentTarget)}>
        <div className="timeline-lanes" style={{ width: Math.max(duration * zoom, 400) }}>
          {doc.tracks.map((track) => (
            <div
              key={track.id}
              className="track-lane"
              style={{ height: TRACK_HEIGHT }}
              onPointerDown={() => editorStore.clearSelection()}
            >
              {doc.clips
                .filter((clip) => viewTrackIdOf(clip) === track.id)
                .map((clip) => (
                  <ClipBlock
                    key={clip.id}
                    doc={doc}
                    clip={viewOf(clip, drag, doc.fps)}
                    selected={selection.includes(clip.id)}
                    dragging={drag?.clipId === clip.id}
                    zoom={zoom}
                    onDragStart={startDrag}
                    onContextMenu={openClipMenu}
                  />
                ))}
            </div>
          ))}
          {doc.tracks.length === 0 && (
            <div className="track-lane track-lane-empty" style={{ height: TRACK_HEIGHT }}>
              <button
                type="button"
                className="btn btn-small btn-primary"
                disabled={emptyBusy}
                onClick={async () => {
                  setEmptyBusy(true);
                  const result = await loadDemoProject();
                  setEmptyBusy(false);
                  if (!result.ok && result.error) editorStore.notify(result.error);
                }}
                title="现场生成两段示例视频并铺上时间线"
              >
                🎬 一分钟体验示例
              </button>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => addTextToTimeline(doc)}
              >
                ＋ 添加文字
              </button>
              <span className="track-empty-hint">或从左侧导入素材 / 把文件拖进窗口</span>
            </div>
          )}
          {drag?.snapAt != null && (
            <div className="snap-guide" style={{ left: drag.snapAt * zoom }} />
          )}
          <div className="playhead" style={{ left: playhead * zoom }} />
        </div>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

function ClipBlock(props: {
  doc: ProjectDoc;
  clip: Clip;
  selected: boolean;
  dragging: boolean;
  zoom: number;
  onDragStart: (kind: DragState['kind'], event: React.PointerEvent, clip: Clip) => void;
  onContextMenu: (clip: Clip, event: React.MouseEvent) => void;
}) {
  const { doc, clip, selected, dragging, zoom, onDragStart, onContextMenu } = props;
  const asset = doc.assets.find((a) => a.id === clip.assetId);
  const kindClass = clip.text !== undefined ? 'clip-text' : `clip-${asset?.kind ?? 'video'}`;
  const label = clip.text !== undefined ? `字 ${clip.text.content.split('\n')[0]}` : asset?.name ?? clip.assetId;
  const speed = clip.speed ?? 1;
  const showThumbs = asset?.kind === 'video';
  const showWave = asset?.kind === 'audio';
  return (
    <div
      className={`clip ${selected ? 'clip-selected' : ''} ${dragging ? 'clip-dragging' : ''} ${kindClass}`}
      style={{ left: clip.start * zoom, width: Math.max(8, clip.duration * zoom) }}
      onPointerDown={(e) => onDragStart('move', e, clip)}
      onContextMenu={(e) => onContextMenu(clip, e)}
      title={`${clip.text !== undefined ? clip.text.content : asset?.name ?? clip.assetId} · ${clip.duration.toFixed(2)}s`}
    >
      {showThumbs && asset && (
        <ClipThumbs asset={asset} srcStart={clip.inPoint} srcSpan={clip.duration * speed} />
      )}
      {showWave && asset && (
        <ClipWaveform asset={asset} srcStart={clip.inPoint} srcSpan={clip.duration * speed} />
      )}
      <span
        className="clip-handle clip-handle-left"
        onPointerDown={(e) => onDragStart('trim-start', e, clip)}
      />
      <span className="clip-name">{label}</span>
      {(clip.fadeIn || clip.fadeOut) && <span className="clip-fade-badge">◐</span>}
      <span
        className="clip-handle clip-handle-right"
        onPointerDown={(e) => onDragStart('trim-end', e, clip)}
      />
    </div>
  );
}

/** 拖拽中的片段显示预览几何;否则原样返回。 */
function viewOf(clip: Clip, drag: DragState | null, fps: number): Clip {
  if (!drag || drag.clipId !== clip.id) return clip;
  if (drag.kind === 'move') {
    return { ...clip, start: Math.max(0, snapToFrame(drag.origStart + drag.dt, fps)) };
  }
  return clip;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

function trackIdAtClientY(doc: ProjectDoc, clientY: number): string | null {
  const lanes = document.querySelector('.timeline-lanes');
  if (!lanes) return null;
  const top = lanes.getBoundingClientRect().top;
  const index = Math.floor((clientY - top) / TRACK_HEIGHT);
  return doc.tracks[index]?.id ?? null;
}

/** 素材类型与轨道类型兼容才允许落点,否则维持原轨道。 */
function compatibleTrack(doc: ProjectDoc, clip: Clip | null, candidateTrackId: string | null): string {
  if (!clip) return '';
  if (!candidateTrackId) return clip.trackId;
  const asset = doc.assets.find((a) => a.id === clip.assetId);
  const track = doc.tracks.find((t) => t.id === candidateTrackId);
  if (!asset || !track) return clip.trackId;
  if (track.kind === 'video' && asset.kind === 'audio') return clip.trackId;
  return track.id;
}

function commitDrag(doc: ProjectDoc, drag: DragState): void {
  if (!drag.dt) return; // 无位移的点击不算拖拽
  if (drag.kind === 'move') {
    const clip = clipById(doc, drag.clipId);
    if (!clip) return;
    const trackId = compatibleTrack(doc, clip, drag.hoverTrackId ?? drag.origTrackId);
    const start = Math.max(0, snapToFrame(drag.origStart + drag.dt, doc.fps));
    editorStore.dispatch(
      { type: 'clip.move', clipId: drag.clipId, start, ...(trackId !== drag.origTrackId ? { trackId } : {}) },
      '移动片段',
    );
    return;
  }
  if (drag.kind === 'trim-start') {
    // 左边缘最多移到:源内偏移耗尽(inPoint=0)或时间线起点
    const maxLeftShift = Math.min(drag.origInPoint, drag.origStart);
    const clampedDt = Math.max(Math.min(drag.dt, drag.origDuration - 1 / doc.fps), -maxLeftShift);
    editorStore.dispatch(
      {
        type: 'clip.trim',
        clipId: drag.clipId,
        start: snapToFrame(drag.origStart + clampedDt, doc.fps),
        duration: snapToFrame(drag.origDuration - clampedDt, doc.fps),
      },
      '调整片段',
    );
    return;
  }
  const duration = Math.max(1 / doc.fps, snapToFrame(drag.origDuration + drag.dt, doc.fps));
  editorStore.dispatch({ type: 'clip.trim', clipId: drag.clipId, duration }, '调整片段');
}

export type { TrackKind };
