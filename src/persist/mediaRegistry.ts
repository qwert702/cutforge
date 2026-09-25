// 素材二进制注册表:assetId → Blob。
// 导入/示例生成时登记,持久化时把 blob 写进工程库,恢复时重建 blob: URL。
// 纯内存模块态,不进撤销栈。

const registry = new Map<string, Blob>();

export function registerMediaBlob(assetId: string, blob: Blob): void {
  registry.set(assetId, blob);
}

export function getMediaBlob(assetId: string): Blob | undefined {
  return registry.get(assetId);
}

export function allMediaBlobs(): Map<string, Blob> {
  return new Map(registry);
}

/** 用注册表里的 blob 替换整张表(恢复工程时调用)。 */
export function replaceMediaBlobs(blobs: Map<string, Blob>): void {
  registry.clear();
  for (const [id, blob] of blobs) registry.set(id, blob);
}

/** 只保留给定 assetId 的条目(工程删除素材后同步瘦身)。 */
export function retainMediaBlobs(keepIds: ReadonlySet<string>): void {
  const ids = [...registry.keys()];
  for (const id of ids) {
    if (!keepIds.has(id)) registry.delete(id);
  }
}
