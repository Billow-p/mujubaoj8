/**
 * 3D 图纸导入面板。
 *
 * 用户把 STEP / STL 之类的数模拖进来 → 解析出真实体积和尺寸 →
 * 系统给出「这是模具还是注塑件」的建议 + 建议参数 → 用户确认 → 落进报价单，
 * 同时把渲染出来的缩略图挂到件上（导出的 Excel 报价单上就能看到件的样子）。
 *
 * 关键设计：建议一律要人确认。归类错了直接报错价，让用户在 3 秒内看一眼，
 * 远比事后发现报错价划算。
 */

import { useRef, useState } from 'react';
import {
  parse3DFile,
  suggestParams,
  type Parsed3D,
  type ItemKind,
} from '../utils/geometry';
import { uploadImage } from '../utils/image';
import { dataUrlToFile } from '../utils/image';
import type { QuoteImage } from '../api';
import { Model3DViewer, type Model3DViewerHandle } from './Model3DViewer';
import type { MeshData } from '../utils/geometry/types';

export interface Apply3DItem {
  kind: ItemKind;
  /** 新建一件，还是更新已有件 */
  target: { mode: 'new' } | { mode: 'update'; uid: string };
  name: string;
  params: Record<string, number>;
  image: QuoteImage | null;
  fileName: string;
}

interface Props {
  /** 现有件，用于「更新到已有件」 */
  molds: { uid: string; name: string }[];
  parts: { uid: string; name: string }[];
  /** 钢材密度（算模具重量） */
  moldDensity?: number;
  /** 塑料密度（算单件重量） */
  partDensity?: number;
  onApply: (items: Apply3DItem[]) => void;
  onError: (msg: string) => void;
  onInfo: (msg: string) => void;
}

interface Row {
  id: number;
  data: Parsed3D;
  /** 用户选定的归类（初始值来自系统建议） */
  kind: ItemKind;
  /** 用户勾选要填的参数名 */
  picked: Set<string>;
  target: { mode: 'new' } | { mode: 'update'; uid: string };
  /** 解析失败的文件（可能混在批量里） */
  failed?: { error: string; hint?: string };
}

const ACCEPT = '.step,.stp,.iges,.igs,.brep,.stl,.obj,.ply,.3mf,.sldprt,.prt,.ipt,.catpart,.x_t,.x_b,.sat';

function baseName(fileName: string) {
  return fileName.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '');
}

const fmt = (n: number, d = 1) =>
  n.toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });

