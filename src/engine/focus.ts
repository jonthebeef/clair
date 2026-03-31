/**
 * Terminal focus detection.
 *
 * Uses macOS `lsappinfo` to check if Terminal/iTerm2/Ghostty is the
 * frontmost app. Falls back to assuming focused if detection fails.
 */

import { $ } from 'bun'

const TERMINAL_APPS = new Set([
  'terminal', 'iterm2', 'ghostty', 'alacritty', 'kitty', 'wezterm',
  'warp', 'hyper', 'tabby',
])

let lastCheck = 0
let cached = true
const CACHE_MS = 3_000 // re-check every 3s at most

export async function isTerminalFocused(): Promise<boolean> {
  const now = Date.now()
  if (now - lastCheck < CACHE_MS) return cached

  lastCheck = now
  try {
    const result = await $`lsappinfo info -only name $(lsappinfo front)`.text()
    // Output looks like: "name" = "Ghostty"
    const match = result.match(/"name"\s*=\s*"(.+?)"/)
    if (match) {
      const appName = match[1].toLowerCase()
      cached = TERMINAL_APPS.has(appName)
    } else {
      cached = true // assume focused if we can't determine
    }
  } catch {
    cached = true
  }
  return cached
}
