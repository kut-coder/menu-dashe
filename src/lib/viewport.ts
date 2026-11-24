/** Высота и нижний отступ под системные кнопки Android в режиме с иконки. */

function readSafeBottom(): number {
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:fixed;left:0;bottom:0;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom, 0px)'
  document.body.appendChild(probe)
  const value = Number.parseFloat(getComputedStyle(probe).paddingBottom) || 0
  probe.remove()
  return value
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent)
}

export function syncAppViewport(): void {
  const root = document.documentElement
  const visual = window.visualViewport
  const height = Math.round(visual?.height ?? window.innerHeight)
  root.style.setProperty('--app-height', `${Math.max(height, 1)}px`)

  if (!document.body) return

  const safeBottom = readSafeBottom()
  const overlap = visual
    ? Math.max(0, Math.round(window.innerHeight - visual.height - visual.offsetTop))
    : 0

  let bottom = Math.max(safeBottom, overlap)
  // На Android с тремя кнопками safe-area часто 0, меню уезжает под панель.
  if (isStandalone() && isAndroid() && bottom < 24) {
    bottom = 48
  }
  root.style.setProperty('--safe-bottom', `${bottom}px`)
}

export function watchAppViewport(): () => void {
  const sync = () => syncAppViewport()
  sync()
  window.addEventListener('resize', sync)
  window.addEventListener('orientationchange', sync)
  window.visualViewport?.addEventListener('resize', sync)
  window.visualViewport?.addEventListener('scroll', sync)
  return () => {
    window.removeEventListener('resize', sync)
    window.removeEventListener('orientationchange', sync)
    window.visualViewport?.removeEventListener('resize', sync)
    window.visualViewport?.removeEventListener('scroll', sync)
  }
}
