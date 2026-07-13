#!/usr/bin/env bash
set -e

# ================== 基础变量 ==================
USERNAME=$(whoami)
USERNAME_LOWER=$(echo "$USERNAME" | tr '[:upper:]' '[:lower:]')

# 检测域名后缀
if hostname | grep -q "ct8.pl"; then
    DOMAIN_SUFFIX="ct8.pl"
else
    DOMAIN_SUFFIX="serv00.net"
fi

MAIN_DOMAIN="${USERNAME_LOWER}.${DOMAIN_SUFFIX}"
KUMA_DIR="${HOME}/domains/${MAIN_DOMAIN}/uptime-kuma"
KUMA_REPO="https://github.com/oyz8/Uptime_Kuma/releases/download/v2.4.0-3/uptime-kuma.zip"

# 保活服务配置
KEEP_SUBDOMAIN="auto-keep"
KEEP_DOMAIN="${KEEP_SUBDOMAIN}.${USERNAME_LOWER}.${DOMAIN_SUFFIX}"
KEEP_DIR="${HOME}/domains/${KEEP_DOMAIN}/public_nodejs"
APP_JS_URL="https://raw.githubusercontent.com/oyz8/Uptime_Kuma/main/app.js"

# 颜色
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ================== 环境检查 ==================
command -v devil >/dev/null 2>&1 || error "请在 Serv00/CT8 环境中运行。"
command -v npm   >/dev/null 2>&1 || error "请先启用 Node.js（如：devil binexec on node22）。"

# ================== 自动分配端口 ==================
auto_port() {
    local existing=$(devil port list | awk '/tcp/{print $1; exit}')
    if [[ -n "$existing" ]]; then
        echo "$existing"
        return
    fi
    for ((i=0; i<100; i++)); do
        local port=$((RANDOM % 55535 + 10000))
        if devil port add tcp "$port" >/dev/null 2>&1; then
            echo "$port"
            return
        fi
    done
    error "无法自动分配端口"
}

# ================== 反向代理（Uptime Kuma 用） ==================
setup_kuma_proxy() {
    local port=$1

    # 删除默认的 index.html 占位文件，避免干扰反向代理
    local default_index="${HOME}/domains/${MAIN_DOMAIN}/public_html/index.html"
    if [ -f "$default_index" ]; then
        info "删除默认 index.html ..."
        rm -f "$default_index"
    fi

    if devil www list "$MAIN_DOMAIN" 2>/dev/null | grep -q "proxy.*:${port}"; then
        info "Uptime Kuma 反向代理已存在，跳过。"
        return
    fi
    devil www del "$MAIN_DOMAIN" >/dev/null 2>&1 || true
    sleep 1
    for i in {1..3}; do
        info "添加反向代理 (尝试 $i): ${MAIN_DOMAIN} -> localhost:${port}"
        if devil www add "$MAIN_DOMAIN" proxy localhost "$port" >/dev/null 2>&1; then
            info "反向代理设置成功。"
            return
        fi
        sleep 2
    done
    error "反向代理添加失败，请手动在面板设置 Proxy 端口 ${port}。"
}

# ================== 第一部分：安装 Uptime Kuma ==================
install_uptime_kuma() {
    info "===== 1/2 安装 Uptime Kuma ====="

    KUMA_PORT=$(auto_port)
    info "Uptime Kuma 端口: ${KUMA_PORT}"

    mkdir -p "$(dirname "$KUMA_DIR")"
    cd "$(dirname "$KUMA_DIR")"
    [[ -d uptime-kuma ]] && rm -rf uptime-kuma

    info "下载预编译包..."
    wget -q --show-progress "$KUMA_REPO" -O uptime-kuma.zip
    unzip -q uptime-kuma.zip -d uptime-kuma && rm -f uptime-kuma.zip
    cd uptime-kuma

    info "修复文件权限..."
    chmod -R +x node_modules

    echo "UPTIME_KUMA_PORT=${KUMA_PORT}" > .env
    echo "DATA_DIR=./data" >> .env

    setup_kuma_proxy "$KUMA_PORT"

    info "Uptime Kuma 安装完成。"
}

