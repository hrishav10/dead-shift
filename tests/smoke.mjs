import { chromium } from 'playwright-core'
import fs from 'node:fs'
const exe = process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux/chrome'
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 880, height: 495 } })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message.slice(0, 300)))
const cdp = await page.context().newCDPSession(page)
async function shot(path) {
  try { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path, Buffer.from(data, 'base64')) } catch (e) { console.log('shot failed', path, e.message) }
}
const click = (id) => page.evaluate((i) => document.getElementById(i).click(), id)
await page.goto('http://localhost:4173', { waitUntil: 'load' })
await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), null, { timeout: 60000 })
await page.waitForTimeout(2500)
await shot('shots/menu.png')
const menuVisible = await page.evaluate(() => !document.getElementById('menu').classList.contains('hidden'))
await click('btn-roam')
await page.waitForTimeout(4000)
await shot('shots/roam.png')
const state1 = await page.evaluate(() => ({
  hud: !document.getElementById('hud').classList.contains('hidden'),
  cash: document.getElementById('cash').textContent,
  weapon: document.getElementById('weapon-name').textContent,
  ammo: document.getElementById('ammo-mag').textContent
}))
await page.keyboard.press('KeyM')
await page.waitForTimeout(800)
await shot('shots/map.png')
const mapVisible = await page.evaluate(() => !document.getElementById('fullmap').classList.contains('hidden'))
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
await page.keyboard.press('KeyP')
await page.waitForTimeout(800)
await shot('shots/phone.png')
const phoneVisible = await page.evaluate(() => !document.getElementById('phone').classList.contains('hidden'))
const phoneApps = await page.evaluate(() => document.querySelectorAll('.p-app').length)
console.log(JSON.stringify({ menuVisible, state1, mapVisible, phoneVisible, phoneApps, errors }, null, 1))
await browser.close()
