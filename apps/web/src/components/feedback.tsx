// 全站统一反馈组件 —— 替代浏览器原生 alert/confirm/prompt。
// 原生对话框被浏览器（"阻止此页面创建更多对话框"）或安全插件拦截时会静默无反应，
// 用户点按钮没任何反馈；这里全部用自制 DOM 实现，保证每次点击都有可见结果。

import { useCallback, useState } from 'react';

type ToastKind = 'ok' | 'err';
interface ToastState {
  msg: string;
  kind: ToastKind;
  id: number;
}
interface ConfirmState {
  title: string;
  message: string;
  okText: string;
  danger: boolean;
  onOk: () => void;
}
interface PromptState {
  title: string;
  label?: string;
  value: string;
  checkboxLabel?: string;
  okText: string;
  onOk: (value: string, checked: boolean) => void;
}

export interface Feedback {
  /** 渲染在页面根部的 toast + 对话框 DOM */
  host: JSX.Element;
  /** 右下角轻提示（3.2s 自动消失） */
  toast: (msg: string, kind?: ToastKind) => void;
  /** 确认框（替代 confirm） */
  confirmBox: (
    opts: { title: string; message: string; okText?: string; danger?: boolean },
    onOk: () => void,
  ) => void;
  /** 输入框（替代 prompt，可选带一个复选框） */
  promptBox: (
    opts: {
      title: string;
      label?: string;
      value?: string;
      checkboxLabel?: string;
      okText?: string;
    },
    onOk: (value: string, checked: boolean) => void,
  ) => void;
}

export function useFeedback(): Feedback {
  const [toastState, setToastState] = useState<ToastState | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [promptState, setPromptState] = useState<PromptState | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const [promptChecked, setPromptChecked] = useState(false);

  const toast = useCallback((msg: string, kind: ToastKind = 'ok') => {
    setToastState({ msg, kind, id: Date.now() });
    window.setTimeout(() => {
      setToastState((cur) => (cur && cur.msg === msg ? null : cur));
    }, 3200);
  }, []);

  const confirmBox = useCallback<Feedback['confirmBox']>((opts, onOk) => {
    setConfirmState({
      title: opts.title,
      message: opts.message,
      okText: opts.okText ?? '确定',
      danger: opts.danger === true,
      onOk,
    });
  }, []);

  const promptBox = useCallback<Feedback['promptBox']>((opts, onOk) => {
    setPromptValue(opts.value ?? '');
    setPromptChecked(false);
    setPromptState({
      title: opts.title,
      label: opts.label,
      value: opts.value ?? '',
      checkboxLabel: opts.checkboxLabel,
      okText: opts.okText ?? '确定',
      onOk,
    });
  }, []);

  const closeDialog = () => {
    setConfirmState(null);
    setPromptState(null);
  };

  const host = (
    <>
      {/* Toast：右下角 */}
      {toastState && (
        <div
          key={toastState.id}
          className={`fixed bottom-6 right-6 z-[70] max-w-sm rounded-lg border px-4 py-2.5 text-[13px] shadow-lg backdrop-blur ${
            toastState.kind === 'ok'
              ? 'bg-emerald-50/95 border-emerald-200 text-emerald-800'
              : 'bg-red-50/95 border-red-200 text-red-700'
          }`}
          style={{ animation: 'fbToastIn .25s ease-out' }}
        >
          {toastState.msg}
        </div>
      )}
      <style>{`@keyframes fbToastIn { from { opacity:0; transform: translateY(8px);} to { opacity:1; transform: translateY(0);} }`}</style>

      {/* 确认框 */}
      {confirmState && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-6 z-[60]" onClick={closeDialog}>
          <div className="bg-white rounded-lg w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="font-medium text-[14.5px]">{confirmState.title}</h2>
            </div>
            <div className="px-6 py-4 text-[13px] text-gray-600 leading-6 whitespace-pre-line">
              {confirmState.message}
            </div>
            <div className="px-6 py-3 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={closeDialog} className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50">
                取消
              </button>
              <button
                onClick={() => {
                  const fn = confirmState.onOk;
                  closeDialog();
                  fn();
                }}
                className={`px-4 py-2 text-sm text-white rounded ${
                  confirmState.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-900 hover:bg-gray-800'
                }`}
              >
                {confirmState.okText}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 输入框 */}
      {promptState && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-6 z-[60]" onClick={closeDialog}>
          <div className="bg-white rounded-lg w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="font-medium text-[14.5px]">{promptState.title}</h2>
            </div>
            <div className="px-6 py-4 space-y-3">
              <input
                autoFocus
                value={promptValue}
                onChange={(e) => setPromptValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const v = promptValue.trim();
                    if (!v) return;
                    const fn = promptState.onOk;
                    const ck = promptChecked;
                    closeDialog();
                    fn(v, ck);
                  }
                }}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:border-blue-500 outline-none"
              />
              {promptState.label && <p className="text-[11.5px] text-gray-400">{promptState.label}</p>}
              {promptState.checkboxLabel && (
                <label className="flex items-center gap-2 text-[12.5px] text-gray-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={promptChecked}
                    onChange={(e) => setPromptChecked(e.target.checked)}
                    className="w-4 h-4"
                  />
                  {promptState.checkboxLabel}
                </label>
              )}
            </div>
            <div className="px-6 py-3 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={closeDialog} className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50">
                取消
              </button>
              <button
                onClick={() => {
                  const v = promptValue.trim();
                  if (!v) return;
                  const fn = promptState.onOk;
                  const ck = promptChecked;
                  closeDialog();
                  fn(v, ck);
                }}
                className="px-4 py-2 text-sm bg-gray-900 text-white rounded hover:bg-gray-800"
              >
                {promptState.okText}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  return { host, toast, confirmBox, promptBox };
}
