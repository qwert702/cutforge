// 贴纸选择:emoji 即贴纸(原创零素材),点击生成大号文字片段。
import { editorStore } from '../hooks/useEditorStore.ts';
import { addTextToTimeline } from './MediaLibrary.tsx';

const STICKERS: readonly string[] = [
  '😂', '🔥', '❤️', '👍', '✨', '🎬', '🎵', '⭐',
  '😍', '🤔', '😭', '🎉', '💯', '👀', '🙌', '💪',
  '🤣', '😎', '🥰', '😡', '🚀', '💡', '⚡', '🌈',
];

export function StickerPicker(props: { onClose: () => void; onPick: (emoji: string) => void }) {
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal sticker-modal">
        <div className="panel-title">
          😀 选择贴纸
          <button type="button" className="btn btn-small" onClick={props.onClose}>关闭</button>
        </div>
        <div className="sticker-grid">
          {STICKERS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="sticker-cell"
              onClick={() => {
                addTextToTimeline(editorStore.get().history.present, emoji, { size: 220, sticker: true });
                props.onPick(emoji);
                props.onClose();
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
        <div className="settings-hint">贴纸会作为文字片段添加到播放头位置,可拖拽、加关键帧动画。</div>
      </div>
    </div>
  );
}
