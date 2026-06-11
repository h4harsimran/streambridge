FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY index.js ./
COPY lib/ ./lib/
COPY public/ ./public/

ENV PORT=7000
EXPOSE 7000

CMD ["node", "index.js"]
