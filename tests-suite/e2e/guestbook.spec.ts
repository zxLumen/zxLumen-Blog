import { test, expect } from '@playwright/test'

test('发表公开留言 → 出现在列表', async ({ page }) => {
  const text = `e2e-留言-${Date.now()}`
  await page.goto('/')
  await page.locator('#gb-author').fill('E2E访客')
  await page.locator('#gb-body').fill(text)
  await page.getByRole('button', { name: '发送留言' }).click()
  await expect(page.locator('.zx-comments')).toContainText(text)
})
