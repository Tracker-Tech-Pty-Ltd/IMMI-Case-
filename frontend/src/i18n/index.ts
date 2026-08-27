import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import en from './locales/en.json'

type CatalogueLoader = () => Promise<{ default: Record<string, unknown> }>

/**
 * Locale catalogues that are deliberately NOT bundled into the entry chunk.
 *
 * `en` stays a static import because it is the `fallbackLng` — every session
 * needs it. Every other catalogue is fetched on demand so a visitor never
 * downloads ~18.5 KB gzip of a language they are not using on the critical
 * path. When adding a locale, add it HERE — never as a static import.
 */
const LAZY_CATALOGUES: Record<string, CatalogueLoader> = {
  'zh-TW': () => import('./locales/zh-TW.json'),
}

const BCP47_MAP: Record<string, string> = {
  en: 'en-AU',
  'en-AU': 'en-AU',
  'zh-TW': 'zh-Hant-AU',
}

function syncHtmlLang(lng: string): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = BCP47_MAP[lng] ?? lng
  }
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { common: en },
    },
    ns: ['common'],
    defaultNS: 'common',
    fallbackLng: 'en',
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
    interpolation: {
      escapeValue: false,
    },
    react: {
      // `addResourceBundle` emits `added` on the resource STORE, not on the
      // i18n instance, so react-i18next needs `bindI18nStore` to re-render
      // once a lazily fetched catalogue arrives. Without this, switching
      // language at runtime would register the strings but never repaint.
      bindI18n: 'languageChanged loaded',
      bindI18nStore: 'added',
    },
  })

/**
 * Fetch and register a lazily bundled catalogue.
 *
 * Idempotent: the `hasResourceBundle` guard both avoids a second network
 * request and stops the `changeLanguage` call below from recursing through the
 * `languageChanged` listener.
 *
 * Returns `true` when the catalogue is available afterwards, `false` when the
 * chunk could not be fetched (offline, a 404 during a rolling deploy, a
 * corporate proxy). The caller decides what to do; this function never throws
 * and never leaves the app in a half-switched state.
 */
async function ensureCatalogue(lng: string | undefined): Promise<boolean> {
  if (!lng) return true
  const load = LAZY_CATALOGUES[lng]
  if (!load) return true
  if (i18n.hasResourceBundle(lng, 'common')) return true
  try {
    const mod = await load()
    i18n.addResourceBundle(lng, 'common', mod.default, true, true)
  } catch (error) {
    // A failed locale chunk must NEVER blank the app. Report it and let the
    // caller fall back; `fallbackLng: 'en'` means every key still resolves.
    console.error(`[i18n] failed to load the "${lng}" catalogue`, error)
    return false
  }
  // Re-emit languageChanged so `resolvedLanguage` and any listener bound to
  // that event pick up the newly available catalogue.
  await i18n.changeLanguage(lng)
  return true
}

// Sync <html lang> on every language switch (WCAG 3.1.1), and pull in the
// catalogue when the user switches to a lazily bundled locale at runtime
// (frontend/src/components/layout/Topbar.tsx:61).
//
// `previousLanguage` is captured before the switch so a failed fetch can put
// the user back where they were instead of stranding them on a language whose
// strings never arrived. Retry = switching language again, which re-enters
// ensureCatalogue because hasResourceBundle is still false.
let previousLanguage: string = i18n.language ?? 'en'
i18n.on('languageChanged', (lng: string) => {
  syncHtmlLang(lng)
  const priorLanguage = previousLanguage
  previousLanguage = lng
  void ensureCatalogue(lng).then((ok) => {
    if (!ok && priorLanguage && priorLanguage !== lng) {
      void i18n.changeLanguage(priorLanguage)
    }
  })
})

// Top-level await: `main.tsx` does a side-effect `import "./i18n"` before it
// renders, so blocking here guarantees a zh-TW visitor never sees a frame of
// English or of raw i18n keys. English visitors load nothing extra.
//
// If the fetch fails, fall back to English rather than rendering nothing:
// `ensureCatalogue` has already logged, and every key resolves through
// `fallbackLng`. A degraded-language app beats a white screen.
const initialLoaded = await ensureCatalogue(i18n.language)
if (!initialLoaded) {
  await i18n.changeLanguage('en')
}

// Set initial value once the detected language is known
if (i18n.language) {
  syncHtmlLang(i18n.language)
}

export default i18n
