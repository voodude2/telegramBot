FROM node:20-alpine

WORKDIR /usr/src/app

# Copy manifests first so the dependency layer caches across code changes.
COPY package*.json .npmrc ./

# npm ci installs exactly what package-lock.json pins — reproducible, unlike
# npm install, which can resolve different versions between builds.
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node . .

# Drop root; the base image already provides an unprivileged `node` user.
USER node

ENV NODE_ENV=production
EXPOSE 3000

# Give the platform a real readiness signal rather than assuming the port is up.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Exec form, so SIGTERM reaches node directly and graceful shutdown actually runs
# (npm would swallow the signal).
CMD ["node", "index.js"]
