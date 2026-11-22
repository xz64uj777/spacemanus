import { CONFIG, DEFAULT_CONFIG } from './config'

type Mode = 'LIVE' | 'NEXT_RUN'
type Control = { id: string; type: 'number'; category: string; label: string; description: string; unit: string;
  default: number; min: number; max: number; step: number; applyMode: Mode; integrity: 'COSMETIC' | 'GAMEPLAY' }
type Binding = { control: Control; read(): number; write(value: number): void }
const bindings: Binding[] = []
function number<S extends 'flight' | 'eva'>(section: S, key: keyof typeof CONFIG[S] & string,
  label: string, min: number, max: number, step: number, unit: string, applyMode: Mode = 'LIVE'): void {
  const values = CONFIG[section] as Record<string, number>
  const defaults = DEFAULT_CONFIG[section] as Record<string, number>
  bindings.push({ control: Object.freeze({ id: `${section}.${key}`, type: 'number', category: section === 'flight' ? 'Flight systems' : 'EVA systems',
    label, description: applyMode === 'NEXT_RUN' ? 'Applies when the next mission starts.' : 'Updates this preview immediately.',
    unit, default: defaults[key], min, max, step, applyMode, integrity: 'GAMEPLAY' }),
    read: () => values[key], write: value => { values[key] = value } })
}
number('flight', 'acceleration', 'Main thrust', 3, 18, 0.5, 'm/s²')
number('flight', 'strafeAcceleration', 'RCS translation', 2, 10, 0.25, 'm/s²')
number('flight', 'verticalAcceleration', 'Vertical RCS', 2, 10, 0.25, 'm/s²')
number('flight', 'maxSpeed', 'Cruise speed limit', 20, 90, 1, 'm/s')
number('flight', 'boostMultiplier', 'Boost multiplier', 1, 2.5, 0.05, '×')
number('flight', 'braking', 'Retro-thrust braking', 1, 5, 0.1, 'm/s²')
number('flight', 'dockRadius', 'Docking capture radius', 5, 18, 0.5, 'm', 'NEXT_RUN')
number('flight', 'dockMaxSpeed', 'Docking speed limit', 3, 12, 0.5, 'm/s', 'NEXT_RUN')
number('eva', 'acceleration', 'Suit thruster response', 1, 8, 0.25, 'm/s²')
number('eva', 'maxSpeed', 'EVA movement speed', 1, 7, 0.25, 'm/s')
number('eva', 'tetherLength', 'Safety tether', 14, 45, 1, 'm', 'NEXT_RUN')
number('eva', 'oxygenSeconds', 'Suit oxygen supply', 60, 240, 10, 's', 'NEXT_RUN')

const byId = new Map(bindings.map(binding => [binding.control.id, binding]))
let requested = Object.fromEntries(bindings.map(({ control }) => [control.id, control.default]))
let unranked = false
const gameplayModified = () => bindings.some(binding => binding.control.integrity === 'GAMEPLAY' && binding.read() !== binding.control.default)
export const tuning = {
  get unranked(): boolean { return unranked },
  controls: Object.freeze(bindings.map(({ control }) => control)),
  read() {
    return { requested: { ...requested }, active: Object.fromEntries(bindings.map(binding => [binding.control.id, binding.read()])) }
  },
  apply(patch: unknown): void {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid patch')
    const entries = Object.entries(patch)
    if (entries.length > bindings.length) throw new Error('Invalid patch')
    for (const [id, value] of entries) {
      const control = byId.get(id)?.control
      if (!control || typeof value !== 'number' || !Number.isFinite(value) || value < control.min || value > control.max) throw new Error('Invalid value')
      const steps = (value - control.min) / control.step
      if (value !== control.default && Math.abs(steps - Math.round(steps)) > 1e-7) throw new Error('Invalid increment')
    }
    requested = { ...requested, ...patch } as Record<string, number>
    for (const [id, value] of entries) {
      const binding = byId.get(id)!
      if (binding.control.applyMode === 'LIVE') binding.write(value as number)
    }
    unranked ||= gameplayModified()
  },
  activate(boundary: 'run' | 'jump' | 'dash'): void {
    if (boundary !== 'run') return
    for (const [id, value] of Object.entries(requested)) {
      const binding = byId.get(id)
      if (binding?.control.applyMode === 'NEXT_RUN') binding.write(value)
    }
    unranked = gameplayModified()
  },
}
