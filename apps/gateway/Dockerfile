ARG NODE_IMAGE=node:22.17.0-alpine
FROM ${NODE_IMAGE}
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY src ./src
EXPOSE 7000
CMD ["npm", "start"]

