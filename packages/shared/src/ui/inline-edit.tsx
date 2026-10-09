'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** 深比较(仅用于判断草稿是否改动;结构与内容都稳定可控) */
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

export interface Editable<T> {
  /** 当前显示值(始终以它渲染,保存后即为最新) */
  value: T
  setValue: (updater: T | ((v: T) => T)) => void
  baseline: T
  editing: boolean
  saving: boolean
  error: string | null
  dirty: boolean
  /** 进入编辑态(以已保存值为起点) */
  start: () => void
  /** 放弃并退出 */
  cancel: () => void
  /** 提交:成功后把当前值固化为新基线并退出 */
  commit: () => Promise<void>
}

/**
 * 每个区块各自持有一份「草稿 → 保存」状态机,互不干扰。
 * 保存成功后不刷新页面:把当前值固化为新基线,所见即所存。
 */
export function useEditable<T>(initial: T, save: (value: T) => Promise<void>): Editable<T> {
  const [value, setValueState] = useState<T>(initial)
  const [baseline, setBaseline] = useState<T>(initial)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setValue = useCallback((updater: T | ((v: T) => T)) => {
    setValueState((prev) => (typeof updater === 'function' ? (updater as (v: T) => T)(prev) : updater))
    setError(null)
  }, [])

  const start = useCallback(() => {
    setValueState(baseline)
    setError(null)
    setEditing(true)
  }, [baseline])

  const cancel = useCallback(() => {
    setValueState(baseline)
    setError(null)
    setEditing(false)
  }, [baseline])

  const commit = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      await save(value)
      setBaseline(value)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }, [save, value])

  return {
    value,
    setValue,
    baseline,
    editing,
    saving,
    error,
    dirty: !same(value, baseline),
    start,
    cancel,
    commit,
  }
}

/** 自适应高度的多行输入(随内容长高,不出现滚动条) */
export function AutoTextarea({
  value,
  onChange,
  placeholder,
  className,
  ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  ariaLabel?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const fit = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])
  useEffect(fit, [value, fit])
  return (
    <textarea
      ref={ref}
      className={`zx-inline zx-inline-area${className ? ` ${className}` : ''}`}
      value={value}
      rows={1}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      onInput={fit}
    />
  )
}

/**
 * 就地文本编辑:平时就是普通文本(由调用方决定排版),
 * 编辑时渲染成**与所在模块字体/颜色完全一致**的无边框输入,只在聚焦处显出一条强调线。
 */
export function InlineText({
  value,
  onChange,
  multiline,
  placeholder,
  className,
  ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  multiline?: boolean
  placeholder?: string
  className?: string
  ariaLabel?: string
}) {
  if (multiline) {
    return (
      <AutoTextarea value={value} onChange={onChange} placeholder={placeholder} className={className} ariaLabel={ariaLabel} />
    )
  }
  return (
    <input
      type="text"
      className={`zx-inline${className ? ` ${className}` : ''}`}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

/**
 * 统一的编辑控件:
 *  - 非编辑态:一个低调的铅笔按钮(悬停才明显);
 *  - 编辑态:取消 / 保存,附保存中与错误提示,未改动时保存禁用。
 */
export function EditControls({
  editing,
  dirty,
  saving,
  error,
  onStart,
  onCancel,
  onSave,
  label = '编辑',
  align = 'end',
}: {
  editing: boolean
  dirty: boolean
  saving: boolean
  error: string | null
  onStart: () => void
  onCancel: () => void
  onSave: () => void
  label?: string
  align?: 'end' | 'start'
}) {
  if (!editing) {
    return (
      <button type="button" className="zx-edit-btn" onClick={onStart} title={label} aria-label={label}>
        <PencilIcon />
      </button>
    )
  }
  return (
    <span className={`zx-edit-actions${align === 'start' ? ' is-start' : ''}`}>
      {error && <span className="zx-edit-error">{error}</span>}
      <button type="button" className="zx-edit-chip" onClick={onCancel} disabled={saving}>
        取消
      </button>
      <button
        type="button"
        className="zx-edit-chip is-primary"
        onClick={onSave}
        disabled={saving || !dirty}
      >
        {saving ? '保存中…' : dirty ? '保存' : '已保存'}
      </button>
    </span>
  )
}
