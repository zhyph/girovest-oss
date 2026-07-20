import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import common from './locales/pt-BR/common.json'
import auth from './locales/pt-BR/auth.json'

i18n.use(initReactI18next).init({
  lng: 'pt-BR',
  fallbackLng: 'pt-BR',
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  resources: {
    'pt-BR': { common, auth },
  },
})

export default i18n
