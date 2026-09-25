// 属性检查器:选中片段时显示可编辑属性。
// 文字片段:内容/大小/颜色;媒体片段:变速/音量 + 淡入淡出转场;
// 视频轨片段均支持关键帧动画(位置/缩放/不透明度/旋转)。

import { clipById } from '../../core/select.ts';
import type { Command } from '../../core/commands.ts';
import {
  clipTransformAt,
  KEYFRAME_RANGES,
  type KeyframeProp,
} from '../../core/types.ts';
import { editorStore, useEditor, useProject } from '../hooks/useEditorStore.ts';

type Dispatch = (command: Command, label: string) => void;

const PROP_LABELS: Record<KeyframeProp, string> = {
  x: '位置 X',
  y: '位置 Y',
  scale: '缩放',
  opacity: '不透明度',
  rotation: '旋转°',
};

const PROP_STEPS: Record<KeyframeProp, number> = {
  x: 0.01,
  y: 0.01,
  scale: 0.05,
  opacity: 0.01,
  rotation: 1,
};

export function Inspector() {
  const doc = useProject();
  const { selection, playhead } = useEditor();
  if (selection.length !== 1) return null;
  const clip = clipById(doc, selection[0]);
  if (!clip) return null;
  const dispatch: Dispatch = (command, label) => editorStore.dispatch(command, label);
  const isText = clip.text !== undefined;
  const asset = doc.assets.find((a) => a.id === clip.assetId);
  const showKeyframes = isText || asset?.kind === 'video' || asset?.kind === 'image';

  return (
    <div className="inspector">
      <div className="panel-title">{isText ? '文字' : '片段属性'}</div>
      {isText ? (
        <>
          <textarea
            className="inspector-textarea"
            value={clip.text.content}
            rows={2}
            onChange={(e) => dispatch({ type: 'clip.updateText', clipId: clip.id, text: { content: e.target.value } }, '编辑文字')}
          />
          <label className="inspector-row">
            大小 {clip.text.size}px
            <input type="range" min={16} max={256} step={4} value={clip.text.size}
              onChange={(e) => dispatch({ type: 'clip.updateText', clipId: clip.id, text: { size: Number(e.target.value) } }, '编辑文字')} />
          </label>
          <label className="inspector-row">
            颜色
            <input type="color" value={clip.text.color}
              onChange={(e) => dispatch({ type: 'clip.updateText', clipId: clip.id, text: { color: e.target.value } }, '编辑文字')} />
          </label>
        </>
      ) : (
        <>
          <div className="inspector-asset">{asset?.name ?? clip.assetId}</div>
          {asset?.kind !== 'image' && (
            <>
              <label className="inspector-row">
                速度 {(clip.speed ?? 1).toFixed(2)}x
                <input type="range" min={0.25} max={4} step={0.05} value={clip.speed ?? 1}
                  onChange={(e) => dispatch({ type: 'clip.properties', clipId: clip.id, speed: Number(e.target.value) }, '调整片段属性')} />
              </label>
              <label className="inspector-row">
                音量 {Math.round((clip.volume ?? 1) * 100)}%
                <input type="range" min={0} max={2} step={0.05} value={clip.volume ?? 1}
                  onChange={(e) => dispatch({ type: 'clip.properties', clipId: clip.id, volume: Number(e.target.value) }, '调整片段属性')} />
              </label>
            </>
          )}
        </>
      )}
      <div className="inspector-section">转场(淡入淡出)</div>
      <label className="inspector-row">
        淡入 {clip.fadeIn ? `${clip.fadeIn.toFixed(1)}s` : '无'}
        <input type="range" min={0} max={Math.max(0.1, clip.duration / 2)} step={0.1} value={clip.fadeIn ?? 0}
          onChange={(e) => dispatch({ type: 'clip.properties', clipId: clip.id, fadeIn: Number(e.target.value) }, '调整片段属性')} />
      </label>
      <label className="inspector-row">
        淡出 {clip.fadeOut ? `${clip.fadeOut.toFixed(1)}s` : '无'}
        <input type="range" min={0} max={Math.max(0.1, clip.duration / 2)} step={0.1} value={clip.fadeOut ?? 0}
          onChange={(e) => dispatch({ type: 'clip.properties', clipId: clip.id, fadeOut: Number(e.target.value) }, '调整片段属性')} />
      </label>
      <div className="inspector-row inspector-fadetype">
        底色:
        <label>
          <input type="radio" name={`fade-${clip.id}`} checked={(clip.fadeType ?? 'black') === 'black'}
            onChange={() => dispatch({ type: 'clip.properties', clipId: clip.id, fadeType: 'black' }, '调整片段属性')} />
          黑场
        </label>
        <label>
          <input type="radio" name={`fade-${clip.id}`} checked={clip.fadeType === 'white'}
            onChange={() => dispatch({ type: 'clip.properties', clipId: clip.id, fadeType: 'white' }, '调整片段属性')} />
          白场
        </label>
      </div>

      {showKeyframes && (
        <KeyframeSection clip={clip} playhead={playhead} dispatch={dispatch} textMode={isText} />
      )}
    </div>
  );
}

function KeyframeSection(props: {
  clip: NonNullable<ReturnType<typeof clipById>>;
  playhead: number;
  dispatch: Dispatch;
  textMode: boolean;
}) {
  const { clip, playhead, dispatch, textMode } = props;
  const keyframes = clip.keyframes ?? [];
  const relative = Math.min(clip.duration, Math.max(0, playhead - clip.start));
  const transform = clipTransformAt(clip, playhead);
  const props_: KeyframeProp[] = textMode ? ['scale', 'opacity', 'rotation'] : ['x', 'y', 'scale', 'opacity', 'rotation'];
  const within = playhead >= clip.start && playhead <= clip.start + clip.duration;

  return (
    <>
      <div className="inspector-section">
        动画(关键帧)
        {keyframes.length > 0 && (
          <button
            type="button"
            className="btn btn-small"
            title="清除全部关键帧"
            onClick={() => dispatch({ type: 'clip.clearKeyframes', clipId: clip.id }, '清除关键帧')}
          >
            清空
          </button>
        )}
      </div>
      {!within && <div className="keyframe-hint">把播放头移到片段内可打关键帧</div>}
      {props_.map((prop) => {
        const [min, max] = KEYFRAME_RANGES[prop];
        const count = keyframes.filter((k) => k.prop === prop).length;
        return (
          <div key={prop} className="keyframe-row">
            <label className="inspector-row">
              {PROP_LABELS[prop]} {formatProp(prop, transform[prop])}{count > 0 ? ` · ◆${count}` : ''}
              <input
                type="range"
                min={min}
                max={max}
                step={PROP_STEPS[prop]}
                value={transform[prop]}
                onChange={(e) => dispatch(
                  { type: 'clip.setKeyframe', clipId: clip.id, prop, time: relative, value: Number(e.target.value) },
                  '设置关键帧',
                )}
              />
            </label>
            <button
              type="button"
              className="btn btn-small"
              disabled={!within}
              title={`在播放头位置为${PROP_LABELS[prop]}打关键帧`}
              onClick={() => dispatch(
                { type: 'clip.setKeyframe', clipId: clip.id, prop, time: relative, value: transform[prop] },
                '设置关键帧',
              )}
            >
              ◆
            </button>
          </div>
        );
      })}
    </>
  );
}

function formatProp(prop: KeyframeProp, value: number): string {
  if (prop === 'rotation') return `${Math.round(value)}°`;
  if (prop === 'scale') return `${value.toFixed(2)}x`;
  return value.toFixed(2);
}
