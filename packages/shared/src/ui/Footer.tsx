'use client'

import { PROFILE, type Contacts } from '../content.js'
import { ContactActions } from './ContactActions.js'

export function Footer({ contacts, name, handle }: { contacts?: Contacts; name?: string; handle?: string }) {
  const year = new Date().getFullYear()
  return (
    <footer className="zx-footer">
      <div className="zx-footer-in">
        <span>
          © {year} {name ?? PROFILE.name} · {handle ?? PROFILE.handle}
        </span>
        <span className="zx-footer-contact">
          <span className="zx-muted">联系:</span> <ContactActions contacts={contacts} variant="compact" />
        </span>
        <span className="zx-muted">
          built with <span className="zx-accent">React</span> · self-hosted
        </span>
      </div>
    </footer>
  )
}
