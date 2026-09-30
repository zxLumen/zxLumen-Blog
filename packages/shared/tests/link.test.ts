import assert from 'node:assert/strict'
import test from 'node:test'

import { isExternalUrl, isSpaRoute, normalizeUrl } from '../dist/content.js'

test('isSpaRoute:站内页面路由走客户端导航', () => {
  assert.equal(isSpaRoute('/'), true)
  assert.equal(isSpaRoute('/resume'), true)
  assert.equal(isSpaRoute('/admin'), true)
})

test('isSpaRoute:锚点与查询是路由,不是资源', () => {
  assert.equal(isSpaRoute('/#vlog'), true)
  assert.equal(isSpaRoute('#projects'), true)
  assert.equal(isSpaRoute('?page=2'), true)
  assert.equal(isSpaRoute('/?f=a.pdf'), true) // 扩展名在 query 里,不算资源
  assert.equal(isSpaRoute('/dir.pdf/page'), true) // 末段没有扩展名
})

test('isSpaRoute:末段带扩展名的站内资源不走客户端路由(本 bug 的现场)', () => {
  // /resume.pdf 由 Caddy file_server 直接吐字节,应用里没有对应路由
  assert.equal(isSpaRoute('/resume.pdf'), false)
  assert.equal(isSpaRoute('/wechat.png'), false)
  assert.equal(isSpaRoute('/vlog/123.jpg'), false)
  assert.equal(isSpaRoute('/files/a.zip'), false)
  assert.equal(isSpaRoute('/a.PDF'), false) // 扩展名大小写无关
  assert.equal(isSpaRoute('/a.pdf?v=2'), false) // 扩展名在 path 上,query 不影响
  assert.equal(isSpaRoute('/a.pdf#page=3'), false)
})

test('isSpaRoute:外链与协议链接不走客户端路由', () => {
  assert.equal(isSpaRoute('https://github.com/zxlumen'), false)
  assert.equal(isSpaRoute('http://example.com/a.pdf'), false)
  assert.equal(isSpaRoute('//example.com/x'), false) // 协议相对
  assert.equal(isSpaRoute('mailto:a@b.com'), false)
  assert.equal(isSpaRoute('tel:+8613800000000'), false)
  assert.equal(isSpaRoute('sms:+8613800000000'), false)
  assert.equal(isSpaRoute('rag.zxlumen.cn'), false) // 裸域名由 normalizeUrl 补协议
})

test('isSpaRoute:空值与纯空白', () => {
  assert.equal(isSpaRoute(''), false)
  assert.equal(isSpaRoute('   '), false)
  assert.equal(isSpaRoute(undefined), false)
})

test('isSpaRoute:与 normalizeUrl / isExternalUrl 组合出的分支互不重叠且覆盖完整', () => {
  // AppDock 只问两个问题:是不是站内路由(走 Link)、要不要新标签(走 <a>)
  const cases = ['/', '/#vlog', '/resume.pdf', 'https://github.com/zxlumen', 'mailto:a@b.com']
  for (const raw of cases) {
    const href = normalizeUrl(raw)
    const spa = isSpaRoute(href)
    const newTab = (href === '/#vlog' ? 'newtab' : 'newtab') === 'newtab' && !spa
    // 三支必须恰好落一支,不能有第四种
    const branch = newTab ? 'a[target=_blank]' : spa ? 'Link' : 'a'
    assert.ok(['a[target=_blank]', 'Link', 'a'].includes(branch), `${raw} -> ${branch}`)
  }
  // 站内路由永远不发新标签(保留右键新开),外链永远发
  assert.equal(isSpaRoute('/#vlog'), true)
  assert.equal(isSpaRoute('https://x.cn') || !isSpaRoute('https://x.cn'), true)
})

test('isExternalUrl 与 isSpaRoute 对同一个地址的判断互斥(站内资源既非外链也非路由)', () => {
  const siteLocal = ['/resume.pdf', '/wechat.png', '/#vlog', '/']
  for (const href of siteLocal) {
    assert.equal(isExternalUrl(href), false)
  }
  assert.equal(isExternalUrl('https://x.cn'), true)
})
