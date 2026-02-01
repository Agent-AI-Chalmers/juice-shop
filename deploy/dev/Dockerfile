# 1. 直接使用完整的 Node 22 镜像（基于 Debian），自带 npm, shell, git 等
FROM node:22-bookworm

# 2. 设置工作目录
WORKDIR /app

# 3. 复制所有文件（开发镜像不建议删减，保留源码和工程结构）
COPY . .

# 4. 安装全量依赖（包括 devDependencies，这对代码分析很重要）
# --unsafe-perm 是为了防止某些 node 脚本在 root 下安装失败
RUN npm install --unsafe-perm

# 暴露端口
EXPOSE 3000

# 直接启动（使用 ts-node 或编译后的 js）
CMD ["npm", "start"]