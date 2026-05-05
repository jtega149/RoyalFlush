FROM node:22
WORKDIR /app
COPY package*.json .
RUN npm ci --omit=dev
COPY . .
EXPOSE 3001
CMD ["npm", "run", "start"]