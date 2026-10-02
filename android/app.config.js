// Варианты сборки (переменная APP_VARIANT, в CI — build_type; личная — коммит с меткой «personal» в квадратных скобках):
//   (пусто)   — обычная публичная сборка (RuStore): app.json + «Поделиться».
//   demo      — демо: отдельный package, имя «Демо», вход lena/Lena.
//   personal  — ЛИЧНАЯ сборка владельца: отдельный package, имя «ФИНИК · Личный»,
//               чтение банковских СМС и уведомлений (plugins/withBankCapture).
//               Только в ней есть разрешение RECEIVE_SMS и сервис уведомлений —
//               в публичный APK этот код и разрешения не попадают вообще.
const fs = require('fs');
const path = require('path');
const base = require('./app.json').expo;

module.exports = () => {
  // versionCode берём из CI (APP_VERSION_CODE = github.run_number, монотонно растёт),
  // иначе из app.json. Так каждая сборка получает уникальный, всегда больший код —
  // RuStore/Play не ругаются на «Version Code меньше предыдущего».
  const versionCode = process.env.APP_VERSION_CODE
    ? parseInt(process.env.APP_VERSION_CODE, 10)
    : base.android.versionCode;
  const variant = process.env.APP_VARIANT || '';
  // «Поделиться → ФИНИК» — во всех сборках (без новых разрешений)
  const plugins = [...(base.plugins || []), './plugins/withShareText'];

  if (variant === 'personal') {
    const pkg = 'com.familybudget.app.personal';
    // Пуш работает, только если в google-services.json есть клиент для этого
    // package (добавить приложение в Firebase). Иначе собираем без FCM.
    let gs = '';
    try { gs = fs.readFileSync(path.join(__dirname, base.android.googleServicesFile || ''), 'utf8'); } catch { /* нет файла */ }
    const { googleServicesFile, ...androidRest } = base.android;
    return {
      expo: {
        ...base,
        name: 'ФИНИК · Личный',
        scheme: 'familybudgetpersonal',
        plugins: [...plugins, './plugins/withBankCapture'],
        android: {
          ...androidRest,
          ...(gs.includes(pkg) ? { googleServicesFile } : {}),
          package: pkg,
          versionCode,
        },
        extra: { ...(base.extra || {}), variant: 'personal' },
      },
    };
  }

  if (variant !== 'demo') {
    return { expo: { ...base, plugins, android: { ...base.android, versionCode } } };
  }

  // Для демо-пакета убираем googleServicesFile (он привязан к основному package
  // com.familybudget.app и иначе валится на несоответствии). Пуш в демо не нужен.
  const { googleServicesFile, ...androidRest } = base.android;

  return {
    expo: {
      ...base,
      name: 'Бюджет · Демо',
      scheme: 'familybudgetdemo',
      plugins,
      android: {
        ...androidRest,
        package: 'com.familybudget.app.demo',
        versionCode,
      },
      extra: { ...(base.extra || {}), isDemo: true },
    },
  };
};
