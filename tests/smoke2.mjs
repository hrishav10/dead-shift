import { chromium } from 'playwright-core'
import fs from 'node:fs'
const exe = process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux/chrome'
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 880, height: 495 } })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message.slice(0, 300)))
const cdp = await page.context().newCDPSession(page)
async function shot(path) { try { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path, Buffer.from(data, 'base64')) } catch (e) { console.log('shot failed', e.message) } }
await page.goto('http://localhost:4173', { waitUntil: 'load' })
await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), null, { timeout: 60000 })
// start waves via debug hook (pointer lock unavailable headless)
await page.evaluate(() => window.__deadshift.startGame('waves'))
await page.waitForTimeout(6000)
const waveInfo = await page.evaluate(() => ({ wave: window.__deadshift.wave, state: window.__deadshift.waveState, zombies: window.__deadshift.zombies.length, banner: document.getElementById('wave-banner').textContent }))
await shot('shots/factory-waves.png')
// club interior
await page.evaluate(() => window.__deadshift.teleport(138, 50, -Math.PI / 2))
await page.waitForTimeout(2500)
await shot('shots/club.png')
const zone = await page.evaluate(() => document.getElementById('zone-name').textContent)
// factory interior view from mezzanine side
await page.evaluate(() => window.__deadshift.teleport(-50, -160, 0))
await page.waitForTimeout(2000)
await shot('shots/factory-inside.png')
// driving: teleport next to a parked car and press E is hard without lock; check car count instead
const carCount = await page.evaluate(() => window.__deadshift.cars.length)
console.log(JSON.stringify({ waveInfo, zone, carCount, errors }, null, 1))
await browser.close()
