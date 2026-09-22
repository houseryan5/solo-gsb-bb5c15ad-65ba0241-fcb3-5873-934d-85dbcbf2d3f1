FROM node:20-alpine

WORKDIR /app

# 零第三方运行时依赖；仍保留依赖安装阶段，便于以后扩展
COPY package.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; \
    elif [ -f npm-shrinkwrap.json ]; then npm ci --omit=dev; \
    else npm install --omit=dev; fi

COPY server.js ./
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# 初始化即启动：容器起来后直接提供页面
CMD ["node", "server.js"]
