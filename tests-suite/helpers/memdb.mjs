import { openDb } from '../../packages/shared/dist/server/index.js'

/**
 * 建一个全新的内存库(:memory:)。
 * openDb 对 ':memory:' 豁免 journal_mode=delete 校验,且每次调用互不共享,适合隔离测试。
 */
export function freshDb() {
  return openDb(':memory:')
}
