import type { Audio } from '../engine/audio'
import type { I18n } from '../engine/i18n'
import type { Input } from '../engine/input'
import type { Quality, SaveData, SaveStore } from '../engine/save'
import type { CampaignProgress, MissionId, MissionStage } from '../game/missions'
import { FAVICON_URL } from '../game/model-urls'

export type HudSnapshot = {
  mission: MissionId
  stage: MissionStage
  speed: number
  distanceKm: number
  objectiveKey: string
  canDock: boolean
  dockDistance: number
  oxygen: number
  tether: number
  tetherLimit: number
  serviceDistance: number
  canService: boolean
  statusKey: string
}

type UiActions = {
  launch(id: MissionId): void
  resume(): void
  returnToControl(): void
  interact(): void
  settings(patch: Partial<Pick<SaveData, 'musicVolume' | 'sfxVolume' | 'muted' | 'sensitivity' | 'invertY' | 'quality' | 'reducedMotion'>>): void
}

/** English-only HTML instrument panels layered over the Three.js viewport. */
export class OrbitalUi {
  screen: 'boot' | 'mission-control' | 'flight' = 'boot'
  private readonly root: HTMLElement
  private helpVisible = false
  private settingsVisible = false
  private navRepeat = 0

  constructor(private readonly i18n: I18n, private readonly input: Input, private readonly audio: Audio, private readonly save: SaveStore, private readonly actions: UiActions) {
    this.root = document.getElementById('ui')!
    this.root.innerHTML = this.template()
    this.q<HTMLImageElement>('.orbit-mark').src = FAVICON_URL
    this.root.addEventListener('click', e => this.onClick(e))
    this.root.addEventListener('input', e => this.onSetting(e, 'input'))
    this.root.addEventListener('change', e => this.onSetting(e, 'change'))
    this.root.addEventListener('keydown', e => {
      const key = (e as KeyboardEvent).key
      if (key === 'Escape' && this.settingsVisible) { e.preventDefault(); this.toggleSettings(false) }
      else if (key === 'Escape' && this.helpVisible) this.toggleHelp(false)
      else if (key === 'Escape' && this.q('.pause-overlay').classList.contains('is-active')) this.root.querySelector<HTMLElement>('[data-action="resume"]')?.focus()
    })
    this.translateStaticText()
    this.refreshSettings()
    this.showBoot()
  }

  showBoot(): void {
    this.screen = 'boot'
    this.q<HTMLElement>('.boot-error').classList.remove('is-visible')
    this.q<HTMLButtonElement>('[data-action="retry"]').hidden = true
    this.setActive('boot')
  }

  setBootProgress(value: number): void {
    const bar = this.q<HTMLElement>('.boot-meter i')
    bar.style.transform = `scaleX(${Math.max(0.04, Math.min(1, value))})`
  }

  showBootError(message: string, retry: () => void): void {
    const note = this.q<HTMLElement>('.boot-error')
    note.textContent = message
    note.classList.add('is-visible')
    const button = this.q<HTMLButtonElement>('[data-action="retry"]')
    button.hidden = false
    this.retry = retry
  }
  private retry?: () => void

  showTitle(progress: CampaignProgress): void {
    this.screen = 'mission-control'
    this.root.querySelectorAll<HTMLElement>('.mission-card').forEach(card => {
      const id = card.dataset.mission as MissionId
      const unlocked = id === 'relay' || progress.relayComplete
      const completed = id === 'relay' ? progress.relayComplete : progress.lunarComplete
      const button = card.querySelector<HTMLButtonElement>('[data-action="launch"]')!
      button.disabled = !unlocked
      card.classList.toggle('is-locked', !unlocked)
      card.classList.toggle('is-complete', completed)
      const badge = card.querySelector<HTMLElement>('.mission-badge')!
      badge.textContent = this.i18n.t(completed ? 'mission.status.complete' : unlocked ? 'mission.status.ready' : 'mission.status.locked')
    })
    this.q<HTMLElement>('.career-count').textContent = this.i18n.t('campaign.count', { done: Number(progress.relayComplete) + Number(progress.lunarComplete) })
    this.root.classList.remove('is-eva')
    this.setActive('mission-control')
  }

