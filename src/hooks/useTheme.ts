import { useEffect, useState } from 'react'
import type { ThemeId } from '../types'
import { THEMES } from '../types'

const KEY = 'menu-app:theme'

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    const saved = localStorage.getItem(KEY) as ThemeId | null
    if (saved && THEMES.some((t) => t.id === saved)) return saved
    return 'salad'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(KEY, theme)
  }, [theme])

  return { theme, setTheme: setThemeState, themes: THEMES }
}
