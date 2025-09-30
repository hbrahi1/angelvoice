import { createI18n } from 'vue-i18n'
import en from './locales/en.json'
import fr from './locales/fr.json'

const messages = { en, fr }

// Detect browser language (fallback to English)
const userLang = navigator.language.split('-')[0]

export default createI18n({
    locale: messages[userLang] ? userLang : 'en',
    fallbackLocale: 'en',
    messages,
})
