FROM node:22-bookworm-slim
WORKDIR /capture
# Fail the build rather than fall back to a volatile queue on unsupported Node.
RUN node -e "if(Number(process.versions.node.split('.')[0])!==22||typeof require('node:sqlite').DatabaseSync!=='function')process.exit(1)"
COPY --chown=10001:10001 gateway.cjs ./gateway.cjs
USER 10001:10001
EXPOSE 3180
CMD ["node", "gateway.cjs", "serve"]