  showFlight(id: MissionId): void {
    this.screen = 'flight'
    this.root.classList.remove('is-eva')
    this.setActive('flight')
    this.q<HTMLElement>('.flight-mission-title').textContent = this.i18n.t(id === 'relay' ? 'mission.relay.title' : 'mission.lunar.title')
    this.q<HTMLElement>('.flight-destination').textContent = this.i18n.t(id === 'relay' ? 'mission.relay.destination' : 'mission.lunar.destination')
  }

  showPause(): void {
    this.q<HTMLElement>('.pause-overlay').classList.add('is-active')
    this.q<HTMLElement>('.pause-overlay').setAttribute('aria-hidden', 'false')
    requestAnimationFrame(() => this.q<HTMLElement>('[data-action="resume"]')?.focus({ preventScroll: true }))
  }

  hidePause(): void {
    this.q<HTMLElement>('.pause-overlay').classList.remove('is-active')
    this.q<HTMLElement>('.pause-overlay').setAttribute('aria-hidden', 'true')
  }

  showDebrief(id: MissionId): void {
    const final = id === 'lunar'
    this.q<HTMLElement>('.debrief-eyebrow').textContent = this.i18n.t(final ? 'debrief.campaign' : 'debrief.mission')
    this.q<HTMLElement>('.debrief-title').textContent = this.i18n.t(final ? 'debrief.complete.title' : 'debrief.relay.title')
    this.q<HTMLElement>('.debrief-copy').textContent = this.i18n.t(final ? 'debrief.complete.copy' : 'debrief.relay.copy')
    const next = this.q<HTMLButtonElement>('[data-action="next-mission"]')
    next.hidden = final
    this.q<HTMLElement>('.debrief-complete').hidden = !final
    this.q<HTMLElement>('.debrief-overlay').classList.add('is-active')
    this.q<HTMLElement>('.debrief-overlay').setAttribute('aria-hidden', 'false')
    requestAnimationFrame(() => (final ? this.q<HTMLElement>('[data-action="control-room"]') : next)?.focus({ preventScroll: true }))
  }

  hideDebrief(): void {
    this.q<HTMLElement>('.debrief-overlay').classList.remove('is-active')
    this.q<HTMLElement>('.debrief-overlay').setAttribute('aria-hidden', 'true')
  }

  updateHud(data: HudSnapshot): void {
    this.q<HTMLElement>('.objective-title').textContent = this.i18n.t(data.objectiveKey)
    this.q<HTMLElement>('.flight-speed').textContent = Math.round(data.speed).toLocaleString('en-US')
    this.q<HTMLElement>('.flight-range').textContent = formatRange(data.distanceKm)
    this.q<HTMLElement>('.flight-status').textContent = this.i18n.t(data.statusKey)
    this.q<HTMLElement>('.flight-stage').textContent = this.i18n.t(`stage.${data.stage}`)
    const eva = data.stage === 'eva'
    this.q<HTMLElement>('.flight-data').classList.toggle('is-hidden', eva)
    this.q<HTMLElement>('.eva-data').classList.toggle('is-hidden', !eva)
    this.q<HTMLElement>('.oxygen-fill').style.width = `${Math.max(0, Math.min(100, data.oxygen))}%`
    this.q<HTMLElement>('.oxygen-value').textContent = `${Math.ceil(data.oxygen)}%`
    this.q<HTMLElement>('.tether-fill').style.width = `${Math.min(100, data.tether / Math.max(1, data.tetherLimit) * 100)}%`
    this.q<HTMLElement>('.tether-value').textContent = `${data.tether.toFixed(1)} / ${data.tetherLimit} m`
    this.root.classList.toggle('is-eva', eva)
    const action = this.q<HTMLButtonElement>('.context-action')
    const actionKey = eva ? 'action.repair' : data.stage === 'docked' ? 'action.beginEva' : 'action.dock'
    action.querySelector('span')!.textContent = this.i18n.t(actionKey)
    const actionReady = eva ? data.canService : data.stage === 'docked' || data.canDock
    action.disabled = !actionReady
    action.classList.toggle('is-available', actionReady)
    action.hidden = !(eva ? data.serviceDistance < 12 : data.dockDistance < 26 || data.stage === 'docked')
    this.q<HTMLElement>('.service-range').textContent = `${data.serviceDistance.toFixed(1)} m`
    this.q<HTMLElement>('.dock-target').classList.toggle('is-ready', data.canDock)
    this.q<HTMLElement>('.dock-target').classList.toggle('is-servicable', data.canService)
  }

