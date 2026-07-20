// Демо-вариант сборки: тот же код, но другой package (ставится рядом с основным),
// название с «Демо», флаг extra.isDemo (включает вход по паролю lena/Lena).
// Включается переменной APP_VARIANT=demo (в CI, build_type: demo).
// Обычная сборка — без изменений (возвращаем app.json как есть).
const base = require('./app.json').expo;

module.exports = () => {
  if (process.env.APP_VARIANT !== 'demo') return { expo: base };

  // Для демо-пакета убираем googleServicesFile (он привязан к основному package
  // com.familybudget.app и иначе валится на несоответствии). Пуш в демо не нужен.
  const { googleServicesFile, ...androidRest } = base.android;

  return {
    expo: {
      ...base,
      name: 'Бюджет · Демо',
      scheme: 'familybudgetdemo',
      android: {
        ...androidRest,
        package: 'com.familybudget.app.demo',
      },
      extra: { ...(base.extra || {}), isDemo: true },
    },
  };
};
