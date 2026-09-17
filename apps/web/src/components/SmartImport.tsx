/**
 * 统一识别面板。
 *
 * 一个入口吃掉所有情况：3D 数模、Excel、Word、截图、照片、手写件。
 * 拖进来 → 自动判断类型 → 走对应通道 → 给出归类建议 → 人确认 → 落到件上。
 *
 * 两条硬规矩：
 * 1. 任何文件进来都必须有回复 —— 成功给结果，失败给「为什么 + 怎么改」，绝不允许没反应；
 * 2. 全过程记日志 —— 界面上能展开看，关键事件同时上报后端落盘。
 */

import { useRef, useState } from 'react';
import { parse3DFile, suggestParams, type ItemKind } from '../utils/geometry';
import { uploadImage, dataUrlToFile, assertExcelDisplayable } from '../utils/image';
import {
  classifyFile,
  diagnose,
  RecogLogger,
  humanSize,
  type LogEntry,
  type RecogError,
} from '../utils/recognition';
import { uploads, type QuoteImage } from '../api';
import { Model3DViewer, type Model3DViewerHandle } from './Model3DViewer';
import type { MeshData, GeometrySummary } from '../utils/geometry/types';

export interface ApplyItem {
  kind: ItemKind;
  target: { mode: 'new' } | { mode: 'update'; uid: string };
  name: string;
  params: Record<string, number>;
  image: QuoteImage | null;
}

interface Props {
  molds: { uid: string; name: string }[];
  parts: { uid: string; name: string }[];
  moldDensity?: number;
  partDensity?: number;
  onApply: (items: ApplyItem[]) => void;
  onImportParams?: (data: any) => void;
  onError: (msg: string) => void;
  onInfo: (msg: string) => void;
}

interface ImportItem {
  id: string;
  source: '3d' | 'excel' | 'word' | 'image';
  kind: ItemKind;
  confidence: number;
  name: string;
  /** 判断依据的说明，让用户知道系统为什么这么建议 */
  reason: string;
  /** 线索文字：Excel 的行、Word 的段落、图片的文件名 */
  clue: string;
  /** 预览图：图片类直接有，3D 的要先渲染 */
  previewUrl: string | null;
  mesh?: MeshData;
  /** 3D 项的几何量：切换归类时要按新密度重算参数，留着免得再解析一次 */
  summary?: GeometrySummary;
  params?: { name: string; value: number; unit: string; note: string }[];
  picked: Set<string>;
  target: { mode: 'new' } | { mode: 'update'; uid: string };
  checked: boolean;
  warnings: string[];
}

interface Failure {
  id: string;
  fileName: string;
  message: string;
  suggestion: string;
}

const SOURCE_LABEL: Record<ImportItem['source'], string> = {
  '3d': '3D',
  excel: 'Excel',
  word: 'Word',
  image: '图片',
};

function baseName(fileName: string) {
  return fileName.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '');
}

