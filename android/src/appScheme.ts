// Схема deep link'ов зависит от варианта сборки (app.config.js): у личной и
// демо-сборки своя, иначе вход через Яндекс/VK и виджет возвращаются в обычный
// ФИНИК, установленный рядом. EXPO_PUBLIC_* вшивается в бандл при сборке —
// надёжнее Constants.extra.
const VARIANT = process.env.EXPO_PUBLIC_APP_VARIANT || '';
export const APP_SCHEME = VARIANT === 'personal' ? 'familybudgetpersonal'
  : VARIANT === 'demo' ? 'familybudgetdemo'
  : 'familybudget';
export const IS_PERSONAL = VARIANT === 'personal';
