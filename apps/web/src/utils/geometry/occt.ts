/**
 * OpenCascade 通道封装 —— 只服务 STEP / IGES / BREP。
 * 真正的解析跑在 Worker 里（见 public/occt/occt-worker.js），主线程不会被 7.6MB WASM 卡住。
 */

import type { MeshData, ParseResult } from './types';

/** OCCT 的 format 参数（一个后缀可能对应多个写法） */
const OCCT_FORMAT: Record<string, string> = {
  step: 'step',
  stp: 'step',
  iges: 'iges',
  igs: 'iges',
  brep: 'brep',
};

/** 网格精度：按包围盒的 0.1% 取弦高偏差，体积误差可控在 1% 内，面数又不至于爆炸 */
const DEFAULT_PARAMS = {
  linearUnit: 'millimeter', // 输出统一按毫米，后面不用再猜单位
  linearDeflectionType: 'bounding_box_ratio',
  linearDeflection: 0.001,
  angularDeflection: 0.5,
};

/** 单例 Worker：WASM 只初始化一次，之后每个文件解析都是毫秒级 */
let worker: Worker | null = null;
let seq = 0;

function ensureWorker(): Worker {
  if (worker) return worker;
  // 用 vite 的 BASE_URL，部署到子路径也不会 404
  const base = (import.meta as any).env?.BASE_URL || '/';
  worker = new Worker(`${base}occt/occt-worker.js`);
  return worker;
}

/** 解析崩了就把 worker 丢掉，下次重新起一个干净的 */
function killWorker() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
}

interface Pending {
  resolve: (r: ParseResult) => void;
  timer: any;
}

const pending = new Map<number, Pending>();

function once(id: number, timeoutMs: number): Promise<ParseResult> {
  return new Promise<ParseResult>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      killWorker(); // 卡死了，换一个 worker
      resolve({ ok: false, error: '解析超时（模型过于复杂或文件异常），已中止' });
    }, timeoutMs);
    pending.set(id, { resolve, timer });
  });
}

/**
 * 用 OpenCascade 解析 STEP / IGES / BREP。
 * @param buf 文件内容（会被转移到 Worker，调用后不要再使用这个 buffer）
 */
export async function parseWithOcct(
  ext: string,
  buf: ArrayBuffer,
  name?: string,
  timeoutMs = 60_000,
): Promise<ParseResult> {
  const format = OCCT_FORMAT[ext];
  if (!format) return { ok: false, error: `OpenCascade 不支持 .${ext}` };

  const w = ensureWorker();
  const id = ++seq;

  w.onmessage = (ev: MessageEvent) => {
    const data = ev.data || {};
    // 预热消息是发给 worker 的，不对应任何 pending 请求 —— 直接丢掉，
    // 否则抢占 onmessage 会让真正的解析响应丢失、请求永远挂着
    if (data.warm) return;
    const p = pending.get(id);
    if (!p) return; // 已超时
    clearTimeout(p.timer);
    pending.delete(id);

    if (!data.ok) {
      p.resolve({ ok: false, error: data.error || '解析失败' });
      return;
    }
    const mesh: MeshData = {
      positions: data.positions,
      indices: data.indices ?? null,
      name,
    };
    p.resolve({ ok: true, mesh, format: format as any });
  };

  w.onerror = () => {
    const p = pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(id);
    killWorker();
    p.resolve({ ok: false, error: '解析进程异常，请重试' });
  };

  const result = once(id, timeoutMs);
  w.postMessage({ format, buffer: buf, params: DEFAULT_PARAMS }, [buf]);
  return result;
}

/**
 * 预热：页面空闲时先把 7.6MB 的 WASM 起好。
 * STEP / IGES 的首次解析慢，几乎全耗在 WASM 实例化上；提前起好，
 * 用户真传文件时就是毫秒级，不会盯着「正在处理」以为卡死。
 *
 * 只在要用到 OCCT 的格式上预热（STL/OBJ/PLY/3MF 走自解析，不需要）。
 * 重复调用无害 —— worker 里对 WASM 做了单例缓存。
 */
let warmed = false;
export function warmUpOcct(): void {
  if (warmed) return;
  warmed = true;
  // requestIdleCallback 不是所有浏览器都有，没有就退到 setTimeout
  const run = () => {
    try {
      // 只发不收：预热不需要回复，避免和真正的解析响应抢 onmessage
      ensureWorker().postMessage({ warmup: true });
    } catch {
      warmed = false; // 起不来就允许下次再试
    }
  };
  const idle = (globalThis as any).requestIdleCallback;
  if (typeof idle === 'function') idle(run, { timeout: 3000 });
  else window.setTimeout(run, 1200);
}

/** 页面卸载 / 切换时主动释放 WASM 内存 */
export function disposeOcct() {
  killWorker();
}
