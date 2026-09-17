/**
 * OpenCascade 解析 Worker（classic script，不参与打包）。
 *
 * 为什么必须放 Worker：
 * 1) WASM 有 7.6MB，初始化 + 解析大件要几百毫秒到几秒，放主线程会卡死界面；
 * 2) occt-import-js 是老式 emscripten 产物，内部有 require('fs') 的 Node 分支，
 *    走打包容易被引擎静态分析搞崩，放 public 下直接用 importScripts 最稳。
 *
 * 只在这三种格式上用：STEP / IGES / BREP。
 */

importScripts('./occt-import-js.js');
importScripts('./merge-meshes.js');

// ⚠️ WASM 只初始化一次，之后复用。
// 原来每收一条消息都 occtimportjs() 一次 —— 7.6MB 的 WASM 每解析一个文件就重新
// 实例化一遍，STEP / IGES 会慢到几十秒，用户以为卡死。
let occtPromise = null;
function getOcct() {
  if (!occtPromise) {
    occtPromise = occtimportjs({ locateFile: (path) => path }); // wasm 与本脚本同目录
  }
  return occtPromise;
}

self.onmessage = async (ev) => {
  const { format, buffer, params, warmup } = ev.data || {};

  // 预热：页面空闲时先起好 WASM，等用户真传 STEP 就不用再等了
  if (warmup) {
    try {
      await getOcct();
      self.postMessage({ ok: true, warm: true });
    } catch (e) {
      occtPromise = null; // 失败就丢掉，下次再试
      self.postMessage({ ok: false, error: (e && e.message) || '3D 内核预热失败' });
    }
    return;
  }

  try {
    const occt = await getOcct();
    const result = occt.ReadFile(format, new Uint8Array(buffer), params || {});

    if (!result || !result.success) {
      self.postMessage({ ok: false, error: 'OpenCascade 读不出这个文件（可能已损坏，或后缀与内容不符）' });
      return;
    }
    const merged = mergeMeshes(result.meshes || []);
    if (!merged) {
      self.postMessage({ ok: false, error: '模型里没有可见的几何体' });
      return;
    }
    // 大数据用 transfer，避免再拷贝一份
    self.postMessage(
      { ok: true, positions: merged.positions, indices: merged.indices },
      [merged.positions.buffer].concat(merged.indices ? [merged.indices.buffer] : []),
    );
  } catch (e) {
    self.postMessage({ ok: false, error: (e && e.message) || 'OpenCascade 解析异常' });
  }
};
