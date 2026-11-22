export type MissionId = 'relay' | 'lunar'
export type MissionStage = 'approach' | 'docked' | 'eva' | 'complete'
export type CampaignProgress = { relayComplete: boolean; lunarComplete: boolean }

export type MissionDefinition = {
  titleKey: string
  subtitleKey: string
  briefingKey: string
  objectiveKeys: { approach: string; dock: string; eva?: string; repair?: string }
  destinationKey: string
  worldTarget: readonly [number, number, number]
  worldDistance: number
  reportedRangeKm: number
  requiresEva: boolean
}

export const MISSION_DEFINITIONS: Record<MissionId, MissionDefinition> = {
  relay: {
    titleKey: 'mission.relay.title',
    subtitleKey: 'mission.relay.subtitle',
    briefingKey: 'mission.relay.briefing',
    destinationKey: 'mission.relay.destination',
    objectiveKeys: {
      approach: 'objective.relay.approach',
      dock: 'objective.relay.dock',
      eva: 'objective.relay.eva',
      repair: 'objective.relay.repair',
    },
    worldTarget: [-8, 1.5, -78],
    worldDistance: 78.5,
    reportedRangeKm: 240,
    requiresEva: true,
  },
  lunar: {
    titleKey: 'mission.lunar.title',
    subtitleKey: 'mission.lunar.subtitle',
    briefingKey: 'mission.lunar.briefing',
    destinationKey: 'mission.lunar.destination',
    objectiveKeys: { approach: 'objective.lunar.approach', dock: 'objective.lunar.dock' },
    worldTarget: [12, 14, -205],
    worldDistance: Math.hypot(12, 14, 205),
    reportedRangeKm: 384_400,
    requiresEva: false,
  },
}

export const INITIAL_CAMPAIGN: CampaignProgress = Object.freeze({ relayComplete: false, lunarComplete: false })
export const CAMPAIGN_STORAGE_KEY = 'orbital.campaign.v1'

export function parseCampaign(raw: string | null): CampaignProgress {
  if (!raw) return { ...INITIAL_CAMPAIGN }
  try {
    const data = JSON.parse(raw) as Record<string, unknown>
    return {
      relayComplete: data.relayComplete === true,
      lunarComplete: data.lunarComplete === true && data.relayComplete === true,
    }
  } catch {
    return { ...INITIAL_CAMPAIGN }
  }
}

export function recordMission(progress: CampaignProgress, id: MissionId): CampaignProgress {
  if (id === 'relay') return { ...progress, relayComplete: true }
  if (!progress.relayComplete) return progress
  return { relayComplete: true, lunarComplete: true }
}

export function isMissionUnlocked(progress: CampaignProgress, id: MissionId): boolean {
  return id === 'relay' || progress.relayComplete
}

export function dockingReadiness(distance: number, speed: number, radius = 10, maxSpeed = 7): { inRange: boolean; safeSpeed: boolean; ready: boolean } {
  const inRange = Number.isFinite(distance) && distance <= radius
  const safeSpeed = Number.isFinite(speed) && speed <= maxSpeed
  return { inRange, safeSpeed, ready: inRange && safeSpeed }
}

export function scaledMissionRange(distance: number, worldDistance: number, reportedRangeKm: number): number {
  if (!Number.isFinite(distance) || !Number.isFinite(worldDistance) || worldDistance <= 0) return reportedRangeKm
  return Math.max(0, reportedRangeKm * distance / worldDistance)
}

export function canServiceRelay(distance: number, radius = 4.5): boolean {
  return Number.isFinite(distance) && distance <= radius
}
