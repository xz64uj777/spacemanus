// End-to-end smoke test for the built Orbital game. Run `pnpm build` first.
// Screenshots and browser-only asset mapping stay local to this check.
import { spawn } from 'node:child_process'
import { readFileSync, mkdirSync } from 'node:fs'
import { resolve, extname } from 'node:path'
import { chromium } from 'playwright'

const project = process.cwd()
const port = 4300 + Math.floor(Math.random() * 500)
const url = `http://127.0.0.1:${port}/`
const out = process.env.SHOTS_DIR ?? 'shots'
mkdirSync(out, { recursive: true })

const lock = JSON.parse(readFileSync(resolve(project, 'assets.lock.json'), 'utf8'))
const registeredStorage = new Map(Object.entries(lock.assets).map(([source, asset]) => [asset.path, resolve(project, source)]))
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' })
let browser
const errors = []
const guard = setTimeout(() => { void fail('timed out') }, 120_000)

function cleanup() {
  clearTimeout(guard)
  try { server.kill('SIGTERM') } catch {}
}
async function fail(message) {
  console.error(`smoke: FAIL — ${message}`)
  await browser?.close().catch(() => {})
  cleanup()
  process.exit(1)
}
async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(url)).ok) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('local built Preview server did not start')
}
async function routeRegisteredAssets(context) {
  await context.route('**/manus-storage/**', async route => {
    const pathname = new URL(route.request().url()).pathname
    const file = registeredStorage.get(pathname)
    if (!file) {
      errors.push(`unregistered storage request: ${pathname}`)
      await route.abort()
      return
    }
    const type = extname(file) === '.png' ? 'image/png' : 'model/gltf-binary'
    await route.fulfill({ path: file, contentType: type })
  })
}
async function openGame(context) {
  await routeRegisteredAssets(context)
  const page = await context.newPage()
  page.on('console', message => message.type() === 'error' && errors.push(message.text()))
  page.on('pageerror', error => errors.push(String(error)))
  page.on('response', response => response.status() >= 400 && errors.push(`HTTP ${response.status()} ${response.url()}`))
  await page.goto(url)
  await page.waitForSelector('[data-screen="mission-control"].is-active', { timeout: 30_000 })
  await page.waitForFunction(() => window.__game?.game?.mode === 'title')
  await page.evaluate(async () => {
    await document.fonts.ready
    for (const selector of ['.wordmark', '.control-copy h1', '.control-intro']) {
      const family = getComputedStyle(document.querySelector(selector)).fontFamily
      if (!family.startsWith('ManusCC0,')) throw new Error(`Unexpected game font on ${selector}: ${family}`)
    }
    if (![...document.fonts].some(face => face.family.replaceAll('"', '').replaceAll("'", '') === 'ManusCC0' && face.status === 'loaded')) {
      throw new Error('Bundled ManusCC0 font did not load')
    }
  })
  await page.waitForTimeout(250)
  return page
}
const snapshot = page => page.evaluate(() => {
  const game = window.__game.game
  return {
    mode: game.mode,
    mission: game.missionId,
    stage: game.stage,
    position: { x: game.shipRoot.position.x, y: game.shipRoot.position.y, z: game.shipRoot.position.z },
    campaign: window.__game.campaign,
    avatarVisible: game.avatarRoot.visible,
    hud: game.hud(),
  }
})
function meshCount(root) {
  let count = 0
  root.traverse(object => { if (object.isMesh) count += 1 })
  return count
}

