import { useEffect, useState } from 'react'
import type { ThemeId } from '../types'
import { THEMES } from '../types'

const KEY = 'menu-app:theme'

/** Верх экрана телефона — тот же цвет, что и фон темы. */
const THEME_BAR: Record<ThemeId, string> = {
  yellow: '#ffe99a',
  salad: '#e8f5c8',
  sky: '#d7efff',
  pink: '#ffd9e6',
  lilac: '#e8dcff',
  white: '#ffffff',
  black: '#1a1a1a',
}

function applyThemeChrome(theme: ThemeId) {
  document.documentElement.setAttribute('data-theme', theme)
  const bar = document.querySelector('meta[name="theme-color"]')
  bar?.setAttribute('content', THEME_BAR[theme])
  const apple = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
  apple?.setAttribute('content', theme === 'black' ? 'black' : 'default')
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    const saved = localStorage.getItem(KEY) as ThemeId | null
    if (saved && THEMES.some((t) => t.id === saved)) return saved
    return 'salad'
  })

  useEffect(() => {
    applyThemeChrome(theme)
    localStorage.setItem(KEY, theme)
  }, [theme])

  return { theme, setTheme: setThemeState, themes: THEMES }
}
