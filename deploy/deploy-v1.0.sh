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
# 优先用 PATH 里的 pnpm；没有就回退到 WorkBuddy 托管 Node 自带的 corepack
if command -v pnpm >/dev/null 2>&1; then
  pnpm -r build
elif [ -f "C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-3/node_modules/corepack/dist/pnpm.js" ]; then
  echo "    本地 PATH 里没有 pnpm，改用托管 Node 的 corepack"
  "C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-3/node.exe" \
    "C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-3/node_modules/corepack/dist/pnpm.js" -r build
else
  echo "✗ 找不到 pnpm（也未找到托管 Node 的 corepack），无法构建" >&2
  exit 1
fi

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

  # ---- 补齐新增依赖：只在缺包时安装，避免每次部署都全量重装 ----
  cd $APP_DIR
  if [ ! -d apps/api/node_modules/@fastify/multipart ] || [ ! -d apps/api/node_modules/@fastify/static ]; then
    echo '==> 检测到缺失依赖，执行 pnpm install（跳过 postinstall，prisma 由后面显式 generate）'
    pnpm install --ignore-scripts 2>&1 | tail -8
  else
    echo '依赖齐全，跳过安装'
  fi

  # ---- 件图上传目录：服务里 ProtectSystem=full，必须出现在 ReadWritePaths 才能写 ----
  mkdir -p $APP_DIR/apps/api/uploads
  chmod 755 $APP_DIR/apps/api/uploads
  echo '件图目录就绪：' \$(ls -d $APP_DIR/apps/api/uploads)

  # ---- 清理历史构建产物：只保留 index.html 当前引用的那一个 JS / CSS ----
  # 旧产物仍可被访问（/assets/ 配了 30 天 immutable 缓存），
  # 浏览器可能一直复用旧入口导致「代码已更新但页面没变」，这里每次部署后强制清掉。
  cd $APP_DIR/apps/web/dist/assets 2>/dev/null && {
    CUR_JS=\$(grep -o 'index-[^.]*\.js' ../index.html | head -1)
    CUR_CSS=\$(grep -o 'index-[^.]*\.css' ../index.html | head -1)
    for f in index-*.js; do
      [ -e \"\$f\" ] || continue
      [ \"\$f\" = \"\$CUR_JS\" ] && continue
      rm -f \"\$f\"
    done
    for f in index-*.css; do
      [ -e \"\$f\" ] || continue
      [ \"\$f\" = \"\$CUR_CSS\" ] && continue
      rm -f \"\$f\"
    done
    echo \"清理旧产物完成，当前保留：\$CUR_JS \$CUR_CSS\"
    ls -1
  }
"

echo "==> [6/8] 生成 Prisma Client 并同步数据库结构（只增表/字段，不删数据）"
ssh -o StrictHostKeyChecking=no root@47.242.248.104 "
  set -e
  cd $APP_DIR/apps/api
  npx prisma generate
  npx prisma db push
  echo '==> [6.5/8] 回填参数作用域 scope（仅改作用域，不动数值）'
  node scripts/migrate-add-param-scope.mjs
  echo '==> [6.6/8] 回填材料驱动算价（加 densityVar/lossVar + 钢材/原料损耗率参数，默认值与旧固定值一致）'
  node scripts/migrate-add-steel-material.mjs
  echo '==> [6.7/8] 补充主流模具成本项（模架费/机台费/热流道/EDM… 默认 0，不填不计钱）'
  node scripts/migrate-add-mold-items.mjs
  echo '==> [6.8/8] 修正运输区域系数语义 + 新增运输附加费'
  node scripts/migrate-fix-freight.mjs
  echo '==> [6.9/8] 确保全局材料库编码唯一索引（db push 可能清掉，每次重建）'
  node scripts/migrate-add-material-unique.mjs
  echo '==> [6.10/8] 补齐模具预置参数 v2（前后模钢材/模具寿命/滑块斜顶/双色系数 + 参数分区调整）'
  node scripts/migrate-mold-params-v2.mjs
  echo '==> [6.11/8] 价/系数类参数归入「计价单价」分组（产品数据只留量，价统一在费用板块改）'
  node scripts/migrate-price-group.mjs
"

echo "==> [7/8] 更新 Nginx 配置并重启服务"
ssh -o StrictHostKeyChecking=no root@47.242.248.104 "
  set -e
  cp $APP_DIR/deploy/nginx.conf /etc/nginx/conf.d/ycwl-chat.conf
  nginx -t && systemctl reload nginx
  # 服务单元（含件图目录写权限 ReadWritePaths）也可能变，先同步再重启
  cp $APP_DIR/deploy/mqs-api.service /etc/systemd/system/mqs-api.service
  systemctl daemon-reload
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
