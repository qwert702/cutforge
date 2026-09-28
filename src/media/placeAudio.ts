// 把音频素材放到音频轨(播放头处;轨道不存在则创建)。配音与 TTS 共用。
import type { Command } from '../core/commands.ts';
import { findFreeStart } from '../core/select.ts';
import { uid, type MediaAsset, type ProjectDoc, type TrackKind } from '../core/types.ts';
import { editorStore } from '../ui/hooks/useEditorStore.ts';

export function placeAudioAtPlayhead(doc: ProjectDoc, asset: MediaAsset, playhead: number, trackName = '音频 1'): void {
  const commands: Command[] = [];
  const kind: TrackKind = 'audio';
  let track = doc.tracks.find((t) => t.kind === kind);
  if (!track) {
    track = { id: uid('track'), kind, name: trackName };
    commands.push({ type: 'track.add', track });
  }
  const duration = Math.max(0.3, asset.durationSeconds ?? 1);
  const start = findFreeStart(doc, track.id, duration, Math.max(0, playhead));
  commands.push({
    type: 'clip.add',
    clip: { id: uid('clip'), trackId: track.id, assetId: asset.id, start, duration, inPoint: 0 },
  });
  editorStore.dispatchAll(commands, `添加音频:${asset.name}`);
}
