FROM node:20-slim

# yt-dlp standalone binary (self-contained, no python install needed)
ADD https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux /usr/local/bin/yt-dlp
RUN chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

# Skip Chromium download — puppeteer is an optional lazy fallback in scraper.ts
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
EXPOSE 3001
CMD ["npx", "tsx", "src/index.ts"]
