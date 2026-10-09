import { test, expect, type Page } from '@playwright/test'

/**
 * 应用栏手势:
 *  - 触屏(窄屏底部横排):横扫 = 滚动;长按 400ms = 进入拖动排序;轻点 = 打开。
 *  - 鼠标(桌面右侧竖排):越过阈值立即拖动(原行为,不受长按影响)。
 *
 * 触屏拖动没法用 page.mouse(那只有 pointerType:'mouse'),这里直接派发合成
 * PointerEvent(pointerType:'touch');因为条目上是 touch-action:none、且长按模式
 * 下滚动由 hook 自管(不依赖原生 touch 滚动),合成 pointer 事件足以覆盖整条逻辑。
 */

const APP_SEED = 'abcdefghij'.split('').map((c) => ({
  id: `e2e-${c}`,
  name: c.toUpperCase(),
  url: `https://example.com/${c}`,
  openIn: 'newtab',
}))

const KEY = 'zx_apps.order'

const dock = (page: Page) => page.locator('.zx-appdock')
const item = (page: Page, id: string) => page.locator(`.zx-appdock-item[data-app-id="${id}"]`)

async function login(page: Page) {
  await page.goto('/admin')
  await page.fill('#pw', 'test-admin-pass')
  await page.getByRole('button', { name: '进入' }).click()
  await page.getByRole('button', { name: '退出登录' }).waitFor()
}

async function seed(page: Page) {
  const ok = await page.evaluate(async (apps) => {
    const r = await fetch('/api/admin/apps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apps }),
    })
    return r.ok
  }, APP_SEED)
  expect(ok).toBeTruthy()
}

const savedOrder = (page: Page) =>
  page.evaluate((k) => {
    try {
      const raw = localStorage.getItem(k)
      return raw ? (JSON.parse(raw) as string[]) : null
    } catch {
      return null
    }
  }, KEY)

/** 在某个条目上派发一次触屏 pointer 事件 */
async function tap(
  page: Page,
  id: string,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  x: number,
  y: number,
) {
  await item(page, id).evaluate(
    (node, a) => {
      node.dispatchEvent(
        new PointerEvent(a.type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: 1,
          pointerType: 'touch',
          isPrimary: true,
          button: 0,
          buttons: a.type === 'pointerup' ? 0 : 1,
          clientX: a.x,
          clientY: a.y,
        }),
      )
    },
    { type, x, y },
  )
}

const center = (b: { x: number; y: number; width: number; height: number }) => ({
  x: b.x + b.width / 2,
  y: b.y + b.height / 2,
})

test.describe('手机端(窄屏底栏,触屏)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test.beforeEach(async ({ page }) => {
    await login(page)
    await seed(page)
    await page.goto('/')
    await expect(dock(page)).toBeVisible()
    await expect(item(page, 'e2e-a')).toBeVisible()
  })

  test('横扫 = 滚动应用栏,不触发排序', async ({ page }) => {
    const b = (await item(page, 'e2e-a').boundingBox())!
    const c = center(b)

    await tap(page, 'e2e-a', 'pointerdown', c.x, c.y)
    await tap(page, 'e2e-a', 'pointermove', c.x - 60, c.y)
    await tap(page, 'e2e-a', 'pointerup', c.x - 60, c.y)

    const scrollLeft = await dock(page).evaluate((n) => n.scrollLeft)
    expect(scrollLeft).toBeGreaterThan(0)
    expect(await savedOrder(page)).toBeNull()
  })

  test('长按进入拖动:松手后顺序落盘', async ({ page }) => {
    const a = center((await item(page, 'e2e-a').boundingBox())!)
    const cb = (await item(page, 'e2e-c').boundingBox())!

    await tap(page, 'e2e-a', 'pointerdown', a.x, a.y)
    await page.waitForTimeout(460)
    await tap(page, 'e2e-a', 'pointermove', cb.x + cb.width * 0.8, cb.y + cb.height / 2)
    await tap(page, 'e2e-a', 'pointerup', cb.x + cb.width * 0.8, cb.y + cb.height / 2)

    const order = await savedOrder(page)
    expect(order).toBeTruthy()
    expect(order![0]).toBe('e2e-b')
    expect(order![2]).toBe('e2e-a')
  })

  test('轻点仍照常打开应用', async ({ page }) => {
    const b = (await item(page, 'e2e-a').boundingBox())!
    const c = center(b)
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.touchscreen.tap(c.x, c.y),
    ])
    expect(popup).toBeTruthy()
    expect(await savedOrder(page)).toBeNull()
  })
})

test.describe('桌面端(右侧竖排,鼠标)', () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  test('鼠标越过阈值立即拖动(长按不生效)', async ({ page }) => {
    await login(page)
    await seed(page)
    await page.goto('/')
    await expect(dock(page)).toBeVisible()

    const a = (await item(page, 'e2e-a').boundingBox())!
    const cb = (await item(page, 'e2e-c').boundingBox())!
    const ac = center(a)

    await page.mouse.move(ac.x, ac.y)
    await page.mouse.down()
    await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height * 0.85, { steps: 12 })
    await page.mouse.up()

    const order = await savedOrder(page)
    expect(order).toBeTruthy()
    expect(order![0]).toBe('e2e-b')
    expect(order![2]).toBe('e2e-a')
  })
})
