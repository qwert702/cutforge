// 一键成片:选模板 → 用库内视觉素材生成整段时间线(整批一个撤销点)。
import { useState } from 'react';
import { editorStore, useProject } from '../hooks/useEditorStore.ts';
import { buildStoryboard, STORYBOARD_TEMPLATES, type StoryboardTemplate } from '../../media/templates.ts';

export function TemplatePicker(props: { onClose: () => void }) {
  const doc = useProject();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visualCount = doc.assets.filter((a) => a.kind === 'video' || a.kind === 'image').length;

  const generate = async (template: StoryboardTemplate) => {
    setBusy(template.id);
    setError(null);
    try {
      // 建议先加载示例/导入素材;模板直接消费库内视觉素材
      const commands = buildStoryboard(template, doc.assets);
      if (commands.length === 0) {
        setError('没有可用的视频/图片素材,请先导入或加载示例工程。');
        return;
      }
      const result = editorStore.dispatchAll(commands, `一键成片:${template.name}`);
      if (result.ok) {
        props.onClose();
        editorStore.notify(`已按「${template.name}」生成 ${visualCount} 个素材的成片,Ctrl+Z 可撤销`);
      } else {
        setError(result.error ?? '生成失败');
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal">
        <div className="panel-title">
          ✨ 一键成片
          <button type="button" className="btn btn-small" onClick={props.onClose}>关闭</button>
        </div>
        <div className="settings-hint">
          选择一个故事板模板,会用素材库里 {visualCount} 个视频/图片素材自动排版(片段、转场、关键帧、文字)。
        </div>
        <div className="template-list">
          {STORYBOARD_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              className="template-card"
              disabled={busy !== null || visualCount === 0}
              onClick={() => void generate(template)}
            >
              <span className="template-name">{busy === template.id ? '生成中…' : template.name}</span>
              <span className="template-desc">{template.description}</span>
            </button>
          ))}
        </div>
        {visualCount === 0 && <div className="export-warning">素材库为空:先导入素材或加载示例工程。</div>}
        {error && <div className="export-error">❌ {error}</div>}
      </div>
    </div>
  );
}
