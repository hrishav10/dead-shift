import { chromium } from 'playwright-core'
const exe = process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux/chrome'
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1100, height: 620 } })
page.on('console', m => console.log('[console]', m.type(), m.text().slice(0, 300)))
page.on('pageerror', e => console.log('[pageerror]', e.message.slice(0, 500), '\n', (e.stack || '').slice(0, 600)))
await page.goto('http://localhost:4173', { waitUntil: 'load' })
await page.waitForTimeout(6000)
console.log('loading hidden:', await page.evaluate(() => document.getElementById('loading').classList.contains('hidden')))
console.log('menu hidden:', await page.evaluate(() => document.getElementById('menu').classList.contains('hidden')))
await browser.close()
