import { test, expect, type Page } from '@playwright/test'

/**
 * 应用栏预览：
 *  - 桌面：hover 220ms 出预览卡（截图 + 名称 + 一句话 + 打开）
 *  - 点击图标：先出预览浮层，浮层里再点「打开应用」才按原 openIn 进入
 *  - 390px 移动端：单击出预览、0 横向溢出、0 console error
 */

const GITHUB = { id: 'github', name: 'GitHub', url: 'https://github.com/zxlumen', openIn: 'newtab' }
const LUMINARI = {
  id: 'luminari',
  name: '生灵',
  url: 'https://example.com/',
  openIn: 'panel',
}

const dock = (page: Page) => page.locator('.zx-appdock')
const item = (page: Page, id: string) => page.locator(`.zx-appdock-item[data-app-id="${id}"]`)

async function login(page: Page) {
  await page.goto('/admin')
  await page.fill('#pw', 'test-admin-pass')
  await page.getByRole('button', { name: '进入' }).click()
  await page.getByRole('button', { name: '退出登录' }).waitFor()
}

async function seed(page: Page, apps: unknown[]) {
  const ok = await page.evaluate(async (list) => {
    const r = await fetch('/api/admin/apps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apps: list }),
    })
    return r.ok
  }, apps)
  expect(ok).toBeTruthy()
}

/** 等 manifest 拉完再交互，避免测试跑在预览清单前面 */
async function gotoHome(page: Page) {
  const manifest = page.waitForResponse((r) => r.url().includes('/apps/shots/manifest.json'))
  await page.goto('/')
  await manifest
  await expect(dock(page)).toBeVisible()
}

test.describe('桌面 1280×800', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('hover 220ms 出预览卡', async ({ page }) => {
    await login(page)
    await seed(page, [GITHUB])
    await gotoHome(page)

    const card = page.locator('.zx-apppreview-hover')
    await item(page, 'github').hover()
    await page.waitForTimeout(120)
    await expect(card).not.toBeVisible()
    await expect(card).toBeVisible()
    await expect(card.locator('.zx-apppreview-name')).toHaveText('GitHub')
    await expect(card.locator('.zx-apppreview-intro')).not.toBeEmpty()
    await expect(card.locator('.zx-apppreview-shot img')).toHaveAttribute(
      'src',
      '/apps/shots/github.webp',
    )
    await expect(card.getByRole('link', { name: '打开' })).toBeVisible()
  })

  test('点击先开预览浮层，再从浮层打开 panel 应用', async ({ page }) => {
    await page.route('https://example.com/**', (route) => route.abort())
    await login(page)
    await seed(page, [LUMINARI])
    await gotoHome(page)

    await item(page, 'luminari').click()
    const dialog = page.getByRole('dialog', { name: '生灵 应用预览' })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.zx-apppreview-shot img')).toHaveAttribute(
      'src',
      '/apps/shots/luminari.webp',
    )
    // 点击图标本身不跳转
    await expect(page).toHaveURL(/\/$/)

    await dialog.getByRole('button', { name: '打开应用' }).click()
    await expect(dialog).not.toBeVisible()
    await expect(page.locator('.zx-apppanel[data-active]')).toBeVisible()
  })
})

test.describe('移动端 390px', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('单击出预览、0 横向溢出、0 console error', async ({ page }) => {
    await login(page)
    await seed(page, [GITHUB])
    await gotoHome(page)
    // admin 页 / 访客首屏的既有 401、缺失图标 404 不算预览产生的错误；
    // 先让首页稳定下来，再只统计「点开预览」这段交互。
    await page.waitForTimeout(600)
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`${msg.text()} @ ${msg.location().url}`)
    })
    page.on('pageerror', (err) => errors.push(err.message))
    page.on('response', (r) => {
      if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`)
    })

    await item(page, 'github').tap()
    const dialog = page.getByRole('dialog', { name: 'GitHub 应用预览' })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.zx-apppreview-open')).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    expect(errors).toEqual([])
  })
})
