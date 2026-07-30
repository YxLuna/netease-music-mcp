FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /data && chown -R node:node /app /data

USER node

ENV NETEASE_PERSONAL_HOST=0.0.0.0
ENV NETEASE_PERSONAL_PORT=3304
ENV NETEASE_PERSONAL_STORE_FILE=/data/auth.json
ENV NETEASE_PERSONAL_MASTER_KEY_FILE=/data/master.key

EXPOSE 3304
VOLUME ["/data"]

CMD ["npm", "run", "start:personal"]
