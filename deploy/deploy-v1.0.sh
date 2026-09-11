#!/usr/bin/env bash
# ============================================================
# 模具注塑报价系统 — V1.0 部署脚本
# 服务器：root@47.242.248.104   应用目录：/opt/mold-quote-system
# ============================================================
# 用法：在本地项目根目录执行
#   bash deploy/deploy-v1.0.sh
# 前置：已能免密 SSH 登录服务器
# ============================================================

set -e

APP_DIR=/opt/mold-quote-system
PKG=/tmp/mqs-v10.tar.gz
STAMP=$(date +%Y%m%d-%H%M%S)

echo "==> [1/8] 本地构建（前端产物 + 后端 dist）"
pnpm -r build

echo "==> [2/8] 打包（排除 node_modules / .git / .env / 日志）"
echo "    注意：.env 含生产密钥，禁止随包覆盖服务器，由步骤 [4/8] 单独备份、解压时保留"
tar czf "$PKG" --exclude='node_modules' --exclude='.git' --exclude='*.log' --exclude='.tmp-pgdata' --exclude='.env' .
ls -lh "$PKG"

echo "==> [3/8] 上传到服务器"
scp -o StrictHostKeyChecking=no "$PKG" root@47.242.248.104:/tmp/

echo "==> [4/8] 服务器端备份（代码 + 数据库）"
ssh -o StrictHostKeyChecking=no root@47.242.248.104 "
  set -e
  mkdir -p /opt/backups
  cp -r $APP_DIR/apps/web/dist /opt/backups/web-dist-$STAMP
  cp $APP_DIR/apps/api/.env /opt/backups/api-env-$STAMP.txt 2>/dev/null || true
  echo "已备份服务端 .env（生产密钥）"
  PGPASSWORD=MqsPass_2026 pg_dump -h 127.0.0.1 -U mqs -d mold_quote > /opt/backups/mold_quote-$STAMP.sql
  gzip /opt/backups/mold_quote-$STAMP.sql
  ls -lh /opt/backups | tail -5
"

echo "==> [5/8] 解压覆盖（保留 node_modules 与 .env）"
ssh -o StrictHostKeyChecking=no root@47.242.248.104 "
  set -e
  tar xzf /tmp/mqs-v10.tar.gz -C $APP_DIR
  echo '解压完成'
"

echo "==> [6/8] 生成 Prisma Client 并同步数据库结构（只增表/字段，不删数据）"
ssh -o StrictHostKeyChecking=no root@47.242.248.104 "
  set -e
  cd $APP_DIR/apps/api
  npx prisma generate
  npx prisma db push
  echo '==> [6.5/8] 回填参数作用域 scope（仅改作用域，不动数值）'
  node scripts/migrate-add-param-scope.mjs
  echo '==> [6.6/8] 回填模具钢材材料化（加 densityVar/lossVar + 钢材损耗率参数，默认 0 不改算价）'
  node scripts/migrate-add-steel-material.mjs
"

echo "==> [7/8] 更新 Nginx 配置并重启服务"
ssh -o StrictHostKeyChecking=no root@47.242.248.104 "
  set -e
  cp $APP_DIR/deploy/nginx.conf /etc/nginx/conf.d/ycwl-chat.conf
  nginx -t && systemctl reload nginx
  systemctl restart mqs-api
  sleep 3
  systemctl is-active mqs-api
"

echo "==> [8/8] 健康检查"
ssh -o StrictHostKeyChecking=no root@47.242.248.104 "
  curl -s -o /dev/null -w '首页 HTTP:%{http_code}\n' http://127.0.0.1/
  curl -s -o /dev/null -w '健康检查 HTTP:%{http_code}\n' http://127.0.0.1/api/health
  tail -5 /var/log/mqs-api.log
"

echo "==> 部署完成"
echo "提示：若域名 ycwl.chat 已完成 A 记录解析，可执行 certbot 申请 HTTPS 证书"