# ================== 第二部分：安装保活服务 ==================
install_keeper() {
    info "===== 2/2 安装保活服务 ====="

    # ---- 交互输入保活面板账号密码 ----
    echo ""
    echo "配置保活控制面板登录信息 (直接回车使用默认值):"
    read -p "用户名 (默认: admin): " KEEPER_USER
    KEEPER_USER=${KEEPER_USER:-admin}
    read -p "密码   (默认: admin): " KEEPER_PASS
    KEEPER_PASS=${KEEPER_PASS:-admin}
    echo ""

    # 清理旧网站和目录
    if devil www list | grep -qi "${KEEP_SUBDOMAIN}.*${USERNAME_LOWER}"; then
        devil www del "$KEEP_DOMAIN" || true
    fi
    rm -rf "${HOME}/domains/${KEEP_DOMAIN}" 2>/dev/null || true

    # 添加 DNS 记录
    SERVER_IP=$(devil vhost list | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -1)
    if [ -z "$SERVER_IP" ]; then
        SERVER_IP=$(hostname -i 2>/dev/null | awk '{print $1}')
    fi
    devil dns add "${USERNAME_LOWER}.${DOMAIN_SUFFIX}" "${KEEP_SUBDOMAIN}" A "${SERVER_IP}" 2>/dev/null || true

    # 创建 nodejs 类型网站
    devil www add "$KEEP_DOMAIN" nodejs "$(command -v node22)" production
    sleep 2

    # 确保目录存在
    if [ ! -d "$KEEP_DIR" ]; then
        ACTUAL_PATH=$(find "${HOME}/domains" -maxdepth 1 -iname "*${KEEP_SUBDOMAIN}*" -type d 2>/dev/null | head -1)
        if [ -n "$ACTUAL_PATH" ]; then
            KEEP_DIR="${ACTUAL_PATH}/public_nodejs"
        else
            error "无法找到保活服务目录。"
        fi
    fi

    mkdir -p "${KEEP_DIR}/tmp" "${KEEP_DIR}/logs"
    cd "$KEEP_DIR"

    # 下载 app.js
    info "下载保活服务 app.js ..."
    wget -q "$APP_JS_URL" -O app.js || curl -sL "$APP_JS_URL" -o app.js

    # 替换域名配置
    if sed --version 2>/dev/null | grep -q "GNU"; then
        sed -i "s/domain: 'ct8.pl'/domain: '${DOMAIN_SUFFIX}'/g" app.js
    else
        sed -i '' "s/domain: 'ct8.pl'/domain: '${DOMAIN_SUFFIX}'/g" app.js
    fi

    # 安装依赖
    info "安装 Node.js 依赖..."
    if command -v npm22 >/dev/null 2>&1; then
        npm22 install express basic-auth
    else
        npm install express basic-auth
    fi

    # 生成 config.json（使用交互输入的账号密码）
    info "生成保活配置（含 Uptime Kuma 守护）..."
    cat > config.json << EOF
{
  "username": "${KEEPER_USER}",
  "password": "${KEEPER_PASS}",
  "serverPort": 3000,
  "domain": "${DOMAIN_SUFFIX}",
  "checkInterval": 10,
  "processes": [
    {
      "name": "server/server.js",
      "command": "cd ${KUMA_DIR} && nohup node server/server.js > kuma.log 2>&1 &"
    }
  ]
}
EOF

    # 设置权限
    chmod 755 app.js config.json
    chmod -R 755 "$KEEP_DIR"

    # 启动保活服务
    info "启动保活服务..."
    devil www restart "$KEEP_DOMAIN"
    sleep 5

    # 主动触发一次保活，确保 Uptime Kuma 被立刻拉起
    info "触发一次即时保活..."
    curl -s -o /dev/null http://${KEEP_DOMAIN}/oyz8 || true
}

# ================== 输出信息 ==================
print_info() {
    echo ""
    info "============================================"
    info "           全 部 安 装 完 成"
    info "============================================"
    echo ""
    echo "🔧 Uptime Kuma:"
    echo "   - 访问地址: https://${MAIN_DOMAIN}"
    echo "   - 工作目录: ${KUMA_DIR}"
    echo "   - 启动命令已加入保活守护"
    echo ""
    echo "🛡️ 保活控制面板:"
    echo "   - 访问地址: http://${KEEP_DOMAIN}/control"
    echo "   - 登录账号: ${KEEPER_USER} / ${KEEPER_PASS}"
    echo "   - 保活注册接口: http://${KEEP_DOMAIN}/oyz8"
    echo ""
    echo "📌 已自动使用保活服务：https://trans.ct8.pl"
    echo "   你的站点会通过上述地址保持活跃"
    echo ""
    echo "⚠️  重要提示:"
    echo "   1. DNS 生效可能需要几分钟"
    echo "   2. Uptime Kuma 首次打开需注册管理员账户"
    echo "   3. 若 Uptime Kuma 意外停止，保活服务会在 10 秒内自动重启"
}

# ================== 主流程 ==================
main() {
    clear
    info "============================================"
    info " Uptime Kuma + 保活守护 全自动部署"
    info "============================================"

        info "激活二进制执行权限..."
    devil binexec on

    install_uptime_kuma
    install_keeper
    print_info
}

main
