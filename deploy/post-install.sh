#!/bin/bash
# 部署后钩子：写入 systemd + nginx + 启动
set -e

APP_DIR="/opt/mold-quote-system"

echo "==> 创建日志文件"
touch /var/log/mqs-api.log
chmod 644 /var/log/mqs-api.log

echo "==> 写入 systemd 服务"
cp ${APP_DIR}/deploy/mqs-api.service /etc/systemd/system/mqs-api.service
systemctl daemon-reload
systemctl enable mqs-api

echo "==> 配置 nginx"
# 备份默认配置（如有）
if [ -f /etc/nginx/conf.d/default.conf ] && [ ! -f /etc/nginx/conf.d/default.conf.bak ]; then
    mv /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf.bak
fi
# 移除旧项目遗留的 conf
rm -f /etc/nginx/conf.d/mold-quotation.conf

# 写入新配置
cp ${APP_DIR}/deploy/nginx.conf /etc/nginx/conf.d/ycwl-chat.conf

# 验证配置
nginx -t

# 重载 nginx（不重启，保留现有连接）
systemctl reload nginx

echo "==> 启动 API 服务"
systemctl start mqs-api
systemctl status mqs-api --no-pager | head -10

echo "==> 完成"
echo "    访问: http://47.242.248.104"
echo "    日志: tail -f /var/log/mqs-api.log"
echo "    状态: systemctl status mqs-api"
