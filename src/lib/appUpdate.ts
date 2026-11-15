const RELOAD_KEY = 'menu-app:chunk-reload'

function rememberReload(): boolean {
  try {
    if (sessionStorage.getItem(RELOAD_KEY) === '1') return false
    sessionStorage.setItem(RELOAD_KEY, '1')
    return true
  } catch {
    return false
  }
}

function clearReloadFlag(): void {
  try {
    sessionStorage.removeItem(RELOAD_KEY)
  } catch {
    return
  }
}

export function reloadWhenSiteUpdates(): void {
  if (!('serviceWorker' in navigator)) return
  let hadController = Boolean(navigator.serviceWorker.controller)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) {
      hadController = true
      return
    }
    window.location.reload()
  })
}

/** После выкладки старая страница просит файл, которого на сайте уже нет. */
export async function loadFreshChunk<T>(load: () => Promise<T>): Promise<T> {
  try {
    const module = await load()
    clearReloadFlag()
    return module
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const staleChunk =
      message.includes('dynamically imported module') ||
      message.includes('Importing a module script failed')
    if (staleChunk && rememberReload()) {
      window.location.reload()
      return new Promise(() => {})
    }
    throw error
  }
}
