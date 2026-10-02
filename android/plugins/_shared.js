// Общие помощники для своих config-плагинов ФИНИКА.
const fs = require('fs');
const path = require('path');
const { withMainApplication, withDangerousMod } = require('@expo/config-plugins');

// Регистрирует ReactPackage в MainApplication.getPackages() (Expo SDK 51, Kotlin)
function withReactPackage(config, fqcn) {
  return withMainApplication(config, cfg => {
    let src = cfg.modResults.contents;
    if (src.includes(fqcn)) return cfg;
    if (!src.includes('/* finik-packages */')) {
      src = src.replace(
        /return PackageList\(this\)\.packages(?!\.apply)/,
        'return PackageList(this).packages.apply {\n              /* finik-packages */\n            }',
      );
    }
    if (!src.includes('/* finik-packages */')) throw new Error('finik: не нашёл getPackages() в MainApplication');
    src = src.replace('/* finik-packages */', `/* finik-packages */\n              add(${fqcn}())`);
    cfg.modResults.contents = src;
    return cfg;
  });
}

// Кладёт Kotlin-файлы в android/app/src/main/java/<pkgPath>/
function withKotlinFiles(config, pkg, files) {
  return withDangerousMod(config, ['android', async cfg => {
    const dir = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/java', ...pkg.split('.'));
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
    return cfg;
  }]);
}

module.exports = { withReactPackage, withKotlinFiles };
