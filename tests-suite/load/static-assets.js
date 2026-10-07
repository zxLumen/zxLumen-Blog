/**
 * S7 静态资源:Caddy 直供路径(`/resume.pdf`、`/vlog/<vid>.jpg`、`/apps/<id>.<ext>`)。
 * 本地 dev/next start 下这些文件可能不存在(404),故阈值只要求「不 5xx」;
 * 对线上 Caddy 跑时(`ZX_LOAD_BASE=https://<域名>`)应全 200/304、缓存命中。
 * 可加 `ZX_STATIC_PATHS=/resume.pdf,/vlog/xxx.jpg` 覆盖默认。
 */
import { check, sleep } from 'k6'
import { get } from './lib.js'

const paths = (__ENV.ZX_STATIC_PATHS || '/favicon.ico,/resume.pdf').split(',').map((s) => s.trim()).filter(Boolean)

export const options = {
  scenarios: {
    static_assets: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 200 },
        { duration: '40s', target: 200 },
        { duration: '20s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{scenario:static_assets}': ['p(95)<200'],
  },
}

export default function () {
  for (const p of paths) {
    const r = get(p)
    check(r, { [`static ${p} < 500`]: (x) => x.status < 500 })
  }
  sleep(0.5)
}
