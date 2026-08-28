// 模型字节缓存（Cache API）的 key 与清理工具。
// 与 AvatarVRM 的写入共用同一 key，保持单一真值，避免两处字符串不同步。
export const MODEL_CACHE_NAME = 'firefly-vrm-cache-v1'

// 清除已缓存的模型字节（换模型后强制重新下载用）。
// 返回是否支持/成功；不支持 Cache API 时返回 false。
export async function clearModelCache() {
  if (typeof caches === 'undefined') return false
  await caches.delete(MODEL_CACHE_NAME)
  return true
}
