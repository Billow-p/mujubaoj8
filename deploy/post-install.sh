#!/bin/bash
# 部署后钩子：systemd + nginx + HTTPS 证书 + 启动
#
# 幂等：可重复执行。已存在的证书不会重新签发。
# 证书缺失时自动退化为 HTTP 引导模式，不阻断业务上线。
set -e

APP_DIR="/opt/mold-quote-system"
DOMAIN="ycwl.chat"
CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
ACME_WEBROOT="/var/www/certbot"
CERTBOT_BIN="/opt/certbot/bin/certbot"
ACME_EMAIL="${ACME_EMAIL:-729503962@qq.com}"

echo "==> 创建日志与目录"
touch /var/log/mqs-api.log
chmod 644 /var/log/mqs-api.log
mkdir -p "${ACME_WEBROOT}"

echo "==> 写入 systemd 服务"
cp "${APP_DIR}/deploy/mqs-api.service" /etc/systemd/system/mqs-api.service
systemctl daemon-reload
systemctl enable mqs-api

echo "==> 清理历史 nginx 配置（避免 upstream / server_name 重复）"
for f in default.conf mold-quotation.conf wycl-chat.conf; do
    if [ -f "/etc/nginx/conf.d/${f}" ]; then
        mv "/etc/nginx/conf.d/${f}" "/etc/nginx/conf.d/${f}.bak-$(date +%Y%m%d-%H%M%S)"
        echo "    已移走 ${f}"
    fi
done

echo "==> 写入 gzip 配置"
cp "${APP_DIR}/deploy/nginx-gzip.conf" /etc/nginx/conf.d/gzip.conf

# ---------------------------------------------------------------
# 证书：不存在则走 HTTP 引导 → 签发 → 切正式配置
# ---------------------------------------------------------------
if [ ! -f "${CERT_DIR}/fullchain.pem" ]; then
    echo "==> 证书不存在，先以 HTTP 引导模式启动"
    cp "${APP_DIR}/deploy/nginx-bootstrap.conf" /etc/nginx/conf.d/ycwl-chat.conf
    nginx -t
    systemctl reload nginx

    echo "==> 安装 certbot（独立 venv，走阿里云 pypi 镜像）"
    if [ ! -x "${CERTBOT_BIN}" ]; then
        rm -rf /opt/certbot
        python3 -m venv /opt/certbot
        /opt/certbot/bin/pip install -q --upgrade pip -i https://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com
        /opt/certbot/bin/pip install -q certbot -i https://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com
        ln -sf "${CERTBOT_BIN}" /usr/local/bin/certbot
    fi

    echo "==> 签发证书（${DOMAIN}）"
    echo "    前提：域名 A 记录已指向本机公网 IP，且 80 端口可从公网访问"
    if "${CERTBOT_BIN}" certonly --webroot -w "${ACME_WEBROOT}" \
            -d "${DOMAIN}" --email "${ACME_EMAIL}" \
            --agree-tos --non-interactive; then
        echo "    签发成功"
    else
        echo "    ⚠️  签发失败（通常是 DNS 未解析或 80 端口不通）"
        echo "       服务将继续以 HTTP 运行；解析生效后重跑本脚本即可补签"
    fi
fi

echo "==> 写入 nginx 正式配置"
if [ -f "${CERT_DIR}/fullchain.pem" ]; then
    cp "${APP_DIR}/deploy/nginx.conf" /etc/nginx/conf.d/ycwl-chat.conf
    SCHEME="https"
else
    cp "${APP_DIR}/deploy/nginx-bootstrap.conf" /etc/nginx/conf.d/ycwl-chat.conf
    SCHEME="http"
fi
nginx -t
systemctl reload nginx

echo "==> 配置证书自动续期"
if [ -x "${CERTBOT_BIN}" ]; then
    cp "${APP_DIR}/deploy/certbot-renew.service" /etc/systemd/system/certbot-renew.service
    cp "${APP_DIR}/deploy/certbot-renew.timer"   /etc/systemd/system/certbot-renew.timer
    systemctl daemon-reload
    systemctl enable --now certbot-renew.timer
fi

echo "==> 启动 API 服务"
systemctl restart mqs-api
sleep 3
systemctl is-active mqs-api

echo "==> 完成"
if [ "${SCHEME}" = "https" ]; then
    echo "    访问: https://${DOMAIN}   （http 会自动跳转到 https）"
else
    echo "    访问: http://<公网IP>"
    echo "    提示: ${DOMAIN} 证书未就绪，域名解析生效后重跑本脚本"
fi
echo "    IP 直连: http://<公网IP>  （始终可用，便于排查）"
echo "    日志: tail -f /var/log/mqs-api.log"
echo "    证书: systemctl list-timers certbot-renew.timer"
