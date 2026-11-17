import '@testing-library/jest-dom/vitest'

// jsdom ships no layout engine, so components that keep the active option in
// view would throw on a method that simply does not exist there.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

// jsdom leaves `window.localStorage` unset for this environment/version combo
// (Node 22+ also ships its own experimental global gated behind
// `--localstorage-file`, which stays undefined too), so any store that reads
// `localStorage` at module load — authStore does, to seed the session from a
// saved token — throws before a single test runs. A tiny in-memory
// implementation is all any test needs; it is not meant to emulate quota or
// storage events, only to stop `undefined.getItem` from crashing imports.
if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage) {
  const store = new Map<string, string>()
  const localStoragePolyfill: Storage = {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key)
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStoragePolyfill,
    writable: true,
    configurable: true,
  })
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', {
      value: localStoragePolyfill,
      writable: true,
      configurable: true,
    })
  }
}
