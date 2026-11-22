import type * as THREE from 'three'

export type ModelId = 'ship' | 'astronaut'
export type ModelAsset = { scene: THREE.Object3D }
export type ModelSet = Partial<Record<ModelId, ModelAsset>>
export type ModelUrls = Record<ModelId, string>

/** Keep usable registered models and report only the assets that could not be fetched. */
export async function loadRegisteredModels(
  urls: ModelUrls,
  load: (url: string) => Promise<ModelAsset>,
  onUnavailable: (model: ModelId, error: unknown) => void = () => {},
): Promise<ModelSet> {
  const tryLoad = async (model: ModelId): Promise<ModelAsset | undefined> => {
    try {
      return await load(urls[model])
    } catch (error) {
      onUnavailable(model, error)
      return undefined
    }
  }

  const [ship, astronaut] = await Promise.all([tryLoad('ship'), tryLoad('astronaut')])
  return {
    ...(ship ? { ship } : {}),
    ...(astronaut ? { astronaut } : {}),
  }
}
