/** Keep Manus Storage for the project preview; GitHub Pages serves checked-in public assets. */
const githubPages = import.meta.env.MODE === 'github-pages'
const publicAsset = (path: string) => `${import.meta.env.BASE_URL}${path}`

export const MODEL_URLS = Object.freeze({
  ship: githubPages
    ? publicAsset('models/crew_shuttle.glb')
    : '/manus-storage/game/sha256/14c0f14c7693d004a662369ea70d1348c174f26fdb64c42e13c49ceabbbf99c8.glb',
  astronaut: githubPages
    ? publicAsset('models/eva_astronaut.glb')
    : '/manus-storage/game/sha256/b91b2a01a934e923cdc89c526a9424f60ac5a6a92775c04a15ede62a54ecb9e8.glb',
})

export const FAVICON_URL = githubPages
  ? publicAsset('favicon.png')
  : '/manus-storage/game/sha256/302cb175090b2f4a2b6cf096eacea412e0c1e610719e2ec8b5481ea7e7a2ecb4.png'
