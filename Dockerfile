# Supertext Translation for Mailchimp: the app (runs on Railway).
FROM node:26-alpine

WORKDIR /app

COPY package.json package-lock.json ./
# The Supertext SDK and Supertext Plugin Health are file: dependencies (see docs/DEVELOPER.md → Supertext SDK).
COPY vendor ./vendor
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci && npm cache clean --force

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY public ./public
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
# Not as root: the app writes nothing to disk.
USER node
EXPOSE 8080
# Creates its database on the shared Postgres server if needed, serves the
# pages and checks the Supertext folders of the connected accounts every minute.
CMD ["node", "dist/server.js"]
