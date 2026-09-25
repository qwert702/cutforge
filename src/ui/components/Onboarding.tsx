// 首次启动引导:三步讲清楚产品怎么用,一键进入体验。
// localStorage 记录已读;工具栏「?」可随时重看。
import { useRef, useState } from 'react';
import { loadDemoProject } from '../../media/demo.ts';
import { importFiles } from '../../media/import.ts';
import { editorStore } from '../hooks/useEditorStore.ts';

const SEEN_KEY = 'cutforge.onboarding.v1';

export function isOnboardingSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true; // 无法读写时不再打扰
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* 忽略 */
  }
}

export function Onboarding(props: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const finish = () => {
    markSeen();
    props.onClose();
  };

  const startDemo = async () => {
    setBusy(true);
    setError(null);
    const result = await loadDemoProject();
    setBusy(false);
    if (result.ok) finish();
    else setError(result.error ?? '示例生成失败,请重试');
  };

  const onPick = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const { assets } = await importFiles([...files]);
    if (assets.length > 0) {
      editorStore.dispatchAll(assets.map((asset) => ({ type: 'asset.add', asset }) as const), '导入素材');
    }
    setBusy(false);
    finish();
  };

  return (
    <div className="modal-backdrop onboarding-backdrop">
      <div className="onboarding">
        <div className="onboarding-head">
          <img src="/favicon.svg" alt="" width={44} height={44} />
          <div>
            <div className="onboarding-title">欢迎来到 CutForge</div>
            <div className="onboarding-sub">对话驱动的 AI 视频编辑器 —— 剪的是可继续编辑的真工程,不是一次性视频</div>
          </div>
        </div>

        <div className="onboarding-steps">
          <div className="onboarding-step">
            <span className="onboarding-num">1</span>
            <div>
              <div className="onboarding-step-title">开始:体验或导入</div>
              <div className="onboarding-step-desc">
                没有素材?点下面的按钮,应用会现场生成两段示例视频;
                或者把文件直接拖进窗口。
              </div>
            </div>
          </div>
          <div className="onboarding-step">
            <span className="onboarding-num">2</span>
            <div>
              <div className="onboarding-step-title">剪辑:手动或让 AI 来</div>
              <div className="onboarding-step-desc">
                拖拽移动、边缘裁剪、右键菜单、S 键分割;
                右侧 AI 面板用一句话让它帮你剪(需在设置里填模型 Key)。
              </div>
            </div>
          </div>
          <div className="onboarding-step">
            <span className="onboarding-num">3</span>
            <div>
              <div className="onboarding-step-title">导出:MP4 / WebM</div>
              <div className="onboarding-step-desc">
                点右上「导出」,全程在你的浏览器里完成,素材不出本机。
                工程会自动保存在本地,刷新也不丢。
              </div>
            </div>
          </div>
        </div>

        <div className="onboarding-actions">
          <button type="button" className="btn btn-primary onboarding-cta" disabled={busy} onClick={() => void startDemo()}>
            {busy ? '正在生成示例…(约 10 秒)' : '🎬 一分钟体验示例工程'}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => inputRef.current?.click()}>
            导入我的素材
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="video/*,audio/*,image/*"
            hidden
            onChange={(e) => void onPick(e.target.files)}
          />
        </div>
        {error && <div className="export-error">{error}</div>}
        <div className="onboarding-shortcuts">
          <span><kbd>空格</kbd> 播放/暂停</span>
          <span><kbd>S</kbd> 在播放头分割</span>
          <span><kbd>Del</kbd> 删除选中</span>
          <span><kbd>Ctrl+Z</kbd> 撤销</span>
          <span>拖动片段移动(自动吸附)</span>
          <span>拖片段边缘裁剪</span>
          <span>双击轨道名重命名</span>
          <span>右键片段更多操作</span>
        </div>

        <div className="onboarding-foot">
          <button type="button" className="btn btn-small" onClick={finish}>直接开始</button>
          <span className="onboarding-hint">之后可随时点工具栏「?」重新查看本引导与快捷键</span>
        </div>
      </div>
    </div>
  );
}