  toast(key: string): void {
    const el = this.q<HTMLElement>('.flight-toast')
    el.textContent = this.i18n.t(key)
    el.classList.remove('is-visible')
    void el.offsetWidth
    el.classList.add('is-visible')
    window.setTimeout(() => el.classList.remove('is-visible'), 2600)
  }

  frame(frameSeconds = 1 / 60): void {
    if (this.input.method !== 'gamepad' || this.screen !== 'mission-control') return
    this.navRepeat = Math.max(0, this.navRepeat - frameSeconds)
    const items = this.settingsVisible
      ? [...this.root.querySelectorAll<HTMLElement>('[data-settings-nav]')]
      : [...this.root.querySelectorAll<HTMLElement>('.mission-card [data-action="launch"]:not(:disabled), .help-link, .settings-link')]
    const active = document.activeElement as HTMLElement | null
    const y = this.input.move.y
    const x = this.input.move.x
    if (Math.abs(y) > 0.6 && this.navRepeat <= 0 && items.length) {
      const current = items.indexOf(active!)
      const next = items[(current + (y < 0 ? 1 : -1) + items.length) % items.length]
      next.focus({ preventScroll: true })
      this.navRepeat = 0.22
    } else if (Math.abs(x) > 0.6 && this.navRepeat <= 0 && active?.matches('input[type="range"]')) {
      const slider = active as HTMLInputElement
      slider.value = String(Number(slider.value) + Math.sign(x) * Number(slider.step || 0.1))
      slider.dispatchEvent(new Event('input', { bubbles: true }))
      this.navRepeat = 0.12
    } else if (Math.abs(x) < 0.3 && Math.abs(y) < 0.3) this.navRepeat = 0
    if (this.input.consume('confirm')) (document.activeElement as HTMLElement | null)?.click()
    if (this.input.consume('back')) {
      if (this.settingsVisible) this.toggleSettings(false)
      else if (this.helpVisible) this.toggleHelp(false)
    }
  }

