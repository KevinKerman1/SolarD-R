FROM node:20-alpine

WORKDIR /app

# Install server dependencies first (better layer caching)
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev --no-audit --no-fund

# Copy everything else (HTML, assets, server source)
COPY . .

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server/index.js"]
