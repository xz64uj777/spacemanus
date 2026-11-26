import './styles/orbital.css'
import { Assets } from './engine/assets'
import { Audio } from './engine/audio'
import { I18n } from './engine/i18n'
import { Input } from './engine/input'
import { GameLoop } from './engine/loop'
import { Renderer, suggestQuality } from './engine/renderer'
import { SAVE_KEY, SaveStore } from './engine/save'
import { Game } from './game/game'
import { CAMPAIGN_STORAGE_KEY, isMissionUnlocked, parseCampaign, recordMission, type MissionId } from './game/missions'
import { loadRegisteredModels } from './game/model-loading'
import { MODEL_URLS } from './game/model-urls'
import { OrbitalUi } from './ui/orbital-ui'
import { TouchControls } from './ui/touch'

type Campaign = ReturnType<typeof parseCampaign>

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#game')!
  const uiRoot = document.getElementById('ui')!
  const firstRun = safeGet(SAVE_KEY) === null
  const save = new SaveStore()
  // This title is intentionally English-only; saved/browser locale choices cannot switch it.
  const i18n = new I18n('en')
  const input = new Input(canvas)
  const audio = new Audio()
  const assets = new Assets()
  let game: Game | undefined
  let loop: GameLoop | undefined
  let touch: TouchControls | undefined
  let progress: Campaign = parseCampaign(safeGet(CAMPAIGN_STORAGE_KEY))
  let lockLostAt = 0

  const ui = new OrbitalUi(i18n, input, audio, save, {
    launch: id => startMission(id),
    resume: () => resume(),
    returnToControl: () => returnToControl(),
    interact: () => game?.requestInteract(),
    settings: patch => {
      save.update(patch)
      input.sensitivity = save.data.sensitivity
      input.invertY = save.data.invertY
      audio.setVolumes(save.data.musicVolume, save.data.sfxVolume, save.data.muted)
      if (game) {
        game.setQuality(save.data.quality)
        game.reducedMotion = save.data.reducedMotion
      }
    },
  })

  input.sensitivity = save.data.sensitivity
  input.invertY = save.data.invertY
  audio.setVolumes(save.data.musicVolume, save.data.sfxVolume, save.data.muted)
  if (firstRun) save.update({ quality: suggestQuality() })
  ui.refreshSettings()
  const renderer = new Renderer(canvas, save.data.quality)

  function startMission(id: MissionId): void {
    if (!game) return
    if (!isMissionUnlocked(progress, id)) {
      ui.toast('mission.status.locked')
      return
    }
    touch?.releaseAll()
    game.start(id)
    ui.hidePause()
    ui.hideDebrief()
    ui.showFlight(id)
    audio.unlock()
    audio.startMusic()
    loop?.resetAccumulator()
    input.lockPointer()
  }

  function pause(): void {
    if (game?.mode !== 'playing') return
    game.pause()
    touch?.releaseAll()
    ui.showPause()
    input.unlockPointer()
  }

  function resume(): void {
    if (game?.mode !== 'paused') return
    game.resume()
    ui.hidePause()
    loop?.resetAccumulator()
    input.lockPointer()
  }

  function returnToControl(): void {
    if (!game) return
    game.toTitle()
    touch?.releaseAll()
    ui.hidePause()
    ui.hideDebrief()
    ui.showTitle(progress)
    input.unlockPointer()
  }

  const loadModels = async () => {
    ui.setBootProgress(0.06)
    const off = assets.onProgress(progress => ui.setBootProgress(0.08 + Math.min(1, progress) * 0.88))
    try {
      const models = await loadRegisteredModels(MODEL_URLS, url => assets.gltf(url), (model, error) => {
        console.warn(`Orbital ${model} model unavailable; a procedural fallback will be used.`, error)
      })
      ui.setBootProgress(0.97)
      return models
    } finally {
      off()
    }
  }

  const mountGame = async (): Promise<void> => {
    ui.showBoot()
    try {
      await document.fonts.ready
      const models = await loadModels()
      if (import.meta.env.DEV) {
        const [{ registerGameTuning }, { tuning }] = await Promise.all([
          import('../scripts/manus-tuning/adapter.js'), import('./game/tuning'),
        ])
        await registerGameTuning(tuning)
      }
      game = new Game(renderer, input, audio, {
        message: key => ui.toast(key),
        missionComplete: id => {
          progress = recordMission(progress, id)
          safeSet(CAMPAIGN_STORAGE_KEY, JSON.stringify(progress))
          input.unlockPointer()
          ui.showDebrief(id)
        },
      }, models)
      game.reducedMotion = save.data.reducedMotion
      loop = new GameLoop({
        beforeFrame: frameSeconds => input.update(frameSeconds),
        step: dt => game?.step(dt),
        render: (alpha, frameSeconds) => {
          if (input.consume('pause') && performance.now() - lockLostAt > 280) {
            if (game?.mode === 'playing') pause()
            else if (game?.mode === 'paused') resume()
          }
          ui.frame(frameSeconds)
          if (loop) loop.paused = game?.mode === 'paused'
          game?.render(alpha, frameSeconds)
          if (game?.mode === 'playing') ui.updateHud(game.hud())
        },
      })
      loop.start()
      ui.setBootProgress(1)
      ui.showTitle(progress)
      const g = game
      document.addEventListener('pointerlockchange', () => {
        // Browsers release pointer lock on Escape without delivering the key: pause in that case.
        if (!document.pointerLockElement && g.mode === 'playing' && input.method === 'keyboard') {
          lockLostAt = performance.now()
          pause()
        }
      })
      document.addEventListener('visibilitychange', () => { if (document.hidden) pause() })
      window.addEventListener('game:pause', pause)
      canvas.addEventListener('click', () => { if (g.mode === 'playing') input.lockPointer() })
      touch = new TouchControls(uiRoot, input, () => g.mode === 'playing')
      ;(window as unknown as { __game: unknown }).__game = { game: g, ui, input, save, assets, get campaign() { return progress } }
    } catch (error) {
      console.error('Orbital asset loading failed', error)
      ui.showBootError(i18n.t('boot.connectionError'), () => { void mountGame() })
    }
  }

  await mountGame()
}

function safeGet(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function safeSet(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* Campaign still works in memory this session. */ }
}

boot().catch(error => {
  console.error(error)
  const root = document.getElementById('ui')
  if (root) root.innerHTML = `<div class="fatal">Failed to start: ${String((error as Error)?.message ?? error).replace(/[<>&]/g, '')}</div>`
})