  private onClick(event: MouseEvent): void {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]')
    if (!button || button.disabled) return
    this.audio.unlock()
    this.audio.play('ui')
    const action = button.dataset.action
    if (action === 'launch') {
      const id = button.dataset.mission as MissionId
      this.actions.launch(id)
      return
    }
    if (action === 'resume') this.actions.resume()
    else if (action === 'control-room') this.actions.returnToControl()
    else if (action === 'next-mission') this.actions.launch('lunar')
    else if (action === 'interact') this.actions.interact()
    else if (action === 'pause') window.dispatchEvent(new CustomEvent('game:pause'))
    else if (action === 'help') this.toggleHelp(!this.helpVisible)
    else if (action === 'settings') this.toggleSettings(true)
    else if (action === 'settings-close') this.toggleSettings(false)
    else if (action === 'retry') this.retry?.()
  }

  refreshSettings(): void {
    const data = this.save.data
    for (const control of this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting]')) {
      const key = control.dataset.setting as keyof SaveData
      const value = data[key]
      if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = value === true
      else control.value = String(value)
      if (control instanceof HTMLInputElement && control.type === 'range') {
        const output = this.q<HTMLOutputElement>(`output[data-for="${key}"]`)
        output.value = key === 'sensitivity' ? `${Number(value).toFixed(1)}×` : `${Math.round(Number(value) * 100)}%`
      }
    }
  }

  private onSetting(event: Event, kind: 'input' | 'change'): void {
    const control = event.target
    if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) return
    const key = control.dataset.setting as keyof SaveData | undefined
    if (!key) return
    const isRange = control instanceof HTMLInputElement && control.type === 'range'
    if ((isRange && kind !== 'input') || (!isRange && kind !== 'change')) return
    const value = control instanceof HTMLInputElement && control.type === 'checkbox'
      ? control.checked
      : key === 'quality' ? control.value as Quality : Number(control.value)
    this.actions.settings({ [key]: value } as Partial<Pick<SaveData, 'musicVolume' | 'sfxVolume' | 'muted' | 'sensitivity' | 'invertY' | 'quality' | 'reducedMotion'>>)
    this.refreshSettings()
  }

  private toggleSettings(show: boolean): void {
    this.settingsVisible = show
    this.navRepeat = 0
    const overlay = this.q<HTMLElement>('.settings-overlay')
    overlay.classList.toggle('is-active', show)
    overlay.setAttribute('aria-hidden', String(!show))
    if (show) {
      this.refreshSettings()
      requestAnimationFrame(() => this.q<HTMLElement>('.settings-overlay [data-settings-nav]')?.focus({ preventScroll: true }))
    } else requestAnimationFrame(() => this.q<HTMLElement>('.settings-link')?.focus({ preventScroll: true }))
  }

  private toggleHelp(show: boolean): void {
    this.helpVisible = show
    const overlay = this.q<HTMLElement>('.help-overlay')
    overlay.classList.toggle('is-active', show)
    overlay.setAttribute('aria-hidden', String(!show))
    if (show) requestAnimationFrame(() => this.q<HTMLElement>('.close-help').focus({ preventScroll: true }))
    else requestAnimationFrame(() => this.q<HTMLElement>('.help-link').focus({ preventScroll: true }))
  }

  private translateStaticText(): void {
    const fixed: Array<[string, string]> = [
      ['.boot-caption', 'boot.initializing'], ['.boot-retry', 'boot.retry'],
      ['.control-copy .eyebrow span:nth-child(1)', 'control.deck'], ['.control-copy .eyebrow span:nth-child(3)', 'campaign.solo'],
      ['.control-intro', 'control.intro'],
      ['.career-progress span:nth-child(2)', 'campaign.record'], ['.career-progress span:last-child', 'campaign.missionsComplete'],
      ['.dossier-heading span:first-child', 'mission.queue'], ['.dossier-heading span:last-child', 'mission.queueCount'],
      ['.mission-card[data-mission="relay"] .mission-tags span:first-child', 'mission.relay.region'],
      ['.mission-card[data-mission="lunar"] .mission-tags span:first-child', 'mission.lunar.region'],
      ['.dossier-foot span:first-child', 'control.flightDirector'], ['.dossier-foot span:last-child', 'control.crew'],
      ['.control-footer span:first-child', 'control.footerLeft'], ['.control-footer span:last-child', 'control.footerRight'],
      ['.help-card .eyebrow', 'help.eyebrow'], ['.help-card h2', 'help.title'],
      ['.help-grid span:nth-child(1)', 'help.thrust'], ['.help-grid span:nth-child(3)', 'help.strafe'],
      ['.help-grid span:nth-child(5)', 'help.mouse'], ['.help-grid span:nth-child(6)', 'help.mouseValue'],
      ['.help-grid span:nth-child(7)', 'help.vertical'], ['.help-grid span:nth-child(9)', 'help.roll'],
      ['.help-grid span:nth-child(11)', 'help.boostBrake'], ['.help-grid span:nth-child(13)', 'help.interact'],
      ['.help-grid span:nth-child(15)', 'help.pause'], ['.help-note', 'help.note'],
      ['.flight-id small', 'flight.header'], ['.objective-strip small', 'flight.activeObjective'],
      ['.readout-label', 'flight.destinationLabel'], ['.flight-data .data-row:nth-child(1) > span', 'flight.rangeLabel'],
      ['.flight-data .data-row:nth-child(2) > span', 'flight.speedLabel'], ['.flight-data .data-row:nth-child(3) > span', 'flight.statusLabel'],
      ['.eva-data .data-row:nth-child(1) > span', 'hud.oxygen'], ['.eva-data .data-row:nth-child(3) > span', 'hud.tether'],
      ['.eva-data .data-row:nth-child(5) > span', 'hud.service'],
      ['.dock-target small', 'flight.dockVector'], ['.control-hint span:nth-child(2)', 'flight.thrustHint'],
      ['.control-hint span:nth-child(4)', 'flight.steerHint'], ['.control-hint span:nth-child(6)', 'flight.brakeHint'],
      ['.eva-controls', 'flight.evaControls'], ['.pause-overlay .eyebrow', 'pause.eyebrow'],
      ['.pause-overlay h2', 'pause.heading'], ['.pause-overlay > .overlay-card > p:not(.eyebrow)', 'pause.copy'],
      ['.pause-overlay [data-action="resume"]', 'action.resume'], ['.pause-overlay [data-action="control-room"]', 'action.toMissionControl'],
    ['.debrief-complete', 'debrief.complete.stamp'], ['.debrief-overlay [data-action="control-room"]', 'action.toMissionControl'],
    ]
    for (const [selector, key] of fixed) {
      const node = this.root.querySelector<HTMLElement>(selector)
      if (!node) continue
      node.dataset.i18n = key
      node.textContent = this.i18n.t(key)
    }
    const [headline, accent = ''] = this.i18n.t('control.headline').split('\n', 2)
    this.q<HTMLElement>('.control-copy h1').innerHTML = `${escapeHTML(headline)}<br><em>${escapeHTML(accent)}</em>`
    const live = this.q<HTMLElement>('.live-indicator')
    live.dataset.i18n = 'status.systems'
    live.innerHTML = `<i></i>${this.i18n.t('status.systems')}`
    const help = this.q<HTMLElement>('.help-link')
    help.dataset.i18n = 'control.flightControls'
    help.innerHTML = `<span class="help-icon">?</span>${this.i18n.t('control.flightControls')}<span>↗</span>`
    for (const node of this.root.querySelectorAll<HTMLElement>('[data-i18n]')) {
      if (node === live || node === help) continue
      node.textContent = this.i18n.t(node.dataset.i18n!)
    }
    for (const node of this.root.querySelectorAll<HTMLElement>('[data-i18n-label]')) node.setAttribute('aria-label', this.i18n.t(node.dataset.i18nLabel!))
  }

  private setActive(screen: 'boot' | 'mission-control' | 'flight'): void {
    if (screen !== 'mission-control' && this.settingsVisible) this.toggleSettings(false)
    if (screen !== 'mission-control' && this.helpVisible) this.toggleHelp(false)
    for (const section of this.root.querySelectorAll<HTMLElement>('[data-screen]')) {
      const active = section.dataset.screen === screen
      section.classList.toggle('is-active', active)
      section.setAttribute('aria-hidden', String(!active))
    }
    this.root.querySelectorAll<HTMLElement>('.pause-overlay, .debrief-overlay').forEach(overlay => {
      overlay.classList.remove('is-active')
      overlay.setAttribute('aria-hidden', 'true')
    })
    this.root.dataset.activeScreen = screen
    if (screen === 'mission-control') requestAnimationFrame(() => this.q<HTMLElement>('[data-action="launch"]:not(:disabled)')?.focus({ preventScroll: true }))
    if (screen === 'flight') this.root.querySelector<HTMLElement>('.flight-hud')?.focus({ preventScroll: true })
  }

  private q<T extends HTMLElement = HTMLElement>(selector: string): T {
    return this.root.querySelector<T>(selector)!
  }

  private template(): string {
    return /* html */ `
<section class="screen screen-boot is-active" data-screen="boot" data-i18n-label="aria.loading">
  <div class="boot-brand"><img class="orbit-mark" src="" alt=""><span data-i18n="game.title.short">ORBITAL</span></div>
  <p class="boot-caption">FLIGHT SYSTEMS INITIALIZING</p>
  <div class="boot-meter" role="progressbar" aria-label="Loading game"><i></i></div>
  <p class="boot-error" role="alert"></p><button class="text-button boot-retry" data-action="retry" hidden>RETRY CONNECTION</button>
</section>
<section class="screen screen-control" data-screen="mission-control" aria-label="Mission control">
  <header class="topline"><a class="wordmark" href="#mission-control" data-i18n-label="aria.missionControl"><span class="wordmark-emblem">O</span> <span data-i18n="game.title.short">ORBITAL</span> <i>/</i> FLIGHT OPERATIONS</a><div class="header-actions"><button class="settings-link" data-action="settings" data-i18n="menu.settings">SETTINGS</button><div class="live-indicator"><i></i> SYSTEMS NOMINAL</div></div></header>
  <div class="control-layout">
    <div class="control-copy">
      <p class="eyebrow"><span>FLIGHT DECK 01</span><span>·</span><span>SOLO CAREER</span></p>
      <h1>Beyond the<br><em>blue.</em></h1>
      <p class="control-intro">Pilot a reusable spacecraft, rendezvous with an orbital relay, then take the long road to the lunar frontier.</p>
      <div class="career-progress"><span class="progress-rule"></span><span>CAMPAIGN RECORD</span><strong class="career-count">0 / 2</strong><span>MISSIONS COMPLETE</span></div>
      <button class="help-link" data-action="help"><span class="help-icon">?</span> FLIGHT CONTROLS <span>↗</span></button>
    </div>
    <div class="mission-dossier">
      <div class="dossier-heading"><span>MISSION QUEUE</span><span>01 — 02</span></div>
      <article class="mission-card" data-mission="relay">
        <div class="mission-numeral">01</div><div class="mission-info"><div class="mission-tags"><span>LOW EARTH ORBIT</span><span class="mission-badge"></span></div>
          <h2 data-i18n="mission.relay.title">Relay Seven</h2><p data-i18n="mission.relay.subtitle">240 KM · EVA SERVICE</p><p class="mission-brief" data-i18n="mission.relay.briefing">Rendezvous with the orbital relay, then cross open space to repair its sun sensor.</p>
          <button class="launch-button" data-action="launch" data-mission="relay"><span data-i18n="action.launch">LAUNCH MISSION</span><b>↗</b></button></div>
      </article>
      <article class="mission-card mission-card-far" data-mission="lunar">
        <div class="mission-numeral">02</div><div class="mission-info"><div class="mission-tags"><span>LUNAR TRANSFER</span><span class="mission-badge"></span></div>
          <h2 data-i18n="mission.lunar.title">South Pole Outpost</h2><p data-i18n="mission.lunar.subtitle">384,400 KM · RENDEZVOUS</p><p class="mission-brief" data-i18n="mission.lunar.briefing">Carry a science package through a long transfer and dock with the polar habitat.</p>
          <button class="launch-button" data-action="launch" data-mission="lunar"><span data-i18n="action.launch">LAUNCH MISSION</span><b>↗</b></button></div>
      </article>
      <div class="dossier-foot"><span>FLIGHT DIRECTOR: YOU</span><span>CREWED / SINGLE PILOT</span></div>
    </div>
  </div>
  <footer class="control-footer"><span>ORBITAL: FLIGHT &amp; EVA <i>—</i> INDEPENDENT CREW PROGRAM</span><span>LOCAL FLIGHT RECORDER ACTIVE</span></footer>
  <aside class="help-overlay" role="dialog" aria-modal="true" aria-labelledby="help-heading" aria-hidden="true"><div class="help-card"><button class="close-help" data-action="help" data-i18n-label="action.closeHelp">×</button><p class="eyebrow">PILOT REFERENCE</p><h2 id="help-heading">Flight controls</h2><div class="help-grid"><span>Thrust / reverse</span><span><kbd>W</kbd> / <kbd>S</kbd></span><span>RCS strafe</span><span><kbd>A</kbd> / <kbd>D</kbd></span><span>Mouse attitude</span><span>Click canvas to look</span><span>Rise / descend</span><span><kbd>Space</kbd> / <kbd>C</kbd></span><span>Roll</span><span><kbd>Q</kbd> / <kbd>Z</kbd></span><span>Boost / brake</span><span><kbd>Shift</kbd> / <kbd>Ctrl</kbd></span><span>Dock / EVA / repair</span><span><kbd>E</kbd></span><span>Pause</span><span><kbd>Esc</kbd></span></div><p class="help-touch" data-i18n="help.touch">To start: tap LAUNCH MISSION on Relay Seven. LEFT STICK: thrust and RCS strafe. DRAG RIGHT SIDE: steer. RISE / FALL: vertical movement. BOOST / BRAKE: speed. Tap the action prompt to dock, start the spacewalk or repair. Tap pause to hold.</p><p class="help-pad" data-i18n="help.gamepad"></p><p class="help-note">Bring relative speed below 7 m/s before docking. On EVA, keep inside your tether and reach the beacon before oxygen runs low.</p></div></aside>
  <aside class="settings-overlay" aria-hidden="true"><div class="settings-card" role="dialog" aria-modal="true" aria-labelledby="settings-heading"><button class="settings-close" data-action="settings-close" data-settings-nav data-i18n-label="settings.close">×</button><p class="eyebrow" data-i18n="settings.display">DISPLAY &amp; CONTROLS</p><h2 id="settings-heading" data-i18n="settings.title">Settings</h2>
    <label class="setting-row"><span data-i18n="settings.music">Music volume</span><input data-setting="musicVolume" data-settings-nav type="range" min="0" max="1" step="0.05"><output data-for="musicVolume"></output></label>
    <label class="setting-row"><span data-i18n="settings.sfx">Effects volume</span><input data-setting="sfxVolume" data-settings-nav type="range" min="0" max="1" step="0.05"><output data-for="sfxVolume"></output></label>
    <label class="setting-row"><span data-i18n="settings.sensitivity">Look sensitivity</span><input data-setting="sensitivity" data-settings-nav type="range" min="0.2" max="3" step="0.1"><output data-for="sensitivity"></output></label>
    <label class="setting-row"><span data-i18n="settings.quality">Graphics quality</span><select data-setting="quality" data-settings-nav><option value="low" data-i18n="settings.quality.low">Low</option><option value="medium" data-i18n="settings.quality.medium">Medium</option><option value="high" data-i18n="settings.quality.high">High</option></select></label>
    <label class="setting-row"><span data-i18n="settings.mute">Mute audio</span><input type="checkbox" data-setting="muted" data-settings-nav></label>
    <label class="setting-row"><span data-i18n="settings.invertY">Invert vertical look</span><input type="checkbox" data-setting="invertY" data-settings-nav></label>
    <label class="setting-row"><span data-i18n="settings.reducedMotion">Reduce camera movement</span><input type="checkbox" data-setting="reducedMotion" data-settings-nav></label>
    <button class="settings-done" data-action="settings-close" data-settings-nav data-i18n="menu.back">DONE</button></div></aside>
</section>
<section class="screen screen-flight" data-screen="flight" data-i18n-label="aria.cockpit">
    <div class="flight-hud" tabindex="-1">
    <header class="flight-top"><div class="flight-id"><span class="flight-mark">O</span><div><small>ORBITAL / FLIGHT OPERATIONS</small><strong class="flight-mission-title">RELAY SEVEN</strong></div></div>
      <div class="objective-strip"><small>ACTIVE OBJECTIVE</small><strong class="objective-title"></strong></div>
      <button class="pause-button" data-action="pause" data-i18n-label="flight.pauseLabel"><span>Ⅱ</span><small>ESC</small></button></header>
    <div class="flight-left"><div class="readout-label">DESTINATION</div><strong class="flight-destination"></strong><div class="flight-data"><div class="data-row"><span>RANGE</span><b><i class="flight-range">—</i> <small>KM</small></b></div><div class="data-row"><span>RELATIVE SPEED</span><b><i class="flight-speed">0</i> <small>M/S</small></b></div><div class="data-row status-row"><span>FLIGHT STATUS</span><b class="flight-status">NOMINAL</b></div></div>
      <div class="eva-data is-hidden"><div class="data-row"><span>SUIT O₂</span><b class="oxygen-value">100%</b></div><div class="meter"><i class="oxygen-fill"></i></div><div class="data-row tether-row"><span>SAFETY TETHER</span><b class="tether-value">0 / 28 m</b></div><div class="meter tether-meter"><i class="tether-fill"></i></div><div class="data-row"><span>SERVICE PANEL</span><b class="service-range">— m</b></div></div>
    </div>
    <div class="dock-target"><i></i><b>+</b><small>DOCKING VECTOR</small></div>
    <div class="reticle"><i></i><b></b></div>
    <div class="flight-toast" role="status" aria-live="polite"></div>
    <button class="context-action" data-action="interact"><span>ENGAGE</span><b><kbd>E</kbd></b></button>
    <div class="control-hint"><span class="flight-stage">APPROACH</span><i></i><span>W/S THRUST</span><i></i><span>MOUSE STEER</span><i></i><span>CTRL BRAKE</span></div>
    <div class="eva-controls">WASD MOVE <i>·</i> SPACE / C RISE / FALL <i>·</i> E SERVICE <i>·</i> ESC PAUSE</div>
    <div class="touch-controls" data-i18n-label="aria.touchControls">
      <div class="touch-stick"><i></i></div>
      <div class="touch-buttons"><button class="touch-btn touch-rise" data-touch="jump" data-i18n="touch.rise">RISE</button><button class="touch-btn touch-fall" data-touch="descend" data-i18n="touch.fall">FALL</button><button class="touch-btn touch-boost" data-touch="sprint" data-i18n="touch.boost">BOOST</button><button class="touch-btn touch-brake" data-touch="brake" data-i18n="touch.brake">BRAKE</button></div>
      <div class="touch-hint" data-i18n="flight.touchControls">LEFT STICK THRUST / RCS · DRAG TO STEER</div>
    </div>
    <div class="flight-edge flight-edge-left"></div><div class="flight-edge flight-edge-right"></div>
  </div>
  <div class="pause-overlay" aria-hidden="true"><div class="overlay-card"><p class="eyebrow">AUTOPILOT HOLD</p><h2>Flight paused</h2><p>Propulsion and mission time are on hold.</p><button class="primary-action" data-action="resume">RESUME FLIGHT <b>↗</b></button><button class="secondary-action" data-action="control-room">RETURN TO MISSION CONTROL</button></div></div>
  <div class="debrief-overlay" aria-hidden="true"><div class="overlay-card debrief-card"><p class="eyebrow debrief-eyebrow">MISSION DEBRIEF</p><div class="debrief-stamp">✓</div><h2 class="debrief-title">Mission complete</h2><p class="debrief-copy"></p><div class="debrief-complete" hidden>CAMPAIGN FLIGHT QUALIFICATION RECORDED</div><button class="primary-action" data-action="next-mission"><span data-i18n="action.nextMission">PREPARE LUNAR APPROACH</span><b>↗</b></button><button class="secondary-action" data-action="control-room">RETURN TO MISSION CONTROL</button></div></div>
</section>`
  }
}

function formatRange(distance: number): string {
  if (distance >= 1000) return Math.round(distance).toLocaleString('en-US')
  if (distance >= 10) return Math.round(distance).toString()
  return distance.toFixed(1)
}

function escapeHTML(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}
