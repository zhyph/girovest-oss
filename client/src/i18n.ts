import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import common from './locales/pt-BR/common.json'
import auth from './locales/pt-BR/auth.json'
import dashboard from './locales/pt-BR/dashboard.json'
import clients from './locales/pt-BR/clients.json'
import products from './locales/pt-BR/products.json'
import allocations from './locales/pt-BR/allocations.json'

i18n.use(initReactI18next).init({
  lng: 'pt-BR',
  fallbackLng: 'pt-BR',
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  resources: {
    'pt-BR': { common, auth, dashboard, clients, products, allocations },
  },
})

export default i18n
