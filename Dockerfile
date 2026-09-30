FROM node:20

WORKDIR /app

COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev

COPY . .

ENV PORT=4000
ENV DATA_DIR=/data
EXPOSE 4000

CMD ["node", "backend/server.js"]
