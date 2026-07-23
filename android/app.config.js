// Демо-вариант сборки: тот же код, но другой package (ставится рядом с основным),
// название с «Демо», флаг extra.isDemo (включает вход по паролю lena/Lena).
// Включается переменной APP_VARIANT=demo (в CI, build_type: demo).
// Обычная сборка — без изменений (возвращаем app.json как есть).
const base = require('./app.json').expo;

module.exports = () => {
  // versionCode берём из CI (APP_VERSION_CODE = github.run_number, монотонно растёт),
  // иначе из app.json. Так каждая сборка получает уникальный, всегда больший код —
  // RuStore/Play не ругаются на «Version Code меньше предыдущего».
  const versionCode = process.env.APP_VERSION_CODE
    ? parseInt(process.env.APP_VERSION_CODE, 10)
    : base.android.versionCode;

  if (process.env.APP_VARIANT !== 'demo') {
    return { expo: { ...base, android: { ...base.android, versionCode } } };
  }

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
        versionCode,
      },
      extra: { ...(base.extra || {}), isDemo: true },
    },
  };
};
