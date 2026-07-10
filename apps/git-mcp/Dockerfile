ARG NODE_IMAGE=node:22.17.0-alpine
FROM ${NODE_IMAGE}
RUN apk add --no-cache git openssh
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY src ./src
EXPOSE 7103
CMD ["npm", "start"]