export function SmartImport({
  molds,
  parts,
  moldDensity = 7.85,
  partDensity = 1.05,
  onApply,
  onImportParams,
  onError,
  onInfo,
}: Props) {
  const [items, setItems] = useState<ImportItem[]>([]);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [applying, setApplying] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const seq = useRef(0);
  const loggerRef = useRef(new RecogLogger(setLog));
  const [paramsOpen, setParamsOpen] = useState(false);
  const [paramsBusy, setParamsBusy] = useState('');
  const [paramsPreview, setParamsPreview] = useState<any>(null);
  const [paramsErr, setParamsErr] = useState('');

  // 截图用的隐藏 viewer（3D 渲染缩略图）
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

  const logIt = loggerRef.current;

  /** 上报一条到后端，让服务端日志也有记录 */
  const report = (o: {
    kind: string;
    fileName: string;
    fileSize: number;
    outcome: 'ok' | 'empty' | 'unsupported' | 'failed';
    extracted?: number;
    reason?: string;
    step?: string;
  }) => uploads.logRecog(o);

  const addFailure = (fileName: string, err: RecogError) => {
    setFailures((p) => [...p, { id: String(++seq.current), fileName, message: err.message, suggestion: err.suggestion }]);
  };

  // ---------------- 各类型处理 ----------------

  const handle3D = async (file: File) => {
    const r = await parse3DFile(file, moldDensity);
    if (!r.ok) {
      logIt.error('3D解析', r.error);
      report({ kind: '3d', fileName: file.name, fileSize: file.size, outcome: 'failed', reason: r.error, step: 'parse' });
      addFailure(file.name, {
        code: 'PARSE_3D_FAILED',
        message: `${file.name}：${r.error}`,
        suggestion: r.hint || '确认文件没损坏；也可以让对方重新导出一次 STEP 再传',
      });
      return;
    }
    const d = r.data;
    const density = d.classify.kind === 'mold' ? moldDensity : partDensity;
    const params = suggestParams(d.summary, d.classify.kind, density);
    setItems((p) => [
      ...p,
      {
        id: String(++seq.current),
        source: '3d',
        kind: d.classify.kind,
        confidence: d.classify.confidence,
        name: baseName(file.name),
        reason: d.classify.reason,
        clue: `${d.summary.bbox.size.map((x) => Math.round(x)).join('×')}mm · ${d.summary.triangleCount.toLocaleString('zh-CN')} 面`,
        previewUrl: null,
        mesh: d.mesh,
        summary: d.summary,
        params,
        picked: new Set(params.map((x) => x.name)),
        target: { mode: 'new' },
        checked: true,
        warnings: d.warnings,
      },
    ]);
    logIt.info('3D解析', `${file.name} → ${d.classify.kind === 'mold' ? '模具' : '注塑件'}，体积 ${(d.summary.volumeMm3 / 1000).toFixed(1)}cm³`);
    report({ kind: '3d', fileName: file.name, fileSize: file.size, outcome: 'ok', extracted: 1 });
  };

  const handleExcel = async (file: File) => {
    try {
      const r = await uploads.extractExcel(file);
      logIt.info('Excel解析', `${file.name} → ${r.images.length} 张图`);
      report({ kind: 'excel', fileName: file.name, fileSize: file.size, outcome: 'ok', extracted: r.images.length });
      if (!r.images.length) {
        addFailure(file.name, {
          code: 'NO_IMAGE',
          message: `${file.name}：这个表格里没有内嵌图片`,
          suggestion: '确认图片是「嵌入」在单元格里的（不是浮动在表格上方）；也可以把图片单独截图后作为图片上传',
        });
        return;
      }
      const added: ImportItem[] = r.images.map((im) => ({
        id: String(++seq.current),
        source: 'excel',
        kind: im.suggestedKind,
        confidence: im.suggestedName ? 0.7 : 0.45,
        name: im.suggestedName || `第${im.row}行的件`,
        reason: im.suggestedName ? `取自第 ${im.row} 行的文字` : '该行没有明显品名，请确认',
        clue: `第${im.row}行：${im.rowText.slice(0, 4).join(' / ') || '（无文字）'}`,
        previewUrl: im.dataUrl,
        picked: new Set(),
        target: { mode: 'new' },
        checked: true,
        warnings: [],
      }));
      setItems((p) => [...p, ...added]);
    } catch (e: any) {
      const msg = e.response?.data?.error || e.message || '读取失败';
      const sug = e.response?.data?.suggestion || '确认文件没损坏，且是 .xlsx 格式';
      logIt.error('Excel解析', msg);
      report({ kind: 'excel', fileName: file.name, fileSize: file.size, outcome: 'failed', reason: msg, step: 'api' });
      addFailure(file.name, { code: 'EXCEL_FAILED', message: `${file.name}：${msg}`, suggestion: sug });
    }
  };

  const handleWord = async (file: File) => {
    try {
      const r = await uploads.extractWord(file);
      logIt.info('Word解析', `${file.name} → ${r.images.length} 张图`);
      report({ kind: 'word', fileName: file.name, fileSize: file.size, outcome: 'ok', extracted: r.images.length });
      if (!r.images.length) {
        addFailure(file.name, {
          code: 'NO_IMAGE',
          message: `${file.name}：这个文档里没有内嵌图片`,
          suggestion: '确认图片是插在文档里的（不是截图贴在别处）；也可以把图片单独存出来后作为图片上传',
        });
        return;
      }
      const added: ImportItem[] = r.images.map((im) => ({
        id: String(++seq.current),
        source: 'word',
        kind: im.suggestedKind,
        confidence: im.suggestedName ? 0.65 : 0.4,
        name: im.suggestedName || `第${im.para}段的件`,
        reason: im.altText ? '取自图片的可选文字' : im.suggestedName ? `取自第 ${im.para} 段附近的文字` : '附近没有明显品名，请确认',
        clue: `第${im.para}段：${im.paraText.slice(-2).join(' / ') || '（无文字）'}`,
        previewUrl: im.dataUrl,
        picked: new Set(),
        target: { mode: 'new' },
        checked: true,
        warnings: [],
      }));
      setItems((p) => [...p, ...added]);
    } catch (e: any) {
      const msg = e.response?.data?.error || e.message || '读取失败';
      const sug = e.response?.data?.suggestion || '确认文件没损坏，且是 .docx 格式';
      logIt.error('Word解析', msg);
      report({ kind: 'word', fileName: file.name, fileSize: file.size, outcome: 'failed', reason: msg, step: 'api' });
      addFailure(file.name, { code: 'WORD_FAILED', message: `${file.name}：${msg}`, suggestion: sug });
    }
  };

  const handleImage = (file: File) =>
    new Promise<void>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => {
        const dataUrl = String(fr.result || '');
        // 文件名里带「模」字倾向模具；否则默认注塑件，置信度给低值提醒确认
        const likeMold = /模|mold|模架|模芯|模仁/i.test(file.name);
        setItems((p) => [
          ...p,
          {
            id: String(++seq.current),
            source: 'image',
            kind: likeMold ? 'mold' : 'part',
            confidence: likeMold ? 0.5 : 0.45,
            name: baseName(file.name),
            reason: likeMold ? '文件名含「模」字' : '图片无法自动判断类型，默认按注塑件，请确认',
            clue: file.name,
            previewUrl: dataUrl,
            picked: new Set(),
            target: { mode: 'new' },
            checked: true,
            warnings: ['图片不做文字识别（OCR），请自行看图填写参数'],
          },
        ]);
        logIt.info('图片读取', `${file.name}（${humanSize(file.size)}）→ ${likeMold ? '倾向模具' : '默认注塑件'}`);
        report({ kind: 'image', fileName: file.name, fileSize: file.size, outcome: 'ok', extracted: 1 });
        resolve();
      };
      fr.onerror = () => {
        logIt.error('图片读取', `${file.name} 读不出来`);
        report({ kind: 'image', fileName: file.name, fileSize: file.size, outcome: 'failed', reason: '文件读取失败', step: 'read' });
        addFailure(file.name, {
          code: 'IMAGE_READ_FAILED',
          message: `${file.name}：图片读不出来`,
          suggestion: '确认文件没损坏；如果是 HEIC（苹果照片），请先转成 JPG',
        });
        resolve();
      };
      fr.readAsDataURL(file);
    });

  // ---------------- 三期：参数表导入 ----------------

  const handleParamsFile = async (file: File) => {
    setParamsBusy('解析中…');
    setParamsErr('');
    try {
      const r = await uploads.importParams(file);
      setParamsPreview(r);
      report({ kind: 'excel', fileName: file.name, fileSize: file.size, outcome: 'ok', extracted: (r.molds?.length || 0) + (r.parts?.length || 0), reason: '参数表映射' });
    } catch (e: any) {
      const msg = e.response?.data?.error || e.message || '解析失败';
      setParamsErr(msg + (e.response?.data?.suggestion ? '（' + e.response.data.suggestion + '）' : ''));
      report({ kind: 'excel', fileName: file.name, fileSize: file.size, outcome: 'failed', reason: msg, step: 'api' });
    } finally {
      setParamsBusy('');
    }
  };
  const handleParamsApply = () => {
    if (paramsPreview && onImportParams) onImportParams(paramsPreview);
    setParamsOpen(false);
    setParamsPreview(null);
  };

  // ---------------- 主流程 ----------------

  const handleFiles = async (files: File[]) => {
    if (!files.length) return;
    logIt.clear();
    logIt.info('开始', `收到 ${files.length} 个文件`);

    for (const file of files) {
      setBusy(`正在处理 ${file.name}…`);
      // 1) 前置体检：空 / 太大 / 不支持的格式，先拦下来并给明确建议
      const diag = diagnose({ name: file.name, size: file.size });
      if (diag) {
        logIt.warn('前置检查', `${file.name} → ${diag.code}`);
        report({
          kind: classifyFile(file.name).kind === 'unknown' ? 'unknown' : classifyFile(file.name).kind,
          fileName: file.name,
          fileSize: file.size,
          outcome: 'unsupported',
          reason: diag.message,
          step: 'diagnose',
        });
        addFailure(file.name, diag);
        continue;
      }
      // 2) 按类型分流
      const { kind } = classifyFile(file.name);
      try {
        if (kind === 'model3d') await handle3D(file);
        else if (kind === 'excel') await handleExcel(file);
        else if (kind === 'word') await handleWord(file);
        else if (kind === 'image') await handleImage(file);
      } catch (e: any) {
        // 兜底：任何没预料到的异常都要有回复，不能让用户看着转圈
        logIt.error('未预期异常', `${file.name} → ${e?.message}`);
        report({ kind, fileName: file.name, fileSize: file.size, outcome: 'failed', reason: e?.message, step: 'unexpected' });
        addFailure(file.name, {
          code: 'UNEXPECTED',
          message: `${file.name}：处理时出错了（${e?.message || '未知原因'}）`,
          suggestion: '请刷新页面重试；如果反复出现，把文件名和现象告诉我，我查日志定位',
        });
      }
    }
    setBusy('');
    const okCount = items.length;
    if (okCount) onInfo(`识别完成，请确认 ${okCount} 个件的归与参数`);
    else if (failures.length) onError(`没能识别出可用内容，请看下面的原因和解决办法`);
  };

  const patch = (id: string, fn: (it: ImportItem) => ImportItem) =>
    setItems((p) => p.map((it) => (it.id === id ? fn(it) : it)));

  const switchKind = (id: string, kind: ItemKind) =>
    patch(id, (it) => {
      // 3D 项按新归类重算参数（密度要跟着换，否则重量差 7 倍）
      const params =
        it.summary && it.mesh
          ? suggestParams(it.summary, kind, kind === 'mold' ? moldDensity : partDensity)
          : it.params;
      return {
        ...it,
        kind,
        target: { mode: 'new' }, // 归类换了，原来的「更新到已有件」就失效了
        params,
        picked: new Set((params ?? []).map((x) => x.name)),
      };
    });

  const handleApply = async () => {
    const picked = items.filter((it) => it.checked);
    if (!picked.length) return;
    const out: ApplyItem[] = [];
    // 有图没存上的必须让用户看见 —— 以前只写进折叠日志里，
    // 用户报完价导出 Excel 才发现没图，根本不知道是哪一步丢的
    const imageLost: string[] = [];
    for (let i = 0; i < picked.length; i++) {
      const it = picked[i];
      setApplying(`正在保存 ${i + 1}/${picked.length}…`);
      let image: QuoteImage | null = null;
      try {
        let dataUrl = it.previewUrl;
        if (!dataUrl && it.mesh) dataUrl = await capture(it.mesh);
        if (!dataUrl) {
          imageLost.push(`${it.name}（没能拿到图片数据）`);
        } else {
          const f = dataUrlToFile(dataUrl, `${it.name}.png`);
          if (!f) {
            imageLost.push(`${it.name}（图片数据不完整）`);
          } else {
            const bad = await assertExcelDisplayable(f);
            if (bad) {
              imageLost.push(`${it.name}（${bad}）`);
            } else {
              image = await uploadImage(f, { name: it.name, source: it.source === '3d' ? 'render3d' : 'excel' });
            }
          }
        }
      } catch (e: any) {
        const reason = e?.response?.data?.error || e?.message || '上传失败';
        imageLost.push(`${it.name}（${reason}）`);
        logIt.error('件图保存', `${it.name}：${reason}`);
      }
      const params: Record<string, number> = {};
      for (const p of it.params ?? []) if (it.picked.has(p.name)) params[p.name] = p.value;
      out.push({ kind: it.kind, target: it.target, name: it.name, params, image });
      logIt.info('导入', `${it.name} → ${it.kind === 'mold' ? '模具' : '注塑件'}${image ? '（含件图）' : '（无图）'}`);
    }
    setApplying('');
    if (imageLost.length) {
      onError(
        `参数已照常导入，但这 ${imageLost.length} 件的图没存上，导出的报价单里不会有图：${imageLost.join('；')}`,
      );
    }
    onApply(out);
    setItems([]);
    setFailures([]);
  };

  const targetsFor = (kind: ItemKind) =>
    kind === 'mold' ? molds.map((m) => ({ uid: m.uid, label: m.name })) : parts.map((p) => ({ uid: p.uid, label: p.name }));

  const total = items.length + failures.length;

  // 浏览器 WebGL 上下文有上限（通常 8~16 个），同时开太多会全部失效。
  // 所以 3D 预览最多渲染 3 个，且其模型本身不能太大。
  const PREVIEW_TRIS_LIMIT = 200_000;
  const preview3dIds = new Set(
    items
      .filter((i) => !i.previewUrl && i.mesh && (i.summary?.triangleCount ?? 0) <= PREVIEW_TRIS_LIMIT)
      .slice(0, 3)
      .map((i) => i.id),
  );

  return (
    <div className="border border-gray-200 rounded-lg bg-white p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[13px] font-medium text-gray-800">
          智能识别
          <span className="ml-2 text-[11px] font-normal text-gray-400">
            3D 数模 / Excel / Word / 截图 / 照片，拖进来就行
          </span>
        </div>
        <button
          type="button"
          onClick={() => setParamsOpen((v) => !v)}
          className="text-[11px] px-2 py-1 rounded border border-emerald-300 text-emerald-600 hover:bg-emerald-50"
        >
          {paramsOpen ? '返回识别' : '参数表导入'}
        </button>
        {total > 0 && (
          <div className="flex items-center gap-2">
            {log.length > 0 && (
              <button
                type="button"
                onClick={() => setLogOpen((v) => !v)}
                className="text-[11px] text-gray-400 hover:text-gray-600"
              >
                {logOpen ? '收起日志' : `日志(${log.length})`}
              </button>
            )}
            <button
              type="button"
              onClick={() => { setItems([]); setFailures([]); logIt.clear(); }}
              className="text-[11px] text-gray-400 hover:text-gray-600"
            >
              清空
            </button>
          </div>
        )}
      </div>

      {/* 拖拽区：什么都能拖 */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(Array.from(e.dataTransfer.files || [])); }}
        onClick={() => inputRef.current?.click()}
        className={`flex items-center justify-center py-5 border-2 border-dashed rounded cursor-pointer transition ${
          dragOver ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200 hover:border-emerald-300'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => { handleFiles(Array.from(e.target.files || [])); if (inputRef.current) inputRef.current.value = ''; }}
        />
        <span className="text-[12px] text-gray-500 text-center px-2">
          {busy || '把文件拖到这里，或点击选择（支持一次选多个）'}
          {!busy && (
            <span className="block text-[10.5px] text-gray-400 mt-1">
              3D：STEP / IGES / STL / OBJ / PLY / 3MF　·　表格：.xlsx / .docx　·　图片：PNG / JPG / WEBP
            </span>
          )}
        </span>
      </div>

      {paramsOpen && (
        <div className="mt-3 border border-emerald-200 rounded bg-emerald-50/40 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[12px] font-medium text-emerald-700">参数表导入（三期 · Excel 列映射）</div>
            <button type="button" onClick={() => { setParamsOpen(false); setParamsPreview(null); setParamsErr(''); }} className="text-[11px] text-gray-400 hover:text-gray-600">收起</button>
          </div>
          {!paramsPreview && !paramsBusy && (
            <label className="flex items-center justify-center py-4 border-2 border-dashed border-emerald-300 rounded cursor-pointer hover:bg-emerald-50">
              <input type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleParamsFile(f); e.currentTarget.value = ''; }} />
              <span className="text-[12px] text-gray-500">选择参数表 .xlsx（或 <a href={"/templates/报价参数导入模板.xlsx"} download className="text-emerald-600 underline">下载模板</a>）</span>
            </label>
          )}
          {paramsBusy && <div className="text-[12px] text-gray-500 py-3">正在解析参数表…</div>}
          {paramsErr && <div className="text-[12px] text-red-600 bg-red-50 rounded p-2">{paramsErr}</div>}
          {paramsPreview && (
            <div className="space-y-2">
              <div className="text-[12px] text-gray-700">
                识别到：<b>{paramsPreview.molds.length}</b> 套模具 · <b>{paramsPreview.parts.length}</b> 个注塑件 · <b>{paramsPreview.extras?.otherExtras?.length ?? 0}</b> 项其他费用
              </div>
              {paramsPreview.unmatched.length > 0 && (
                <div className="text-[11px] text-amber-600">未识别列（请人工确认）：{paramsPreview.unmatched.map((u: any) => u.column).join('、')}</div>
              )}
              {paramsPreview.warnings.length > 0 && (
                <div className="text-[11px] text-amber-600">{paramsPreview.warnings.join('；')}</div>
              )}
              {(paramsPreview.common?.profitRate !== undefined ||
                paramsPreview.common?.taxRate !== undefined) && (
                <div className="text-[11px] text-amber-600">
                  Excel 里的利润率/税率以配置中心为准，本次不覆盖
                </div>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setParamsPreview(null)} className="px-3 py-1.5 text-[12px] text-gray-500 border border-gray-200 rounded hover:bg-gray--50">重新选</button>
                <button type="button" onClick={handleParamsApply} className="px-3 py-1.5 text-[12px] text-white bg-emerald-600 rounded hover:bg-emerald-700">确认导入到报价页</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 日志（可展开） */}
      {logOpen && log.length > 0 && (
        <div className="mt-2 border border-gray-200 rounded bg-gray-50 p-2 max-h-48 overflow-auto">
          <div className="text-[10.5px] text-gray-500 mb-1">识别过程（出问题把它截图发我，我照着查）</div>
          {log.map((e, i) => (
            <div key={i} className="flex gap-1.5 text-[10.5px] leading-relaxed">
              <span className="text-gray-400 shrink-0">{e.ts}</span>
              <span className={e.level === 'error' ? 'text-red-600' : e.level === 'warn' ? 'text-amber-600' : 'text-gray-600'}>
                [{e.step}] {e.detail}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 失败项：必须给原因 + 解决办法 */}
      {failures.length > 0 && (
        <div className="mt-2.5 space-y-1.5">
          {failures.map((f) => (
            <div key={f.id} className="border border-red-200 bg-red-50/60 rounded p-2">
              <div className="text-[12px] text-red-700">⚠ {f.message}</div>
              <div className="text-[11px] text-gray-600 mt-0.5">怎么办：{f.suggestion}</div>
            </div>
          ))}
        </div>
      )}

      {/* 成功项 */}
      {items.length > 0 && (
        <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {items.map((it) => {
            const tg = targetsFor(it.kind);
            const lowConf = it.confidence < 0.6;
            return (
              <div
                key={it.id}
                className={`border rounded p-1.5 ${it.checked ? 'border-emerald-400 bg-emerald-50/30' : 'border-gray-200'}`}
              >
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={it.checked}
                    onChange={() => patch(it.id, (x) => ({ ...x, checked: !x.checked }))}
                  />
                  <span className="shrink-0 px-1 rounded bg-gray-100 text-[9.5px] text-gray-500">
                    {SOURCE_LABEL[it.source]}
                  </span>
                  <input
                    value={it.name}
                    onChange={(e) => patch(it.id, (x) => ({ ...x, name: e.target.value }))}
                    className="flex-1 min-w-0 text-[11px] border-b border-transparent hover:border-gray-300 focus:border-emerald-400 outline-none bg-transparent"
                  />
                </label>

                {it.previewUrl ? (
                  <div className="mt-1 bg-white border border-gray-100 rounded flex items-center justify-center h-[76px] overflow-hidden">
                    <img src={it.previewUrl} alt={it.name} className="max-h-full max-w-full object-contain" />
                  </div>
                ) : it.mesh ? (
                  preview3dIds.has(it.id) ? (
                    <div className="mt-1 bg-white border border-gray-100 rounded overflow-hidden">
                      <Model3DViewer mesh={it.mesh} height={76} />
                    </div>
                  ) : (
                    <div className="mt-1 h-[76px] bg-gray-50 border border-gray-100 rounded flex items-center justify-center text-[10px] text-gray-400 text-center px-1">
                      {(it.summary?.triangleCount ?? 0) > PREVIEW_TRIS_LIMIT
                        ? '模型太大，预览已省略（参数照常可用）'
                        : '3D 模型（预览未展开，参数照常可用）'}
                    </div>
                  )
                ) : null}

                <div className="text-[10px] text-gray-400 mt-1 truncate" title={it.clue}>
                  {it.clue}
                </div>

                <div className="flex gap-1 mt-1">
                  {(['mold', 'part'] as ItemKind[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => switchKind(it.id, k)}
                      className={`flex-1 px-1 py-0.5 rounded text-[10px] border transition ${
                        it.kind === k ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-gray-200 text-gray-500 hover:border-emerald-300'
                      }`}
                    >
                      {k === 'mold' ? '模具' : '注塑件'}
                    </button>
                  ))}
                </div>
                <div className={`text-[9.5px] mt-0.5 ${lowConf ? 'text-amber-600' : 'text-gray-400'}`} title={it.reason}>
                  {lowConf ? '⚠ 建议不确定：' : '建议：'}
                  {it.reason}
                </div>

                {it.params && it.params.length > 0 && (
                  <div className="mt-1 border-t border-gray-100 pt-1">
                    {it.params.map((p) => (
                      <label key={p.name} className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={it.picked.has(p.name)}
                          onChange={() =>
                            patch(it.id, (x) => {
                              const s = new Set(x.picked);
                              s.has(p.name) ? s.delete(p.name) : s.add(p.name);
                              return { ...x, picked: s };
                            })
                          }
                        />
                        <span className="text-[10px] text-gray-600">
                          {p.name}
                          <span className="ml-0.5 text-gray-900">{p.value}{p.unit}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}

                {it.warnings.map((w, k) => (
                  <div key={k} className="text-[9.5px] text-amber-600 mt-0.5">⚠ {w}</div>
                ))}

                {tg.length > 0 && (
                  <select
                    value={it.target.mode === 'new' ? '' : it.target.uid}
                    onChange={(e) =>
                      patch(it.id, (x) => ({
                        ...x,
                        target: e.target.value ? { mode: 'update', uid: e.target.value } : { mode: 'new' },
                      }))
                    }
                    className="mt-1 w-full border border-gray-200 rounded px-1 py-0.5 text-[10px]"
                  >
                    <option value="">新建{it.kind === 'mold' ? '模具' : '注塑件'}</option>
                    {tg.map((t) => (
                      <option key={t.uid} value={t.uid}>更新到 {t.label}</option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </div>
      )}

      {items.length > 0 && (
        <div className="flex justify-end gap-2 mt-2.5">
          <button
            type="button"
            onClick={() => { setItems([]); setFailures([]); logIt.clear(); }}
            className="px-3 py-1.5 text-[12px] text-gray-500 border border-gray-200 rounded hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!!busy || !!applying}
            onClick={handleApply}
            className="px-3 py-1.5 text-[12px] text-white bg-emerald-600 rounded hover:bg-emerald-700 disabled:opacity-50"
          >
            {applying || `确认导入（${items.filter((i) => i.checked).length} 个）`}
          </button>
        </div>
      )}

      <div style={{ position: 'fixed', left: -9999, top: 0, width: 320, height: 240, pointerEvents: 'none' }}>
        {shotMesh && (
          <Model3DViewer key={shotKey} ref={shotRef} mesh={shotMesh} height={240} onReady={onShotReady} />
        )}
      </div>
    </div>
  );
}
