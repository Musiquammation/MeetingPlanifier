FROM node:24-bookworm
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV USE_HTTPS=0 PORT=8020 HOSTNAME=0.0.0.0
EXPOSE 8020
CMD ["npm", "run", "server"]