try {
  await waitForServer()
  const args = ['--ignore-gpu-blocklist']
  browser = await chromium.launch({ args }).catch(() => chromium.launch({ args, channel: 'chrome' }))
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' })
  const page = await openGame(desktop)
  await page.screenshot({ path: `${out}/01-mission-control.png` })

  const lunarLaunch = page.locator('.mission-card[data-mission="lunar"] [data-action="launch"]')
  if (!(await lunarLaunch.isDisabled())) throw new Error('lunar mission should be locked until the relay repair')
  await page.locator('[data-action="settings"]').click()
  await page.waitForSelector('.settings-overlay.is-active')
  await page.locator('[data-setting="sensitivity"]').evaluate(element => {
    element.value = '1.6'
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const sensitivity = await page.evaluate(() => window.__game.save.data.sensitivity)
  if (sensitivity !== 1.6) throw new Error(`settings were not saved (${sensitivity})`)
  await page.locator('.settings-done').click()
  await page.locator('.help-link').click()
  await page.waitForSelector('.help-overlay.is-active')
  const help = await page.locator('.help-overlay').innerText()
  if (!help.includes('RCS strafe') || !help.includes('LT brake') || !help.includes('Dock / EVA / repair')) throw new Error('flight help labels or controller bindings are incorrect')
  await page.screenshot({ path: `${out}/02-controls.png` })
  await page.locator('.close-help').click()

  await page.locator('.mission-card[data-mission="relay"] [data-action="launch"]').click()
  await page.waitForSelector('[data-screen="flight"].is-active')
  await page.waitForFunction(() => window.__game.game.mode === 'playing')
  const modelCounts = await page.evaluate(() => {
    const count = root => { let total = 0; root.traverse(object => { if (object.isMesh) total += 1 }); return total }
    return { ship: count(window.__game.game.shipRoot), astronaut: count(window.__game.game.avatarRoot) }
  })
  if (modelCounts.ship < 1 || modelCounts.astronaut < 1) throw new Error(`registered GLBs did not load into the scene: ${JSON.stringify(modelCounts)}`)
  const beforeFlight = await snapshot(page)
  await page.keyboard.down('w')
  await page.waitForTimeout(900)
  await page.keyboard.up('w')
  await page.waitForTimeout(120)
  const afterFlight = await snapshot(page)
  const flown = Math.hypot(afterFlight.position.x - beforeFlight.position.x, afterFlight.position.z - beforeFlight.position.z)
  if (flown < 0.75) throw new Error(`ship controls did not move the vehicle (${flown.toFixed(2)} m)`)
  if (afterFlight.mode !== 'playing') throw new Error(`expected active flight, got ${afterFlight.mode}`)
  await page.screenshot({ path: `${out}/03-relay-approach.png` })

  await page.keyboard.press('Escape')
  await page.waitForSelector('.pause-overlay.is-active')
  const frozen = await snapshot(page)
  await page.keyboard.down('w')
  await page.waitForTimeout(350)
  await page.keyboard.up('w')
  const still = await snapshot(page)
  const pausedDrift = Math.hypot(still.position.x - frozen.position.x, still.position.z - frozen.position.z)
  if (still.mode !== 'paused' || pausedDrift > 0.02) throw new Error('pause overlay failed to hold spacecraft motion')
  await page.locator('[data-action="resume"]').click()
  await page.waitForFunction(() => window.__game.game.mode === 'playing')

  await page.evaluate(() => {
    const game = window.__game.game
    game.shipRoot.position.set(game.targetPosition.x, game.targetPosition.y, game.targetPosition.z + 8)
    game.velocity.set(0, 0, 0)
  })
  await page.keyboard.press('e')
  await page.waitForFunction(() => window.__game.game.stage === 'docked')
  await page.keyboard.press('e')
  await page.waitForFunction(() => window.__game.game.stage === 'eva')
  if (!(await page.locator('.oxygen-value').isVisible())) throw new Error('EVA oxygen telemetry is not visible')
  await page.screenshot({ path: `${out}/04-tethered-spacewalk.png` })
  const beforeEVA = await page.evaluate(() => ({ x: window.__game.game.avatarRoot.position.x, y: window.__game.game.avatarRoot.position.y, z: window.__game.game.avatarRoot.position.z }))
  await page.keyboard.down('w')
  await page.waitForTimeout(450)
  await page.keyboard.up('w')
  const movement = await page.evaluate(before => window.__game.game.avatarRoot.position.distanceTo(before), beforeEVA)
  if (movement < 0.2) throw new Error('EVA thruster controls did not move the astronaut')

  await page.evaluate(() => {
    const game = window.__game.game
    game.avatarRoot.position.copy(game.servicePosition)
    game['evaVelocity'].set(0, 0, 0)
  })
  await page.waitForFunction(() => document.querySelector('.context-action')?.classList.contains('is-available'))
  await page.evaluate(() => document.querySelector('.context-action').click())
  await page.waitForSelector('.debrief-overlay.is-active')
  const relayDone = await snapshot(page)
  if (!relayDone.campaign.relayComplete || relayDone.mission !== 'relay') throw new Error('relay repair did not persist campaign progression')
  await page.screenshot({ path: `${out}/05-relay-debrief.png` })

  await page.locator('.debrief-overlay [data-action="next-mission"]').click()
  await page.waitForFunction(() => window.__game.game.missionId === 'lunar' && window.__game.game.mode === 'playing')
  if ((await page.locator('.flight-range').innerText()).replaceAll(',', '') !== '384400') throw new Error('the long-range lunar distance is not shown in the HUD')
  const lunarModels = await page.evaluate(() => ({ moon: window.__game.game['moonGroup'].visible, habitat: window.__game.game['lunarOutpost'].visible }))
  if (!lunarModels.moon || !lunarModels.habitat) throw new Error('lunar mission did not load its distinct moon and surface habitat')
  await page.screenshot({ path: `${out}/06-lunar-approach.png` })
  await page.evaluate(() => {
    const game = window.__game.game
    game.shipRoot.position.set(game.targetPosition.x, game.targetPosition.y, game.targetPosition.z + 8)
    game.velocity.set(0, 0, 0)
  })
  await page.keyboard.press('e')
  await page.waitForSelector('.debrief-overlay.is-active', { timeout: 8000 })
  const campaignDone = await snapshot(page)
  if (!campaignDone.campaign.lunarComplete || campaignDone.stage !== 'complete') throw new Error('lunar docking did not complete the campaign')
  await page.screenshot({ path: `${out}/07-campaign-complete.png` })
  await page.locator('.debrief-overlay [data-action="control-room"]').click()
  await page.waitForSelector('[data-screen="mission-control"].is-active')
  if (await lunarLaunch.isDisabled()) throw new Error('campaign completion did not unlock the lunar mission')
  await page.reload()
  await page.waitForSelector('[data-screen="mission-control"].is-active')
  const persisted = await page.evaluate(() => ({ campaign: window.__game.campaign, sensitivity: window.__game.save.data.sensitivity }))
  if (!persisted.campaign.lunarComplete || persisted.sensitivity !== 1.6) throw new Error('campaign or settings did not persist across reload')
  await desktop.close()

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US' })
  const phonePage = await openGame(phone)
  await phonePage.touchscreen.tap(200, 400)
  await phonePage.waitForFunction(() => document.body.classList.contains('has-touch'))
  const launchHeight = await phonePage.locator('.mission-card[data-mission="relay"] [data-action="launch"]').evaluate(element => element.getBoundingClientRect().height)
  if (launchHeight < 44) throw new Error(`mobile launch target is too small (${launchHeight}px)`)
  await phonePage.locator('.help-link').tap()
  const touchHelp = (await phonePage.locator('.help-overlay').innerText()).toLowerCase()
  if (!touchHelp.includes('tap launch mission') || !touchHelp.includes('left stick') || !touchHelp.includes('drag right side') || touchHelp.includes('w/s')) {
    throw new Error('mobile help does not explain touch-first launch and flight controls')
  }
  await phonePage.locator('.close-help').tap()
  await phonePage.screenshot({ path: `${out}/08-phone-mission-control.png` })
  await phonePage.locator('.mission-card[data-mission="relay"] [data-action="launch"]').tap()
  await phonePage.waitForSelector('[data-screen="flight"].is-active')
  const touchLayerDisplay = await phonePage.locator('.touch-controls').evaluate(element => getComputedStyle(element).display)
  if (touchLayerDisplay === 'none') throw new Error('touch controls did not appear on the active flight HUD')
  for (const action of ['jump', 'descend', 'sprint', 'brake']) {
    if (!(await phonePage.locator(`[data-touch="${action}"]`).isVisible())) throw new Error(`mobile ${action} control is not visible`)
  }
  const touchMotion = await phonePage.evaluate(() => {
    const canvas = document.querySelector('#game')
    const input = window.__game.input
    const event = (type, pointerId, x, y) => new PointerEvent(type, { bubbles: true, pointerId, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y })
    canvas.dispatchEvent(event('pointerdown', 901, 100, 500))
    window.dispatchEvent(event('pointermove', 901, 128, 479))
    input.update()
    const stick = { ...input.move, active: document.querySelector('.touch-stick').classList.contains('is-active') }
    window.dispatchEvent(event('pointerup', 901, 128, 479))
    input.update()
    const released = { ...input.move }
    canvas.dispatchEvent(event('pointerdown', 902, 280, 500))
    window.dispatchEvent(event('pointermove', 902, 300, 520))
    const look = { ...input.look }
    window.dispatchEvent(event('pointerup', 902, 300, 520))
    input.takeLook()
    return { stick, released, look }
  })
  if (!touchMotion.stick.active || touchMotion.stick.x < 0.4 || touchMotion.stick.y < 0.25 || Math.abs(touchMotion.released.x) > 0.01 || Math.abs(touchMotion.released.y) > 0.01) {
    throw new Error(`left-stick touch drag did not update/release movement correctly: ${JSON.stringify(touchMotion)}`)
  }
  if (touchMotion.look.x < 0.05 || touchMotion.look.y < 0.05) throw new Error(`right-side touch drag did not steer: ${JSON.stringify(touchMotion.look)}`)
  for (const action of ['jump', 'descend', 'sprint', 'brake']) {
    const button = phonePage.locator(`[data-touch="${action}"]`)
    await button.hover()
    await phonePage.mouse.down()
    const held = await phonePage.evaluate(action => { window.__game.input.update(); return window.__game.input.held(action) }, action)
    await phonePage.mouse.up()
    const released = await phonePage.evaluate(action => { window.__game.input.update(); return window.__game.input.held(action) }, action)
    if (!held || released) throw new Error(`mobile ${action} hold did not press and release its game action`)
  }
  if (!(await phonePage.locator('.touch-hint').isVisible())) throw new Error('mobile flight-control hint is not visible')
  const hintOverlapsButtons = await phonePage.locator('.touch-hint').evaluate(element => {
    const hint = element.getBoundingClientRect()
    return [...document.querySelectorAll('.touch-btn')].some(button => {
      const bounds = button.getBoundingClientRect()
      return hint.left < bounds.right - 2 && hint.right > bounds.left + 2 && hint.top < bounds.bottom - 2 && hint.bottom > bounds.top + 2
    })
  })
  if (hintOverlapsButtons) throw new Error('mobile touch hint overlaps a flight-control button')
  await phonePage.evaluate(() => {
    const game = window.__game.game
    game.shipRoot.position.set(game.targetPosition.x, game.targetPosition.y, game.targetPosition.z + 20)
    game.velocity.set(0, 0, 0)
  })
  await phonePage.waitForFunction(() => document.querySelector('.context-action')?.getClientRects().length > 0)
  const touchOverlaps = await phonePage.locator('.context-action').evaluate(element => {
    const a = element.getBoundingClientRect()
    return [...document.querySelectorAll('.touch-btn, .touch-stick')].flatMap(control => {
      const b = control.getBoundingClientRect()
      const overlaps = a.left < b.right - 2 && a.right > b.left + 2 && a.top < b.bottom - 2 && a.bottom > b.top + 2
      return overlaps ? [{ control: control.className, action: { left: a.left, top: a.top, right: a.right, bottom: a.bottom }, bounds: { left: b.left, top: b.top, right: b.right, bottom: b.bottom } }] : []
    })
  })
  if (touchOverlaps.length) throw new Error(`mobile context action overlaps the movement stick or a hold-to-thrust button: ${JSON.stringify(touchOverlaps)}`)
  await phonePage.screenshot({ path: `${out}/09-phone-flight.png` })
  await phonePage.evaluate(() => {
    const game = window.__game.game
    game.shipRoot.position.set(game.targetPosition.x, game.targetPosition.y, game.targetPosition.z + 8)
    game.velocity.set(0, 0, 0)
  })
  await phonePage.waitForFunction(() => document.querySelector('.context-action')?.classList.contains('is-available'))
  await phonePage.locator('.context-action').tap()
  await phonePage.waitForFunction(() => window.__game.game.stage === 'docked')
  await phonePage.locator('.context-action').tap()
  await phonePage.waitForFunction(() => window.__game.game.stage === 'eva')
  if (!(await phonePage.locator('.eva-data').isVisible())) throw new Error('touch-started EVA did not show suit telemetry')
  await phonePage.screenshot({ path: `${out}/10-phone-eva.png` })
  await phonePage.evaluate(() => {
    const game = window.__game.game
    game.avatarRoot.position.copy(game.servicePosition)
    game['evaVelocity'].set(0, 0, 0)
  })
  await phonePage.waitForFunction(() => document.querySelector('.context-action')?.classList.contains('is-available'))
  await phonePage.locator('.context-action').tap()
  await phonePage.waitForSelector('.debrief-overlay.is-active')
  await phone.close()

  if (errors.length) throw new Error(`browser errors:\n  ${errors.join('\n  ')}`)
  await browser.close()
  cleanup()
  console.log(`smoke: OK — spacecraft moved ${flown.toFixed(1)} m, relay EVA repaired, lunar campaign completed; screenshots in ${out}/`)
} catch (error) {
  await fail(error?.message ?? String(error))
}
