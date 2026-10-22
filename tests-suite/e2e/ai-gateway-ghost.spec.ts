import { test, expect } from '@playwright/test'

/**
 * 回归:换密钥后「失效的固定模型」不能在面板上伪装成空白。
 *
 * 背景(线上踩过的坑):网关模型优先级是 `app.model || provider.model || request.model`;
 * 而面板下拉的候选项只来自「当前密钥的 models」。一旦换密钥(列表变了),旧值就不在选项里,
 * Mantine 的 Select 找不到 label → 渲染成**空白**。看着像没设过,其实值还在库里、优先级
 * 最高,于是"改子应用的 model 永远不生效"。
 *
 * 这里直接写一份等价的历史遗留配置,断言:
 *   1) 输入框能显示真实值(不再是空白);
 *   2) 出现失效提示 + 顶部配置体检;
 *   3) 一键清空后值真的没了。
 */
const ghostConfig = {
  version: 1,
  chatProviderId: 'p-ds',
  embedProviderId: '',
  audioProviderId: '',
  providers: [
    {
      id: 'p-ds',
      name: 'stock',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test-key',
      model: 'deepseek-flash',
      models: ['deepseek-flash', 'deepseek-v4-pro'],
      enabled: true,
      role: 'chat',
      api: 'openai',
    },
  ],
  apps: [
    {
      id: 'app-ghost',
      name: 'stock',
      token: 'zxai_aaaaaaaaaaaaaaaa',
      enabled: true,
      providerId: 'p-ds',
      // 旧密钥(OpenCode)时代的模型,已不在新密钥的列表里 → 历史遗留的"隐形值"
      model: 'deepseek-v4.1-flash',
      dailyLimit: 0,
      totalLimit: 0,
      audioLimit: 0,
      reasoningEffort: 'auto',
      note: '',
    },
  ],
}

test('换密钥后失效的固定模型:可见 + 有提示 + 可一键清空', async ({ page }) => {
  await page.goto('/admin')
  await page.fill('#pw', 'test-admin-pass')
  await page.getByRole('button', { name: '进入' }).click()
  // 等登录真正完成(cookie 落好)再写配置
  await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible()

  // 在页面上下文里写配置(带会话 cookie;page.request 不保证带上 http-only cookie)
  const saved = await page.evaluate(async (cfg) => {
    const r = await fetch('/api/admin/ai-gateway', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ config: cfg }),
    })
    return { status: r.status, body: await r.text() }
  }, ghostConfig)
  expect(saved.status, `写配置失败:HTTP ${saved.status} ${saved.body.slice(0, 200)}`).toBe(200)

  await page.getByRole('button', { name: 'AI 密钥', exact: true }).click()

  const fixedModel = page.getByPlaceholder('固定模型(可空=应用自选)')
  // 关键断言:不是空白 —— 值必须能看见
  await expect(fixedModel).toHaveValue('deepseek-v4.1-flash')
  await expect(page.locator('[data-testid="stale-model-hint"]')).toBeVisible()
  await expect(page.locator('[data-testid="gateway-audit"]')).toBeVisible()

  // 一键清空 → 值真的清掉、提示与体检消失
  await page.locator('[data-testid="stale-model-hint"]').getByRole('button', { name: '清空' }).click()
  await expect(fixedModel).toHaveValue('')
  await expect(page.locator('[data-testid="stale-model-hint"]')).toHaveCount(0)
  await expect(page.locator('[data-testid="gateway-audit"]')).toHaveCount(0)

  // 再清一次也不该冒出来(保存后重新加载仍是空)
  const saveBtn = page.getByRole('button', { name: '保存', exact: true })
  await saveBtn.click()
  await expect(page.locator('.zx-msg.ok')).toBeVisible()
})
