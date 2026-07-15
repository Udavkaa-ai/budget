# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Что это

Семейный бюджет: несколько пользователей в одной семье ведут расходы и видят общую статистику в реальном времени. Три клиента к одному серверу:

- **Веб-PWA** (`public/`) — ванильный JS без сборки, деплоится на Amvera. Целевая платформа для iOS-пользователей.
- **Android-приложение** (`android/`) — React Native + Expo SDK 51. Функционал и визуал держим 1:1 с вебом; эксклюзив Android — офлайн-режим и локальный ключ шифрования.
- **Telegram-бот** (`src/index.js`) — ОТКЛЮЧЁН, не трогать и не запускать.

`README.md` описывает старого телеграм-бота и устарел; актуальное описание веба — в `.vibe.md`, монетизация — в `MONETIZATION.md`.

## Ветки и деплой (важно!)

Рабочих ветки ровно две, обе должны содержать идентичные `src/` и `public/`:

- **`deploy`** — пуш сюда автодеплоит веб+сервер на Amvera (cloud.amvera.ru). Имя ветки намеренно без слэша: Amvera обрезает имя ветки по первому `/` и не матчит вебхук.
- **`android/react-native`** — пуш сюда собирает APK в GitHub Actions (`.github/workflows/android-build.yml`, артефакт `family-budget-standalone-N`). Amvera на такие пуши шлёт уведомление «несоответствие веток» — это безвредный шум.

Ветки `claude/*` заморожены (архив), в них не пушить. Изменения сервера/веба делать на `deploy`, затем синхронизировать в android-ветку (`git checkout deploy -- src/ public/` из android-ветки). Изменения только приложения — сразу в android-ветку.

Amvera: постоянное хранилище примонтировано в `/data` (env `DATA_FILE=/data/expenses.json`), конфиг — `amvera.yml`/`amvera.yaml` в корне (дубли с обоими именами обязательны). `Dockerfile` — запасной для других хостингов.

## Команды

```bash
# Сервер локально (веб-сервер — это src/server.js; npm start запускает ОТКЛЮЧЁННОГО бота!)
DATA_FILE=/tmp/expenses.json PORT=3456 node src/server.js

# Синтаксис серверных файлов
node --check src/server.js && node --check src/storage.js && node --check public/app.js # app.js через new Function

# Приложение: типы (единственная проверка перед пушем — CI не типизирует, Metro просто strip'ает)
cd android && npm install --legacy-peer-deps && npx tsc --noEmit

# APK: только через CI (пуш в android/react-native), локальной сборки нет
```

Тестов в проекте нет. Проверка изменений сервера — smoke-запуск + curl `/health`.

## Архитектура

**Хранилище** — один JSON-файл (`storage.js`, путь из `DATA_FILE`): expenses, users, goals, familySettings (budgetPlan/cashflow/customCategories/e2e), sync (E2E-блобы), backups. Всё сегментировано по `family` через хелпер `fam()`. Запись — debounced, поэтому при подмене файла на сервере сначала останавливать процесс.

**Аутентификация**: JWT `{login, name, family, isAdmin}`. Google OAuth двумя путями: веб — GIS `POST /api/auth/google` (credential), приложение — WebView-флоу `GET /auth/google/mobile` → callback → редирект с токеном (требует `GOOGLE_CLIENT_SECRET`; `trust proxy` включён ради https в redirect_uri). `POST /api/auth/link-google` привязывает Google к легаси-аккаунту и сливает автосозданный дубликат (расходы переносятся по имени).

**Категории** — динамические: базовый список в `src/parser.js` (`CATEGORIES`) + пользовательские на семью (`customCategories` в familySettings). Клиенты берут объединённый список из `GET /api/settings`. Удаление своей категории переносит её расходы в «Прочее». В краудсловарь классификатора пользовательские категории не отправляются. AI-промпты парсеров получают список категорий семьи параметром.

**E2E-слой (этап A готов, B/C в работе, см. таски)**: `/api/sync/records` (шифроблобы с LWW-версиями и seq-курсором), `/api/sync/doc/:key`, `/api/family/enable-e2e` (вайпит плейнтекст семьи), `/api/analyze-raw` (ИИ по клиентским агрегатам). Крипто в приложении: `android/src/crypto.ts` — AES-256-GCM (@noble/ciphers), ключ семьи в SecureStore, экспорт hex-фразой. Шифрованные бэкапы уже работают: клиент шифрует снапшот `GET /api/snapshot` → `POST /api/backup` (сервер хранит непрозрачный блоб, максимум 10 на семью), восстановление — расшифровка на устройстве → `POST /api/restore`.

**Формы ответов сервера, на которых уже обжигались**:
- `GET /api/expenses/day?date=YYYY-MM-DD` (не DD.MM.YYYY!) → `{ entries: [...] }`
- Цели: сервер хранит `targetAmount` + `contributions[]`; клиентский `goals` в `android/src/api/client.ts` нормализует в `{target, saved}` — при изменениях сохранять маппинг
- Бюджет-план: `PUT /api/budget-plan` (не POST); `plan.incomes` — Record<имяПользователя, число>
- Даты расходов везде `DD.MM.YYYY` строками
- Кэшфлоу: `{ members: {имя: {debit, credit, savings}}, incomeDays: [{day, user, amount}] }`

**Android-приложение** (`android/src/`):
- `api/client.ts` — весь HTTP; `hooks/useAuth.ts`, `premium.ts`, `blocks.ts`, `categories.ts`, `theme/index.ts` — глобальные сторы одного паттерна (module state + listeners + hook)
- `classifier/` — локальный наивный Байес по спеке (SQLite, entropy-фильтр, режимы auto/buttons/full); обучается на любых категориях, `predict()` принимает динамический список
- `offline.ts` — outbox в SQLite: расходы без сети встают в очередь (⏳ в ленте), досылаются на foreground/каждые 30с
- Тема копирует веб-палитру (`:root` из `public/style.css`, primary #5947E0); режимы светлая/тёмная/авто. Общие компоненты — `components/UI.tsx` (Field, PrimaryButton с градиентом), `components/Pickers.tsx`
- «Конструктор аналитики» — переключатели блоков/вкладок, локально на устройство (в вебе то же через localStorage `analytics_blocks`)
- Премиум (ИИ-фичи) — тестовый флаг в `premium.ts`; перед публикацией в Google Play заменить на Play Billing

**Expo SDK 51 пины** (не обновлять бездумно): expo-sqlite `~14.0.6` (v13 — это SDK 50 и ломает gradle), `main: "expo/AppEntry.js"` (expo-router не используется), expo-sqlite НЕ добавлять в plugins app.json (роняет prebuild). SafeAreaView — только из `react-native-safe-area-context`.

**Веб** (`public/`): один `app.js` (~3600 строк), `index.html`, `style.css`; PWA с service worker (network-first). Категории/иконки — `CATEGORY_ICONS`/`PLAN_CATEGORIES` синхронизируются с сервером через `applyCustomCategories()`. GIS-кнопка инициализируется на экране логина; общий callback `handleGoogleCredential` роутит вход/привязку по наличию сессии.

## Конвенции сессии

- Пользовательские тексты и коммиты — вежливый русский в UI, коммиты на английском
- Сервер отвечает русскими сообщениями об ошибках `{ error: '...' }`
- Пуш-уведомления не должны содержать сумм для E2E-семей
