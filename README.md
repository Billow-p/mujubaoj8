# 模具注塑报价系统

按 SPEC.md 全量实现 v0.1。

## 项目结构

```
mold-quote-system/
├─ apps/
│  ├─ web/                # 前端 (React + TS + Vite + shadcn/ui)
│  └─ api/                # 后端 (Fastify + TS + Prisma)
├─ packages/
│  ├─ shared/             # 共享 TS 类型 + 常量
│  └─ calc-engine/        # 计算引擎（纯函数，前后端共用）
├─ infra/
│  ├─ docker-compose.yml
│  ├─ Dockerfile.web
│  └─ Dockerfile.api
└─ docs/SPEC.md
```

## 启动

```bash
# 1. 启动数据库
docker compose -f infra/docker-compose.yml up -d postgres

# 2. 安装依赖
pnpm install

# 3. 跑数据库迁移
pnpm db:migrate
pnpm db:seed

# 4. 启动后端 (端口 3000)
pnpm dev:api

# 5. 启动前端 (端口 5173)
pnpm dev:web
```

## 计算引擎使用

```typescript
import { calculateQuote, type QuoteInput } from '@mqs/calc-engine';

const result = calculateQuote(input);
// result.moldFeeItems.coreSteel.value
// result.summary.grandTotalIncVat
```

## 角色

- 报价员: 填参数、保存草稿、提交审核、查看历史
- 审核员: 审核通过/退回
- 管理员: 管理参数库、用户
- 客户: 通过分享链接查看报价单
