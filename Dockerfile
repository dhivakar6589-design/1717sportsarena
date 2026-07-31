FROM node:20

WORKDIR /app

# Native modules (better-sqlite3) may need build tools if no prebuilt binary exists
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev

COPY . .

ENV PORT=4000
ENV DATA_DIR=/data
EXPOSE 4000

CMD ["node", "backend/server.js"]
