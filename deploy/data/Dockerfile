# --- 第一阶段：依赖安装工厂 ---
FROM node:22-bookworm AS builder

WORKDIR /build

# 2. 搬入源码
COPY . .

# 3. 安装：包括 devDependencies，确保分析工具能找到所有定义
RUN npm install --unsafe-perm

# --- 第二阶段：纯数据/代码载体 ---
# 仅使用 ~5MB 的 Alpine，甚至不需要安装 Node
FROM alpine:latest

WORKDIR /app

# 从 builder 阶段复制完整的、已经装好依赖的目录
COPY --from=builder /build ./

# 这里不需要设置任何运行指令，因为它就是个“仓库”
# 输出信息告知使用者挂载路径
CMD ["echo", "Source code and dependencies are ready at /app"]