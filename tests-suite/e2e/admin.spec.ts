import { test, expect } from '@playwright/test'

test('/lab/* 未登录 → 重定向 /admin', async ({ page }) => {
  await page.goto('/lab/score')
  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.locator('#pw')).toBeVisible()
})

test('密码错误 → 提示错误、仍停在登录页', async ({ page }) => {
  await page.goto('/admin')
  await page.fill('#pw', 'definitely-wrong')
  await page.getByRole('button', { name: '进入' }).click()
  await expect(page.locator('.zx-msg.err')).toBeVisible()
  await expect(page.locator('#pw')).toBeVisible()
})

test('密码正确 → 进入面板(出现 Tab 与退出)', async ({ page }) => {
  await page.goto('/admin')
  await page.fill('#pw', 'test-admin-pass')
  await page.getByRole('button', { name: '进入' }).click()
  await expect(page.getByRole('button', { name: '留言', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible()
})
