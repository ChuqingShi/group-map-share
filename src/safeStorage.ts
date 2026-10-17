// localStorage that never throws. Some in-app browsers and private modes block storage; the app must
// still open, it just forgets things.
export const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* not remembered */
    }
  },
};
