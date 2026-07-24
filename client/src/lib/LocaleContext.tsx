import { createContext, useContext, type ReactNode } from 'react'
import { DEFAULT_LOCALE, getLocaleConfig } from './locale.ts'

const LocaleContext = createContext<string>(DEFAULT_LOCALE)

export function LocaleProvider({ locale, children }: { locale: string; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
}

export function useLocale() {
  const locale = useContext(LocaleContext)
  return { locale, config: getLocaleConfig(locale) }
}
