export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'flowsense-theme'
export const THEME_ATTRIBUTE = 'data-theme'

/**
 * Runs in <head> before first paint, so the page never renders in one theme and
 * snaps to the other. The system preference is consulted only when nothing has
 * been stored, which is what makes a manual choice stick permanently.
 */
export const themeInitScript = `(function(){try{var s=localStorage.getItem('${THEME_STORAGE_KEY}');var t=(s==='light'||s==='dark')?s:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('${THEME_ATTRIBUTE}',t)}catch(e){document.documentElement.setAttribute('${THEME_ATTRIBUTE}','light')}})()`
