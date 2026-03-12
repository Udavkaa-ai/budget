# 🤖 Budget Tracker Bot

Telegram-бот для учёта семейных расходов. Два способа ввода: свободным текстом через AI или через форму с кнопками.

## Возможности

- 📝 Ввод текстом: «вчера продукты 2300, кафе 1500»
- 🔘 Ввод через форму с кнопками категорий и сумм
- 👨‍👩‍👧‍👦 Семейный режим: видите расходы друг друга
- ⏰ Напоминания в 20:00 (настраивается)
- 📊 Статистика по категориям и членам семьи
- 📎 Экспорт в CSV
- 🔄 Fallback между AI-моделями
- 💾 Хранение в JSON (без внешних сервисов)

## Интерфейс

```
┌─────────────────────────────┐
│  ➕ Добавить  │  📊 Сегодня │
├───────────────┼─────────────┤
│ 👨‍👩‍👧‍👦 Семья   │   📈 Месяц  │
├─────────────────────────────┤
│         📎 Экспорт          │
└─────────────────────────────┘
```

**Форма добавления:**
1. Выбираешь категорию (кнопки)
2. Вводишь сумму (кнопки или текст)
3. Пишешь описание
4. Готово ✅

## Быстрый старт

```bash
cp .env.example .env
# Заполни токены и ID пользователей

npm install
npm start
```

## Настройка

### Telegram
1. [@BotFather](https://t.me/BotFather) → `/newbot` → сохрани токен
2. [@userinfobot](https://t.me/userinfobot) → узнай свой ID и ID жены

### OpenRouter
1. [openrouter.ai](https://openrouter.ai) → регистрация
2. [Ключи](https://openrouter.ai/keys) → создай API key
3. Пополни на $5 (хватит на год)

### .env
```env
TELEGRAM_BOT_TOKEN=токен_от_botfather
ALLOWED_USERS=твой_id,id_жены
OPENROUTER_API_KEY=sk-or-v1-...

# Напоминания в 20:00 по Москве
REMINDERS_ENABLED=true
REMINDER_HOUR=20
REMINDER_MINUTE=0
```

## Команды

| Команда | Описание |
|---------|----------|
| `/start` | Главное меню |
| `/add` | Форма добавления |
| `/today` | Мои расходы сегодня |
| `/family` | Расходы семьи сегодня |
| `/summary` | Статистика за месяц |
| `/export` | Скачать CSV |

## Напоминания

Каждый день в 20:00 (по Москве) бот отправит вам и жене:

```
🔔 Напоминание о расходах

Сегодня семья потратила: 5 200 ₽

👤 Каа: 3 200 ₽
👤 Жена: 2 000 ₽

Всё записали?

[➕ Добавить расход]
```

Отключить: `REMINDERS_ENABLED=false`

## Категории

🛒 Продукты · 🍽 Кафе · 🚇 Транспорт · 👗 Одежда · 💊 Медицина
🎮 Развлечения · 👶 Дети · 🏠 Дом · 📱 Связь · ❓ Прочее

## Деплой

### PM2
```bash
npm install -g pm2
pm2 start src/index.js --name budget-bot
pm2 save && pm2 startup
```

### Docker
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p data
CMD ["npm", "start"]
```

```bash
docker build -t budget-bot .
docker run -d --name budget-bot \
  -v $(pwd)/data:/app/data \
  --env-file .env \
  budget-bot
```

## Стоимость

~$0.04/месяц при активном использовании (Gemini Flash).
