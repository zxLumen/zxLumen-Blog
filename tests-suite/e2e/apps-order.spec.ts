import { test, expect, type Browser, type Page } from '@playwright/test'

/**
 * 应用栏顺序:站长拖一次 = 所有人的默认顺序真的变了。
 *
 * 覆盖三条链路:
 *  1. 站长在首页应用栏直接拖 → 立刻 POST /api/admin/apps/reorder(不用去面板点保存)
 *  2. 没自定义过顺序的访客,刷新就看到新顺序
 *  3. 自定义过顺序的访客:版本不一致(站长后来改过)→ 旧存档作废;版本一致 → 保留
 *  4. 面板「保存」路径(整表 POST)同样会升版本
 */

const SEED = ['a', 'b', 'c', 'd'].map((c) => ({
  id: `ord-${c}`,
  name: c.toUpperCase(),
  url: `https://example.com/${c}`,
  openIn: 'newtab',
}))

const ids = SEED.map((a) => a.id)
const KEY = 'zx_apps.order'
const REV_KEY = 'zx_apps.order.rev'

const dockOrder = (page: Page) =>
  page.$$eval('.zx-appdock-item', (els) => els.map((e) => e.getAttribute('data-app-id')))

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
  }, SEED)
  expect(ok).toBeTruthy()
}

const serverOrder = (page: Page) =>
  page.evaluate(async () => {
    const r = await fetch('/api/admin/apps')
    const d = (await r.json()) as { apps: { id: string; deleted?: boolean }[] }
    return d.apps.filter((a) => !a.deleted).map((a) => a.id)
  })

const revOf = (page: Page) =>
  page.evaluate(async () => {
    const r = await fetch('/api/admin/apps')
    const d = (await r.json()) as { rev?: number }
    return d.rev ?? 0
  })

/** 用 reorder 接口换一次顺序,返回新版本号 */
async function reorder(page: Page, order: string[]): Promise<number> {
  const rev = await page.evaluate(async (o) => {
    const r = await fetch('/api/admin/apps/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: o }),
    })
    const d = (await r.json()) as { rev?: number }
    return d.rev ?? 0
  }, order)
  expect(rev).toBeGreaterThan(0)
  return rev
}

/** 不带任何会话的访客,并预置一份本机顺序 */
async function visitor(browser: Browser, order?: string[], rev?: number) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  if (order) {
    await ctx.addInitScript(
      ({ k, rk, o, r }) => {
        localStorage.setItem(k, JSON.stringify(o))
        if (r !== undefined) localStorage.setItem(rk, String(r))
      },
      { k: KEY, rk: REV_KEY, o: order, r: rev },
    )
  }
  const page = await ctx.newPage()
  await page.goto('/')
  await expect(page.locator('.zx-appdock')).toBeVisible()
  return page
}

test.describe('站长拖应用栏 = 改所有人的默认顺序', () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  test('拖完立即落库,访客刷新即见新顺序', async ({ page, browser }) => {
    await login(page)
    await seed(page)
    await page.goto('/')
    await expect(page.locator('.zx-appdock')).toBeVisible()

    const a = (await page.locator(`.zx-appdock-item[data-app-id="${ids[0]}"]`).boundingBox())!
    const c = (await page.locator(`.zx-appdock-item[data-app-id="${ids[2]}"]`).boundingBox())!

    // 把第 1 个拖到第 3 个的下半侧 → a 落到 c 后面
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(c.x + c.width / 2, c.y + c.height * 0.85, { steps: 12 })
    await page.mouse.up()

    await expect
      .poll(() => serverOrder(page), { timeout: 8000 })
      .toEqual([ids[1], ids[2], ids[0], ids[3]])
    await expect(page.locator('.zx-appdock-toast')).toContainText('所有访客')

    // 访客(无本机顺序)看到的就是新顺序
    const v = await visitor(browser)
    expect(await dockOrder(v)).toEqual([ids[1], ids[2], ids[0], ids[3]])
    await v.context().close()
  })

  test('旧版本的本机顺序作废,同版本的保留', async ({ page, browser }) => {
    await login(page)
    await seed(page)
    // 站长把默认顺序改成 d,c,b,a(版本 +1)
    const rev = await reorder(page, [ids[3], ids[2], ids[1], ids[0]])

    // 版本对得上 → 访客自己的顺序继续生效
    const same = await visitor(browser, [ids[1], ids[0], ids[2], ids[3]], rev)
    expect(await same.locator('.zx-appdock').getAttribute('data-apps-rev')).toBe(String(rev))
    expect(await dockOrder(same)).toEqual([ids[1], ids[0], ids[2], ids[3]])
    await same.context().close()

    // 版本过期 → 丢弃存档,回到站长默认
    const stale = await visitor(browser, [ids[1], ids[0], ids[2], ids[3]], rev - 1)
    expect(await dockOrder(stale)).toEqual([ids[3], ids[2], ids[1], ids[0]])
    const saved = await stale.evaluate((k) => localStorage.getItem(k))
    expect(saved).toBeNull()
    await stale.context().close()
  })

  test('admin 面板:只改名不重置访客顺序,换序才升版本', async ({ page, browser }) => {
    await login(page)
    await seed(page)
    const rev0 = await revOf(page)

    // 1) 只改名称、顺序不动 → 版本不变,访客的自定义顺序照旧
    const sameRev = await page.evaluate(async (apps) => {
      const r = await fetch('/api/admin/apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apps }),
      })
      const d = (await r.json()) as { rev?: number }
      return d.rev
    }, SEED.map((a) => ({ ...a, name: `${a.name}!` })))
    expect(sameRev === undefined || sameRev === rev0).toBeTruthy()
    expect(await revOf(page)).toBe(rev0)

    const keep = await visitor(browser, [ids[1], ids[0], ids[2], ids[3]], rev0)
    expect(await dockOrder(keep)).toEqual([ids[1], ids[0], ids[2], ids[3]])
    await keep.context().close()

    // 2) 换序保存 → 版本 +1,访客那份旧顺序作废
    await page.evaluate(async (apps) => {
      await fetch('/api/admin/apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apps }),
      })
    }, [SEED[3], SEED[0], SEED[1], SEED[2]])

    expect(await serverOrder(page)).toEqual([ids[3], ids[0], ids[1], ids[2]])
    expect(await revOf(page)).toBe(rev0 + 1)

    const v = await visitor(browser, [ids[1], ids[0], ids[2], ids[3]], rev0)
    expect(await dockOrder(v)).toEqual([ids[3], ids[0], ids[1], ids[2]])
    await v.context().close()
  })
})
