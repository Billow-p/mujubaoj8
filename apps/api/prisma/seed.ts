// 种子数据 — 初始化默认企业 + 管理员 + 测试数据

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 开始初始化种子数据...');

  // 1. 默认企业
  const company = await prisma.company.upsert({
    where: { id: 'default-company' },
    update: {},
    create: {
      id: 'default-company',
      name: '明记模具有限公司',
    },
  });
  console.log(`  ✓ 企业: ${company.name}`);

  // 2. 三个测试用户
  const passwordHash = await bcrypt.hash('password123', 10);

  await prisma.user.upsert({
    where: { email: 'admin@mqs.local' },
    update: {},
    create: {
      email: 'admin@mqs.local',
      passwordHash,
      name: '管理员',
      role: 'admin',
      companyId: company.id,
    },
  });

  await prisma.user.upsert({
    where: { email: 'auditor@mqs.local' },
    update: {},
    create: {
      email: 'auditor@mqs.local',
      passwordHash,
      name: '王审核',
      role: 'auditor',
      companyId: company.id,
    },
  });

  await prisma.user.upsert({
    where: { email: 'quoter@mqs.local' },
    update: {},
    create: {
      email: 'quoter@mqs.local',
      passwordHash,
      name: '张工',
      role: 'quoter',
      companyId: company.id,
    },
  });
  console.log('  ✓ 用户: admin/auditor/quoter@mqs.local (密码 password123)');

  // 3. 测试客户
  await prisma.customer.upsert({
    where: { id: 'test-customer-1' },
    update: {},
    create: {
      id: 'test-customer-1',
      companyId: company.id,
      name: '美的电器股份有限公司',
      contactName: '李经理',
      phone: '13800138000',
      address: '广东省佛山市顺德区北滘镇',
      industry: '家电制造',
      size: '大型企业',
    },
  });

  await prisma.customer.upsert({
    where: { id: 'test-customer-2' },
    update: {},
    create: {
      id: 'test-customer-2',
      companyId: company.id,
      name: '比亚迪供应链',
      contactName: '陈总',
      phone: '13900139000',
      address: '广东省深圳市坪山区',
      industry: '汽车制造',
      size: '大型企业',
    },
  });
  console.log('  ✓ 客户: 美的电器 / 比亚迪供应链');

  console.log('✅ 种子数据完成');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
