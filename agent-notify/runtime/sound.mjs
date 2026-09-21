export const SOUND_MODES = ['builtin', 'custom', 'muted']
export const DEFAULT_SOUND_MODE = 'builtin'
export const DEFAULT_SOUND_VOLUME = 1
export const BUILTIN_SOUND_FILE = 'assets/agent-notify.wav'

function clampVolume(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_SOUND_VOLUME
  return Math.min(1, Math.max(0, n))
}

export function normalizeSoundConfig(input = {}, fallback = {}) {
  const base = {
    soundMode: DEFAULT_SOUND_MODE,
    soundPath: '',
    soundVolume: DEFAULT_SOUND_VOLUME,
    ...fallback,
  }
  const next = { ...base }
  if (SOUND_MODES.includes(input.soundMode)) next.soundMode = input.soundMode
  if (Object.prototype.hasOwnProperty.call(input, 'soundPath')) {
    next.soundPath = String(input.soundPath || '').trim()
  }
  if (Object.prototype.hasOwnProperty.call(input, 'soundVolume')) {
    next.soundVolume = clampVolume(input.soundVolume)
  }
  return next
}

/**
 * Resolve a playable file for the current settings.
 * muted / custom-without-path → null (no sound), matching the pre-migration host.
 */
export function resolveSoundPlay(config, pluginDir) {
  const { soundMode, soundPath, soundVolume } = normalizeSoundConfig(config)
  if (soundMode === 'muted') return null
  if (soundMode === 'custom') {
    if (!soundPath) return null
    return { path: soundPath, volume: soundVolume }
  }
  const dir = String(pluginDir || '').replace(/[\\/]+$/, '')
  if (!dir) return null
  return { path: `${dir}/${BUILTIN_SOUND_FILE}`, volume: soundVolume }
}
