/**
 * 三期：Excel 参数表（列映射）导入 —— 纯映射逻辑。
 *
 * 后端 `POST /api/uploads/excel-params` 已经把关 Excel 行映射成
 * `QuoteProjectInput` 的子集（molds / parts / common / extras）。
 * 这里只负责把这份「线格式」数据落成报价页的状态骨架（同 seedMold / seedPart），
 * 抽出纯函数是为了能脱离 React 单测（见 scripts/verify-params-e2e）。
 *
 * 约定：利润 / 税率仍「以配置中心为主」——提交时取 cfg.moldType，故本函数不碰它们。
 */

import type { ExtraItem } from '@mqs/shared';
import type { QuoteImage } from '../api';

type ParamDef = { name: string; scope?: string; enabled?: boolean; defaultValue?: any };
export type CfgLike = { parameters?: ParamDef[] } | null | undefined;

/** 与 ConfiguredQuote 的 MoldState 结构一致（可直接 setMolds） */
export interface ImportedMoldState {
  uid: string;
  code: string;
  name: string;
  materialCode: string;
  params: Record<string, any>;
  off: Record<string, boolean>;
  manuals: Record<string, number>;
  image?: QuoteImage | null;
}
/** 与 ConfiguredQuote 的 PartState 结构一致（可直接 setParts） */
export interface ImportedPartState extends ImportedMoldState {
  qty: any;
}

export interface ImportedParamsResult {
  molds: ImportedMoldState[];
  parts: ImportedPartState[];
  commonParams: Record<string, any>;
  commonOff: Record<string, boolean>;
  /** 只含「其他费用」板块；模具钢材 / 注塑件 板块的页面内费用不受影响 */
  otherExtras: ExtraItem[];
  counts: { molds: number; parts: number; otherExtras: number };
}

const uid = () => Math.random().toString(36).slice(2, 9);

/** 按作用域从配置中心参数表生成默认骨架 */
function seedParams(cfg: CfgLike, scope: 'mold' | 'injection', skipName?: string) {
  const p: Record<string, any> = {};
  for (const d of cfg?.parameters ?? []) {
    if ((d.scope as string) === scope && d.enabled !== false && d.name !== skipName) {
      p[d.name] = d.defaultValue ?? '';
    }
  }
  return p;
}

/** 把映射来的值合并进骨架（空值不覆盖默认） */
function mergeParams(base: Record<string, any>, incoming: Record<string, any> | undefined) {
  const out = { ...base };
  for (const [k, v] of Object.entries(incoming ?? {})) {
    if (v !== undefined && v !== '') out[k] = v;
  }
  return out;
}

export function applyImportedParams(
  data: any,
  cfg: CfgLike,
  qtyVarName: string,
  qtyDefault: any,
): ImportedParamsResult {
  const molds: ImportedMoldState[] = (data?.molds ?? []).map((m: any, i: number) => ({
    uid: uid(),
    code: m.code || '',
    name: m.name || `模具 ${i + 1}`,
    materialCode: m.materialCode || '',
    params: mergeParams(seedParams(cfg, 'mold'), m.params),
    off: m.off || {},
    manuals: m.manuals || {},
    image: m.image ?? null,
  }));

  const parts: ImportedPartState[] = (data?.parts ?? []).map((p: any, i: number) => ({
    uid: uid(),
    code: p.code || '',
    name: p.name || `注塑件 ${i + 1}`,
    materialCode: p.materialCode || '',
    qty: p.qty ?? qtyDefault,
    params: mergeParams(seedParams(cfg, 'injection', qtyVarName), p.params),
    off: p.off || {},
    manuals: p.manuals || {},
    image: p.image ?? null,
  }));

  const commonParams: Record<string, any> = {};
  for (const pm of cfg?.parameters ?? []) {
    if (pm.enabled === false || (pm.scope as string) !== 'common') continue;
    const raw = data?.common?.params?.[pm.name];
    commonParams[pm.name] = raw !== undefined && raw !== '' ? raw : (pm.defaultValue ?? '');
  }

  const otherExtras: ExtraItem[] = (data?.extras?.otherExtras ?? []).map((x: any, i: number) => ({
    id: x.id || `ext_${i + 1}`,
    name: String(x.name ?? ''),
    amount: Number(x.amount) || 0,
    note: x.note ?? '',
  }));

  return {
    molds,
    parts,
    commonParams,
    commonOff: data?.common?.off || {},
    otherExtras,
    counts: { molds: molds.length, parts: parts.length, otherExtras: otherExtras.length },
  };
}
