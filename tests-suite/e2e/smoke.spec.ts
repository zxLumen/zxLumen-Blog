import { test, expect } from '@playwright/test'

test('首页 → 200 且主体/留言板渲染', async ({ page }) => {
  const res = await page.goto('/')
  expect(res?.status()).toBe(200)
  await expect(page.locator('.zx-container').first()).toBeVisible()
  await expect(page.locator('#guestbook')).toBeVisible()
})

test('/api/health → 200 ok', async ({ request }) => {
  const r = await request.get('/api/health')
  expect(r.status()).toBe(200)
  expect((await r.json()).status).toBe('ok')
})

test('未知路由 → 404', async ({ request }) => {
  const r = await request.get('/definitely-not-a-real-page-xyz')
  expect(r.status()).toBe(404)
})
