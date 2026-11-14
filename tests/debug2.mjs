import { chromium } from 'playwright-core'
const exe = process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux/chrome'
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 800, height: 450 } })
page.on('pageerror', e => console.log('[pageerror]', e.message.slice(0, 300)))
await page.goto('http://localhost:4173', { waitUntil: 'load' })
await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), null, { timeout: 60000 })
await page.evaluate(() => window.__deadshift.startGame('waves'))
await page.waitForTimeout(3000)
console.log(await page.evaluate(() => ({
  pauseHidden: document.getElementById('pause').classList.contains('hidden'),
  hudHidden: document.getElementById('hud').classList.contains('hidden'),
  wave: window.__deadshift.wave, state: window.__deadshift.waveState,
  zombies: window.__deadshift.zombies.length,
  lockEl: !!document.pointerLockElement
})))
await page.evaluate(() => window.__deadshift.spawnZombie('walker', window.__deadshift.player.pos.clone().add(new (Object.getPrototypeOf(window.__deadshift.player.pos).constructor)(5, 0, 5))))
await page.waitForTimeout(1500)
console.log('after manual spawn:', await page.evaluate(() => window.__deadshift.zombies.length))
await browser.close()
