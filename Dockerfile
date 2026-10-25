# Space Impact: a static single-page game plus a tiny dependency-free Node
# server that stamps the build id into the page and answers GET /version.
# No npm dependencies, so nothing to install and nothing to build: one stage.
#
# Base image pinned by digest; Dependabot (.github/dependabot.yml) proposes
# new digests weekly and dependabot-merge.yml merges and deploys them once
# the checks pass. Resolve by hand with
#   docker buildx imagetools inspect node:24-alpine
FROM node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53
WORKDIR /app
ENV NODE_ENV=production PORT=80
# Exactly INPUTS in server/buildid.mjs (test/deploy-contract.test.mjs checks).
COPY Dockerfile package.json package-lock.json ./
COPY server ./server
COPY public ./public
# Stamped at image build with the same script CI runs, so /version and the
# deploy workflow agree by construction.
RUN node server/buildid.mjs > BUILD_ID
USER node
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||80)+'/version').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
