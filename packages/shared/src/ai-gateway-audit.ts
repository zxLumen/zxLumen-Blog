/**
 * AI 网关配置体检。
 *
 * 背景:网关的模型优先级是 `app.model || provider.model || request.model`,而面板里
 * 「固定模型 / 默认模型」两个下拉的候选项**只来自当前密钥的 `models` 列表**。一旦你
 * 换了密钥(或点了「拉取模型」换了列表),旧值就**不在候选项里**——Mantine 的 Select
 * 找不到 label 会渲染成空白,看着像"没设过",但值还在库里、优先级最高,于是出现
 * 「幽灵模型」:面板上是空的,实际一直生效,换密钥也甩不掉。
 *
 * 这里放纯函数,面板与服务端共用:
 *  - `modelOptions()`:把当前已存值并进候选项,让下拉能显示出真实值;
 *  - `auditGatewayConfig()`:列出失效值 / 孤儿绑定,面板顶部直接提示。
 *
 * 只做体检,**不改变任何优先级语义**,也绝不自动清值。
 */

/** 体检只需要这几个字段(与 GatewayApp / GatewayProvider 结构兼容) */
export interface AuditAppLike {
  id: string
  name?: string
  providerId: string
  model: string
}

export interface AuditProviderLike {
  id: string
  name?: string
  model: string
  models: string[]
}

export type AuditIssueKind =
  /** 应用的固定模型不在其绑定密钥的模型列表里(仍会生效并覆盖请求值) */
  | 'app-model-stale'
  /** 应用绑定的密钥已不存在(会回落到默认/按模型匹配) */
  | 'app-provider-missing'
  /** 密钥的默认模型不在它自己的模型列表里 */
  | 'provider-model-stale'

export interface GatewayAuditIssue {
  kind: AuditIssueKind
  /** 出问题的对象 id(应用或密钥) */
  subjectId: string
  subjectName: string
  /** 那个"隐形"的模型值 */
  model: string
  /** 应用侧才有:它绑定的密钥 */
  providerId?: string
  providerName?: string
  message: string
}

/** 模型是否在当前密钥的列表里(空列表视为"不校验",避免新密钥刚建就报一堆) */
export function isModelInList(models: readonly string[] | undefined, model: string): boolean {
  if (!model) return true
  if (!models || models.length === 0) return true
  return models.includes(model)
}

/**
 * 下拉候选项:**当前值优先并进来**,保证"存着但不在列表里"的值能被看见。
 * @returns options 给 Mantine Select 的 data;stale=true 表示当前值已失效
 */
export function modelOptions(
  models: readonly string[] | undefined,
  current: string,
): { options: string[]; stale: boolean } {
  const list = Array.from(new Set((models ?? []).filter(Boolean)))
  const value = (current ?? '').trim()
  if (!value) return { options: list, stale: false }
  if (list.includes(value)) return { options: list, stale: false }
  return { options: [value, ...list], stale: true }
}

/** 体检:返回所有"看着空 / 其实有值"与"绑定失效"的问题(顺序稳定,便于展示与测试) */
export function auditGatewayConfig(input: {
  apps: readonly AuditAppLike[]
  providers: readonly AuditProviderLike[]
}): GatewayAuditIssue[] {
  const providers = input.providers ?? []
  const apps = input.apps ?? []
  const byId = new Map(providers.map((p) => [p.id, p]))
  const issues: GatewayAuditIssue[] = []

  for (const p of providers) {
    const name = p.name || p.id
    if (!isModelInList(p.models, p.model)) {
      issues.push({
        kind: 'provider-model-stale',
        subjectId: p.id,
        subjectName: name,
        model: p.model,
        message: `密钥「${name}」的默认模型 ${p.model} 不在它的模型列表里 —— 它仍会覆盖请求里的 model`,
      })
    }
  }

  for (const a of apps) {
    const name = a.name || a.id
    if (!a.providerId) continue
    const p = byId.get(a.providerId)
    if (!p) {
      issues.push({
        kind: 'app-provider-missing',
        subjectId: a.id,
        subjectName: name,
        model: a.model,
        providerId: a.providerId,
        message: `应用「${name}」绑定的密钥 ${a.providerId} 已不存在 —— 会回落到默认密钥/按模型匹配`,
      })
      continue
    }
    if (!isModelInList(p.models, a.model)) {
      issues.push({
        kind: 'app-model-stale',
        subjectId: a.id,
        subjectName: name,
        model: a.model,
        providerId: p.id,
        providerName: p.name || p.id,
        message: `应用「${name}」的固定模型 ${a.model} 不在密钥「${p.name || p.id}」的模型列表里 —— 它仍会生效并覆盖请求里的 model`,
      })
    }
  }

  return issues
}
