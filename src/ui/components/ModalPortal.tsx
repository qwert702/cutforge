// 弹窗传送门:毛玻璃面板(backdrop-filter)会让 position:fixed 后代以该面板为
// 包含块,导致弹窗被限制在面板内。所有全屏弹窗必须经此 Portal 挂到 body。
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

export function ModalPortal(props: { children: ReactNode }) {
  return createPortal(props.children, document.body);
}
