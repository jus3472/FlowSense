export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'flowsense-theme'
export const THEME_ATTRIBUTE = 'data-theme'

/**
 * Runs in <head> before first paint, so the page never renders in one theme and
 * snaps to the other. A stored manual choice sticks permanently; new visitors
 * start in light mode.
 */
export const themeInitScript = `(function(){try{var s=localStorage.getItem('${THEME_STORAGE_KEY}');var t=(s==='light'||s==='dark')?s:'light';document.documentElement.setAttribute('${THEME_ATTRIBUTE}',t)}catch(e){document.documentElement.setAttribute('${THEME_ATTRIBUTE}','light')}})()`
