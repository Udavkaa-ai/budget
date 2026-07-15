# Семейный бюджет — веб-сервер (Amvera / любой Docker-хостинг)
FROM node:20-alpine

WORKDIR /app

# Сначала зависимости — слой кэшируется между деплоями
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY src ./src
COPY public ./public

ENV NODE_ENV=production
# Постоянное хранилище Amvera монтируется в /data —
# данные переживают редеплои
ENV DATA_FILE=/data/expenses.json

EXPOSE 3000

CMD ["node", "src/server.js"]
