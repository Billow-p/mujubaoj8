/**
 * Excel 询价单图片导入（二期）。
 *
 * 客户发来的询价表常常是「左边写品名规格，右边贴图」。
 * 这里把内嵌图抠出来，连同它所在行的文字一起展示 —— 用户看一眼就知道这张图是哪个件，
 * 点选后批量落到件图槽，不用一张张手动传。
 *
 * 列映射（把 Excel 的行直接变成报价参数）是三期的事，这里只解决图片归位。
 */

import { useRef, useState } from 'react';
import { uploads, type ExcelImageItem, type QuoteImage } from '../api';
import { uploadImage, dataUrlToFile } from '../utils/image';
import type { ItemKind } from '../utils/geometry';

export interface ApplyImageItem {
  kind: ItemKind;
  target: { mode: 'new' } | { mode: 'update'; uid: string };
  name: string;
  image: QuoteImage | null;
}

interface Props {
  molds: { uid: string; name: string }[];
  parts: { uid: string; name: string }[];
  onApply: (items: ApplyImageItem[]) => void;
  onError: (msg: string) => void;
  onInfo: (msg: string) => void;
}

interface Row {
  id: string;
  img: ExcelImageItem;
  kind: ItemKind;
  /** 用户可改的件名，默认取系统建议 */
  name: string;
  checked: boolean;
  target: { mode: 'new' } | { mode: 'update'; uid: string };
}

export function ExcelImageImport({ molds, parts, onApply, onError, onInfo }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState('');
  const [notes, setNotes] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = async (f: File | undefined) => {
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) {
      onError('只支持 .xlsx；老版 .xls 里的图片读不出来，请用 Excel 另存为 .xlsx');
      return;
    }
    setBusy(true);
    setRows([]);
    try {
      const r = await uploads.extractExcel(f);
      setFileName(r.fileName);
      setNotes(r.notes || []);
      setRows(
        (r.images || []).map((img) => ({
          id: `${img.id}-${img.row}-${img.col}`,
          img,
          kind: img.suggestedKind,
          name: img.suggestedName || `第${img.row}行的件`,
          checked: true,
          target: { mode: 'new' },
        })),
      );
      if (r.notes?.length) onInfo(r.notes[0]);
    } catch (e: any) {
      onError('读取 Excel 失败：' + (e.response?.data?.error || e.message));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const patch = (id: string, fn: (r: Row) => Row) =>
    setRows((prev) => prev.map((r) => (r.id === id ? fn(r) : r)));

  const handleApply = async () => {
    const picked = rows.filter((r) => r.checked);
    if (!picked.length) return;
    const out: ApplyImageItem[] = [];
    for (let i = 0; i < picked.length; i++) {
      const r = picked[i];
      setApplying(`正在保存件图 ${i + 1}/${picked.length}…`);
      let image: QuoteImage | null = null;
      try {
        const file = dataUrlToFile(r.img.dataUrl, r.img.name);
        if (file) image = await uploadImage(file, { name: r.img.name, source: 'excel' });
      } catch {
        // 单张失败不阻断整批
      }
      out.push({ kind: r.kind, target: r.target, name: r.name, image });
    }
    setApplying('');
    onApply(out);
    setRows([]);
    setNotes([]);
    setFileName('');
  };

  const targetsFor = (kind: ItemKind) =>
    kind === 'mold'
      ? molds.map((m) => ({ uid: m.uid, label: m.name }))
      : parts.map((p) => ({ uid: p.uid, label: p.name }));

  return (
    <div className="border border-gray-200 rounded-lg bg-white p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[13px] font-medium text-gray-800">
          从 Excel 询价单提取图片
          <span className="ml-2 text-[11px] font-normal text-gray-400">
            把表格里贴的图按行归到件上
          </span>
        </div>
        {rows.length > 0 && (
          <button
            type="button"
            onClick={() => { setRows([]); setNotes([]); setFileName(''); }}
            className="text-[11px] text-gray-400 hover:text-gray-600"
          >
            清空
          </button>
        )}
      </div>

      <div
        onClick={() => inputRef.current?.click()}
        className="flex items-center justify-center py-3.5 border-2 border-dashed border-gray-200 rounded cursor-pointer hover:border-emerald-300 transition"
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        <span className="text-[12px] text-gray-500">
          {busy ? '正在解析 Excel…' : fileName ? `已读取：${fileName}（点击换一个）` : '点击选择 .xlsx 询价表'}
        </span>
      </div>

      {notes.map((n, i) => (
        <div key={i} className="text-[10.5px] text-gray-500 mt-1.5">
          {n}
        </div>
      ))}

      {rows.length > 0 && (
        <>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {rows.map((r) => {
              const tg = targetsFor(r.kind);
              return (
                <div
                  key={r.id}
                  className={`border rounded p-1.5 ${r.checked ? 'border-emerald-400 bg-emerald-50/30' : 'border-gray-200'}`}
                >
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={r.checked}
                      onChange={() => patch(r.id, (x) => ({ ...x, checked: !x.checked }))}
                    />
                    <input
                      value={r.name}
                      onChange={(e) => patch(r.id, (x) => ({ ...x, name: e.target.value }))}
                      className="flex-1 min-w-0 text-[11px] border-b border-transparent hover:border-gray-300 focus:border-emerald-400 outline-none bg-transparent"
                      title="件名，可修改"
                    />
                  </label>

                  <div className="mt-1 bg-white border border-gray-100 rounded flex items-center justify-center h-[76px] overflow-hidden">
                    <img src={r.img.dataUrl} alt={r.name} className="max-h-full max-w-full object-contain" />
                  </div>

                  <div
                    className="text-[10px] text-gray-400 mt-1 truncate"
                    title={`第 ${r.img.row} 行：${r.img.rowText.join(' / ')}`}
                  >
                    第{r.img.row}行：{r.img.rowText.slice(0, 3).join(' / ') || '（该行无文字）'}
                  </div>

                  <div className="flex gap-1 mt-1">
                    {(['mold', 'part'] as ItemKind[]).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() =>
                          patch(r.id, (x) => ({
                            ...x,
                            kind: k,
                            // 归类换了，原目标就失效了
                            target: { mode: 'new' },
                          }))
                        }
                        className={`flex-1 px-1 py-0.5 rounded text-[10px] border transition ${
                          r.kind === k
                            ? 'border-emerald-500 bg-emerald-500 text-white'
                            : 'border-gray-200 text-gray-500 hover:border-emerald-300'
                        }`}
                      >
                        {k === 'mold' ? '模具' : '注塑件'}
                      </button>
                    ))}
                  </div>

                  {tg.length > 0 && (
                    <select
                      value={r.target.mode === 'new' ? '' : r.target.uid}
                      onChange={(e) =>
                        patch(r.id, (x) => ({
                          ...x,
                          target: e.target.value ? { mode: 'update', uid: e.target.value } : { mode: 'new' },
                        }))
                      }
                      className="mt-1 w-full border border-gray-200 rounded px-1 py-0.5 text-[10px]"
                    >
                      <option value="">新建{r.kind === 'mold' ? '模具' : '注塑件'}</option>
                      {tg.map((t) => (
                        <option key={t.uid} value={t.uid}>
                          更新到 {t.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex justify-end gap-2 mt-2.5">
            <button
              type="button"
              onClick={() => { setRows([]); setNotes([]); setFileName(''); }}
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
              {applying || `确认导入（${rows.filter((r) => r.checked).length} 张）`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
