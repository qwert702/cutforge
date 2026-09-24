// 兼容层:统一导出引擎已迁移到 exporter.ts(支持 WebM/MP4 双格式)。
// 保留此 shim 以免旧引用失效;新代码请直接使用 exporter.ts。
export { exportProject as exportWebM, webCodecsAvailable, type ExportOptions, type ExportProgress, type ExportResult } from './exporter.ts';
