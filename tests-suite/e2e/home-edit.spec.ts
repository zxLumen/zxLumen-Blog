import { test, expect, type Page } from '@playwright/test'

/** 以站长身份登录 */
async function login(page: Page) {
  await page.goto('/admin')
  await page.fill('#pw', 'test-admin-pass')
  await page.getByRole('button', { name: '进入' }).click()
  await page.getByRole('button', { name: '退出登录' }).waitFor()
}

test('访客:首页没有任何编辑入口', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.zx-edit-btn')).toHaveCount(0)
  await expect(page.locator('.zx-inline')).toHaveCount(0)
})

test('站长:个人资料独立编辑并保存,刷新后仍在', async ({ page }) => {
  await login(page)
  await page.goto('/')

  const hero = page.locator('.zx-hero-edit')
  await hero.locator('.zx-edit-btn').click()
  const nameInput = page.locator('.zx-hero h1 input')
  await expect(nameInput).toBeVisible()
  await nameInput.fill('E2E-名字-01')
  await hero.locator('.zx-edit-chip.is-primary').click()
  await expect(hero.locator('.zx-edit-btn')).toBeVisible()

  await page.reload()
  await expect(page.locator('.zx-hero h1')).toContainText('E2E-名字-01')
})

test('站长:「关于 / 简历」独立编辑并保存状态行', async ({ page }) => {
  await login(page)
  await page.goto('/')

  const block = page.locator('#about .zx-block-edit')
  await block.locator('.zx-edit-btn').click()
  const statusInput = page.locator('#about .zx-kicker input')
  await expect(statusInput).toBeVisible()
  await statusInput.fill('E2E-状态行-01')
  await block.locator('.zx-edit-chip.is-primary').click()

  await page.reload()
  await expect(page.locator('#about .zx-kicker')).toHaveText('E2E-状态行-01')
})

test('站长:区块小标题独立编辑并保存', async ({ page }) => {
  await login(page)
  await page.goto('/')

  const sec = page.locator('#projects .zx-sec-edit')
  await sec.locator('.zx-edit-btn').click()
  const tagInput = page.locator('#projects .zx-sec-head input').first()
  await expect(tagInput).toBeVisible()
  await tagInput.fill('// E2E 项目')
  await sec.locator('.zx-edit-chip.is-primary').click()

  await page.reload()
  await expect(page.locator('#projects .zx-sec-tag')).toHaveText('// E2E 项目')
})

test('站长:单张项目卡片独立编辑并保存', async ({ page }) => {
  await login(page)
  await page.goto('/')

  const card = page.locator('#projects .zx-card').first()
  await card.locator('.zx-card-edit .zx-edit-btn').click()
  const nameInput = card.locator('.zx-card-head input')
  await expect(nameInput).toBeVisible()
  await nameInput.fill('E2E-项目名-01')

  // 新增一条亮点并填写
  await card.locator('.zx-highlights-edit .zx-edit-add').click()
  const rows = card.locator('.zx-highlights-edit .zx-inline-row')
  const last = rows.last()
  await last.locator('input').first().fill('99')
  await last.locator('input').nth(1).fill('E2E指标')

  await card.locator('.zx-card-edit .zx-edit-chip.is-primary').click()

  await page.reload()
  const saved = page.locator('#projects .zx-card').first()
  await expect(saved.locator('.zx-card-head h3')).toHaveText('E2E-项目名-01')
  await expect(saved.locator('.zx-highlight-v').last()).toHaveText('99')
  await expect(saved.locator('.zx-highlight-l').last()).toHaveText('E2E指标')
})
