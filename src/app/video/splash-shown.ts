export const SPLASH_SHOWN_KEY = 'ja2-node:splashShown';
export const SPLASH_SHOWN = '1';

export function splashShownThisTab(): boolean {
  try {
    return sessionStorage.getItem(SPLASH_SHOWN_KEY) === SPLASH_SHOWN;
  } catch {
    return false;
  }
}

export function markSplashShown(): void {
  try {
    sessionStorage.setItem(SPLASH_SHOWN_KEY, SPLASH_SHOWN);
  } catch {}
}
