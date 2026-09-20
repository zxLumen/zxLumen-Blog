'use client'

import { PROFILE } from '../content.js'
import { ContactActions } from './ContactActions.js'

export function Footer() {
  const year = new Date().getFullYear()
  return (
    <footer className="zx-footer">
      <div className="zx-footer-in">
        <span>
          © {year} {PROFILE.name} · {PROFILE.handle}
        </span>
        <span className="zx-footer-contact">
          <span className="zx-muted">联系:</span> <ContactActions variant="compact" />
        </span>
        <span className="zx-muted">
          built with <span className="zx-accent">React</span> · self-hosted
        </span>
      </div>
    </footer>
  )
}
