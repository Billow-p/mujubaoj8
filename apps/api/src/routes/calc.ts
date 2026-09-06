// 计算路由（实时联动，不写库）

import type { FastifyInstance } from 'fastify';
import { calculateQuote, compareOptimalCavity, validateQuoteInput } from '@mqs/calc-engine';
import type { CalcQuoteRequest, QuoteInput } from '@mqs/shared';

export async function calcRoutes(app: FastifyInstance) {
  // 实时计算（不写库）
  app.post<{ Body: CalcQuoteRequest }>(
    '/api/calc/quote',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const errors = validateQuoteInput(req.body.input);
      if (errors.length > 0) {
        return reply.code(400).send({ validationErrors: errors });
      }
      try {
        const result = calculateQuote(req.body);
        return result;
      } catch (e: any) {
        return reply.code(500).send({ error: e.message });
      }
    },
  );

  // 最优腔数对比
  app.post<{ Body: { input: Omit<QuoteInput, 'cavityCount'> } }>(
    '/api/calc/optimal-cavity',
    { preHandler: [app.authenticate] },
    async (req) => {
      const errors = validateQuoteInput({ ...req.body.input, cavityCount: 1 });
      if (errors.length > 0) {
        return { validationErrors: errors };
      }
      return compareOptimalCavity(req.body.input);
    },
  );
}
