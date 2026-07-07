# ============================================================
#   Dockerfile — بوت واتساب على Railway
# ============================================================
FROM node:20-slim

# ── تثبيت التبعيات ──────────────────────────────────────────
RUN apt-get update && apt-get install -y \
    chromium \
    python3 \
    python3-pip \
    ffmpeg \
    fonts-liberation \
    fonts-noto \
    ca-certificates \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcairo2 \
    libcairo-gobject2 \
    libcups2 \
    libdbus-1-3 \
    dbus \
    libdrm2 \
    libgbm1 \
    libgdk-pixbuf2.0-0 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libxshmfence1 \
    libxss1 \
    libxtst6 \
    xdg-utils \
    wget \
    --no-install-recommends && \
    pip3 install yt-dlp --break-system-packages && \
    rm -rf /var/lib/apt/lists/*

# ── متغيرات البيئة ──────────────────────────────────────────
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV NODE_ENV=production
ENV DBUS_SESSION_BUS_ADDRESS=/dev/null

# مجلد البيانات الدائمة (settings, warnings, kicked_members)
# Railway: اضبط DATA_DIR=/data في Variables وأضف Volume على /data
ENV DATA_DIR=/app/data

# ── نسخ الملفات ──────────────────────────────────────────────
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

# ── إنشاء مجلدات ─────────────────────────────────────────────
RUN mkdir -p /app/data /tmp/temp_audio

CMD ["node", "index.js"]
