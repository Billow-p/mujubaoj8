// 修正「运输区域」参数的语义（幂等）
//
// 问题：运输区域在公式里是**系数**（运输费 = 重量 × 运费单价 × 运输区域），
// 但界面只提示「数字参与公式计算」，用户把「广东省外」的数字改成 300，
// 以为是在加 300 元运费，结果运费变成 288,000（800kg × 1.2 × 300）。
//
// 处理：
//   1) 选项固定为 0 / 1 / 2 三档（免运费 / 正常 / 加倍），把被改乱的数值纠正回来
//   2) 默认值不在合法范围里就重置为 0（省内免运费，最保守）
//   3) 新增「运输附加费」手填项 —— 固定加价（加急 / 木箱 / 保险）写在这里

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const ZONE_OPTIONS = [
  { label: '广东省内（免运费）', value: 0 },
  { label: '广东省外（按正常运费）', value: 1 },
  { label: '偏远地区（运费加倍）', value: 2 },
];

async function main() {
  const moldTypes = await prisma.moldType.findMany({
    select: { id: true, name: true, code: true, companyId: true },
    orderBy: { createdAt: 'asc' },
  });

  for (const mt of moldTypes) {
    const params = await prisma.customParameter.findMany({ where: { moldTypeId: mt.id } });
    const zone = params.find((p) => p.name === '运输区域');
    let zoneFixed = 0;
    if (zone) {
      const data = { options: JSON.stringify(ZONE_OPTIONS) };
      const dv = Number(zone.defaultValue);
      if (![0, 1, 2].includes(dv)) data.defaultValue = '0';
      await prisma.customParameter.update({ where: { id: zone.id }, data });
      zoneFixed = 1;
    }

    // 运输附加费（手填，默认 0）
    let surchargeAdded = 0;
    if (mt.code === 'injection') {
      const items = await prisma.quoteItem.findMany({ where: { moldTypeId: mt.id } });
      if (!items.some((i) => i.name === '运输附加费')) {
        const max = items.reduce((m, i) => Math.max(m, i.sortOrder ?? 0), 0);
        await prisma.quoteItem.create({
          data: {
            companyId: mt.companyId,
            moldTypeId: mt.id,
            name: '运输附加费',
            category: '运输',
            scope: 'mold',
            calcType: 'manual',
            calcConfig: {},
            enabled: true,
            sortOrder: max + 1,
          },
        });
        surchargeAdded = 1;
      }
    }

    console.log(`- ${mt.name}：运输区域选项/默认值修正 ${zoneFixed}，新增运输附加费 ${surchargeAdded}`);
  }
  console.log('\n完成');
}

main()
  .catch((e) => {
    console.error('回填失败：', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
