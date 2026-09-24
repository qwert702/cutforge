// 属性检查器:选中片段时显示可编辑属性。
// 文字片段:内容/大小/颜色;媒体片段:变速/音量 + 淡入淡出转场。

import { clipById } from '../../core/select.ts';
import type { Command } from '../../core/commands.ts';
import { editorStore, useEditor, useProject } from '../hooks/useEditorStore.ts';

type Dispatch = (command: Command, label: string) => void;

export function Inspector() {
  const doc = useProject();
  const { selection } = useEditor();
  if (selection.length !== 1) return null;
  const clip = clipById(doc, selection[0]);
  if (!clip) return null;
  const dispatch: Dispatch = (command, label) => editorStore.dispatch(command, label);
  const isText = clip.text !== undefined;

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
          <div className="inspector-asset">
            {doc.assets.find((a) => a.id === clip.assetId)?.name ?? clip.assetId}
          </div>
          {doc.assets.find((a) => a.id === clip.assetId)?.kind !== 'image' && (
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
    </div>
  );
}