export function Drawing3DImport({
  molds,
  parts,
  moldDensity = 7.85,
  partDensity = 1.05,
  onApply,
  onError,
  onInfo,
}: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState<string>('');
  const [active, setActive] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const seq = useRef(0);

  // ---- 截图用：一个隐藏的 viewer，逐个渲染并取图（避免开一堆 WebGL 上下文）----
  const shotRef = useRef<Model3DViewerHandle | null>(null);
  const [shotMesh, setShotMesh] = useState<MeshData | null>(null);
  const [shotKey, setShotKey] = useState(0);
  const shotResolve = useRef<((url: string | null) => void) | null>(null);

  const capture = (mesh: MeshData) =>
    new Promise<string | null>((resolve) => {
      shotResolve.current = resolve;
      setShotMesh(mesh);
      setShotKey((k) => k + 1);
    });

  const onShotReady = () => {
    const url = shotRef.current?.capture() ?? null;
    const r = shotResolve.current;
    shotResolve.current = null;
    r?.(url);
  };

  // ---------------- 解析 ----------------
  const handleFiles = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    const next: Row[] = [];
    let failedCount = 0;

    for (const f of files) {
      // 先按钢材密度解析；解析完拿到归类后，再用匹配的密度重算建议参数
      const r = await parse3DFile(f, moldDensity);
      if (!r.ok) {
        failedCount++;
        next.push({
          id: ++seq.current,
          data: null as any,
          kind: 'part',
          picked: new Set(),
          target: { mode: 'new' },
          failed: { error: `${f.name}：${r.error}`, hint: r.hint },
        });
        continue;
      }
      const d = r.data;
      // 密度必须跟着归类走：模具用钢、注塑件用塑料，否则重量差 7 倍
      const density = d.classify.kind === 'mold' ? moldDensity : partDensity;
      const suggested = suggestParams(d.summary, d.classify.kind, density);
      const data: Parsed3D = { ...d, suggestedParams: suggested };
      next.push({
        id: ++seq.current,
        data,
        kind: d.classify.kind,
        picked: new Set(suggested.map((p) => p.name)),
        target: { mode: 'new' },
      });
    }

    setRows((prev) => [...prev, ...next]);
    setBusy(false);
    if (next.length && !rows.length) setActive(0);
    const okCount = next.filter((r) => !r.failed).length;
    if (okCount) onInfo(`解析成功 ${okCount} 个，请确认归类与参数`);
    if (failedCount) onError(`${failedCount} 个文件没能解析，见列表中的红色提示`);
  };

  const patch = (id: number, fn: (r: Row) => Row) =>
    setRows((prev) => prev.map((r) => (r.id === id ? fn(r) : r)));

  /** 切换归类时，参数建议要按新的密度重算 */
  const switchKind = (id: number, kind: ItemKind) => {
    patch(id, (r) => {
      if (r.failed) return r;
      // 密度必须跟着归类走：模具用钢、注塑件用塑料
      const density = kind === 'mold' ? moldDensity : partDensity;
      const params = suggestParams(r.data.summary, kind, density);
      return {
        ...r,
        kind,
        data: { ...r.data, suggestedParams: params },
        picked: new Set(params.map((p) => p.name)),
        // 归类换了，原来的「更新到已有件」目标就失效了
        target: { mode: 'new' },
      };
    });
  };

  // ---------------- 确认导入 ----------------
  const handleApply = async () => {
    const usable = rows.filter((r) => !r.failed);
    if (!usable.length) return;

    const out: Apply3DItem[] = [];
    for (let i = 0; i < usable.length; i++) {
      const r = usable[i];
      setApplying(`正在生成件图 ${i + 1}/${usable.length}…`);

      let image: QuoteImage | null = null;
      try {
        const url = await capture(r.data.mesh);
        if (url) {
          const file = dataUrlToFile(url, `${baseName(r.data.fileName)}.png`);
          if (file) {
            image = await uploadImage(file, { name: r.data.fileName, source: 'render3d' });
          }
        }
      } catch {
        // 截图失败不阻断导入 —— 参数是核心，图是加分项
      }

      const params: Record<string, number> = {};
      for (const p of r.data.suggestedParams) {
        if (r.picked.has(p.name)) params[p.name] = p.value;
      }
      out.push({
        kind: r.kind,
        target: r.target,
        name: baseName(r.data.fileName),
        params,
        image,
        fileName: r.data.fileName,
      });
    }
    setApplying('');
    onApply(out);
    setRows([]);
  };

  const row = rows[active];
  const targets = row && !row.failed
    ? row.kind === 'mold'
      ? molds.map((m) => ({ uid: m.uid, label: m.name }))
      : parts.map((p) => ({ uid: p.uid, label: p.name }))
    : [];

  return (
    <div className="border border-gray-200 rounded-lg bg-white p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[13px] font-medium text-gray-800">
          从 3D 图纸识别
          <span className="ml-2 text-[11px] font-normal text-gray-400">
            算出真实体积与尺寸，自动填参数并生成件图
          </span>
        </div>
        {rows.length > 0 && (
          <button
            type="button"
            onClick={() => { setRows([]); setActive(0); }}
            className="text-[11px] text-gray-400 hover:text-gray-600"
          >
            清空
          </button>
        )}
      </div>

      {/* 拖拽 / 选择区 */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(Array.from(e.dataTransfer.files || []));
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex items-center justify-center gap-2 py-4 border-2 border-dashed rounded cursor-pointer transition ${
          dragOver ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200 hover:border-emerald-300'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            handleFiles(Array.from(e.target.files || []));
            if (inputRef.current) inputRef.current.value = '';
          }}
        />
        <span className="text-[12px] text-gray-500">
          {busy ? '解析中…' : '把 3D 文件拖到这里，或点击选择（支持 STEP / IGES / STL / OBJ / PLY / 3MF）'}
        </span>
      </div>

      <div className="text-[10.5px] text-gray-400 mt-1.5">
        SolidWorks (.sldprt)、Pro/E (.prt) 等专有格式读不出几何，请在原软件里另存为 STEP 或 STL 再传
      </div>

      {/* 结果列表 */}
      {rows.length > 0 && (
        <div className="mt-3 space-y-2">
          {rows.map((r, i) => (
            <div
              key={r.id}
              onClick={() => setActive(i)}
              className={`border rounded p-2 cursor-pointer transition ${
                i === active ? 'border-emerald-400 bg-emerald-50/40' : 'border-gray-200'
              }`}
            >
              {r.failed ? (
                <div className="text-[12px] text-red-600">
                  ❌ {r.failed.error}
                  {r.failed.hint && <div className="text-[11px] text-gray-500 mt-0.5">💡 {r.failed.hint}</div>}
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[12px] font-medium text-gray-800 truncate">
                      {r.data.fileName}
                      <span className="ml-1.5 px-1 py-0.5 rounded bg-gray-100 text-[10px] text-gray-500 uppercase">
                        {r.data.format}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setRows((p) => p.filter((x) => x.id !== r.id)); }}
                      className="text-[11px] text-gray-400 hover:text-red-500 shrink-0"
                    >
                      移除
                    </button>
                  </div>

                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className="text-[11px] text-gray-500">归类</span>
                    {(['mold', 'part'] as ItemKind[]).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={(e) => { e.stopPropagation(); switchKind(r.id, k); }}
                        className={`px-2 py-0.5 rounded text-[11px] border transition ${
                          r.kind === k
                            ? 'border-emerald-500 bg-emerald-500 text-white'
                            : 'border-gray-200 text-gray-600 hover:border-emerald-300'
                        }`}
                      >
                        {k === 'mold' ? '模具' : '注塑件'}
                      </button>
                    ))}
                    <span
                      className={`text-[10.5px] ${
                        r.data.classify.confidence >= 0.6 ? 'text-gray-500' : 'text-amber-600'
                      }`}
                      title={r.data.classify.reason}
                    >
                      {r.data.classify.confidence >= 0.6 ? '系统建议' : '⚠️ 建议不确定，请确认'}：
                      {r.data.classify.kind === 'mold' ? '模具' : '注塑件'}
                    </span>
                  </div>

                  {i === active && (
                    <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                      {(r.data.summary.triangleCount ?? 0) <= 400000 && (
                        <Model3DViewer mesh={r.data.mesh} height={180} />
                      )}
                      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-2 text-[11px] text-gray-600">
                        <div>尺寸 {r.data.summary.bbox.size.map((x) => Math.round(x)).join(' × ')} mm</div>
                        <div>面数 {r.data.summary.triangleCount.toLocaleString('zh-CN')}</div>
                        <div>体积 {fmt(r.data.summary.volumeMm3 / 1000, 1)} cm³</div>
                        <div>表面积 {fmt(r.data.summary.surfaceAreaMm2 / 100, 1)} cm²</div>
                      </div>

                      {r.data.warnings.map((w, k) => (
                        <div key={k} className="text-[10.5px] text-amber-600 mt-1">⚠️ {w}</div>
                      ))}

                      <div className="mt-2 border-t border-gray-100 pt-2">
                        <div className="text-[11px] text-gray-500 mb-1">将填入这些参数（可取消勾选）</div>
                        {r.data.suggestedParams.map((p) => (
                          <label key={p.name} className="flex items-start gap-2 py-0.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={r.picked.has(p.name)}
                              onChange={() =>
                                patch(r.id, (x) => {
                                  const s = new Set(x.picked);
                                  s.has(p.name) ? s.delete(p.name) : s.add(p.name);
                                  return { ...x, picked: s };
                                })
                              }
                              className="mt-0.5"
                            />
                            <span className="text-[11.5px] text-gray-700">
                              {p.name}
                              <span className="ml-1 font-medium text-gray-900">
                                {p.value} {p.unit}
                              </span>
                              <span className="ml-1 text-[10.5px] text-gray-400">{p.note}</span>
                            </span>
                          </label>
                        ))}
                      </div>

                      {targets.length > 0 && (
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-[11px] text-gray-500">导入方式</span>
                          <select
                            value={r.target.mode === 'new' ? '' : r.target.uid}
                            onChange={(e) =>
                              patch(r.id, (x) => ({
                                ...x,
                                target: e.target.value
                                  ? { mode: 'update', uid: e.target.value }
                                  : { mode: 'new' },
                              }))
                            }
                            className="border border-gray-200 rounded px-1.5 py-0.5 text-[11px]"
                          >
                            <option value="">新建{r.kind === 'mold' ? '模具' : '注塑件'}</option>
                            {targets.map((t) => (
                              <option key={t.uid} value={t.uid}>
                                更新到 {t.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          ))}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => { setRows([]); setActive(0); }}
              className="px-3 py-1.5 text-[12px] text-gray-500 border border-gray-200 rounded hover:bg-gray-50"
            >
              取消
            </button>
            <button
              type="button"
              disabled={busy || !!applying}
              onClick={handleApply}
              className="px-3 py-1.5 text-[12px] text-white bg-emerald-600 rounded hover:bg-emerald-700 disabled:opacity-50"
            >
              {applying || `确认导入（${rows.filter((r) => !r.failed).length} 个）`}
            </button>
          </div>
        </div>
      )}

      {/* 截图用的隐藏 viewer：尺寸给 1px，只为拿 WebGL 画面 */}
      <div style={{ position: 'fixed', left: -9999, top: 0, width: 320, height: 240, pointerEvents: 'none' }}>
        {shotMesh && (
          <Model3DViewer
            key={shotKey}
            ref={shotRef}
            mesh={shotMesh}
            height={240}
            onReady={onShotReady}
          />
        )}
      </div>
    </div>
  );
}
