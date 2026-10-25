# Space Impact: a static single-page game plus a tiny dependency-free Node
# server that stamps the build id into the page and answers GET /version.
# No npm dependencies, so there is no install or build stage.
#
# The base image is pinned by DIGEST, not just a tag: a tag can move under
# you between builds, a digest can't. Re-resolve it every so often:
#
#   docker pull node:24-alpine
#   docker inspect --format='{{index .RepoDigests 0}}' node:24-alpine
#
# Current pin: node:24-alpine (Node 24.22.1), multi-arch index digest as
# published by docker-library on 2026-10-21.
FROM node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53
WORKDIR /app
ENV NODE_ENV=production
# Copy exactly what server/buildid.mjs hashes (SERVED), so the build id the
# container reports matches the one CI computes from the same commit.
COPY package.json ./
COPY server ./server
COPY public ./public
EXPOSE 80
CMD ["node", "server/index.mjs"]
