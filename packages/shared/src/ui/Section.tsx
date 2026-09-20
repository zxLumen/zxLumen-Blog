'use client'

interface SectionProps {
  id?: string
  tag: string
  num?: string
  title: string
  children: React.ReactNode
}

export function Section({ id, tag, num, title, children }: SectionProps) {
  return (
    <section className="zx-section" id={id}>
      <div className="zx-container">
        <div className="zx-sec-head">
          <span className="zx-sec-tag" data-num={num}>
            {tag}
          </span>
          <h2 className="zx-sec-title">{title}</h2>
        </div>
        {children}
      </div>
    </section>
  )
}
