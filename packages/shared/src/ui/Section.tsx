'use client'

import { useEditable, EditControls, InlineText, type Editable } from './inline-edit.js'
import { useSiteContentSaver } from './SiteContentSaver.js'
import type { SectionHeader } from './site-edit-types.js'

type SectionKey = 'projects' | 'usage' | 'about' | 'guestbook'

/** 区块小标题的独立「编辑 → 保存」状态(存 site_content.SECTIONS) */
export function useSectionHeader(
  sectionKey: SectionKey,
  fallback: { tag: string; title: string },
  sectionHeader?: SectionHeader,
): Editable<{ tag: string; title: string }> {
  const saver = useSiteContentSaver()
  return useEditable(
    { tag: sectionHeader?.tag ?? fallback.tag, title: sectionHeader?.title ?? fallback.title },
    async (v) => {
      if (!saver) throw new Error('保存未就绪')
      await saver.saveContent({ SECTIONS: { [sectionKey]: v } })
    },
  )
}

interface SectionProps {
  id?: string
  tag: string
  num?: string
  title: string
  children: React.ReactNode
  /** 站长传入:小标题就地编辑(否则不显示编辑控件) */
  edit?: Editable<{ tag: string; title: string }>
}

export function Section({ id, tag, num, title, children, edit }: SectionProps) {
  const editing = !!edit?.editing
  const shownTag = edit?.value.tag ?? tag
  const shownTitle = edit?.value.title ?? title
  return (
    <section className="zx-section" id={id}>
      <div className="zx-container">
        <div className="zx-sec-head">
          <span className="zx-sec-tag" data-num={num}>
            {editing ? (
              <InlineText
                value={shownTag}
                onChange={(v) => edit!.setValue((p) => ({ ...p, tag: v }))}
                ariaLabel="区块标记"
              />
            ) : (
              shownTag
            )}
          </span>
          {editing ? (
            <h2 className="zx-sec-title">
              <InlineText
                value={shownTitle}
                onChange={(v) => edit!.setValue((p) => ({ ...p, title: v }))}
                ariaLabel="区块标题"
              />
            </h2>
          ) : (
            <h2 className="zx-sec-title">{shownTitle}</h2>
          )}
          {edit && (
            <span className="zx-sec-edit">
              <EditControls
                editing={edit.editing}
                dirty={edit.dirty}
                saving={edit.saving}
                error={edit.error}
                onStart={edit.start}
                onCancel={edit.cancel}
                onSave={edit.commit}
                label="编辑区块标题"
              />
            </span>
          )}
        </div>
        {children}
      </div>
    </section>
  )
}
