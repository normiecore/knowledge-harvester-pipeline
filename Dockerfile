# Build pipeline
FROM node:22-alpine AS build-pipeline
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Build frontend
FROM node:22-alpine AS build-frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Runtime
FROM node:22-alpine
RUN apk add --no-cache curl
WORKDIR /app
COPY --from=build-pipeline /app/dist ./dist
COPY --from=build-pipeline /app/node_modules ./node_modules
COPY package.json ./
COPY prompts/ ./prompts/
COPY --from=build-frontend /app/frontend-dist ./frontend-dist
EXPOSE 3001
CMD ["node", "dist/src/main.js"]
