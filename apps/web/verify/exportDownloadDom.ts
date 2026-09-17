/*
 * 导出下载链路（exportExcel / exportAll）行为验证。
 *
 * 为什么单独测这块：这两个函数是「点一下没反应」类问题的重灾区，而且
 * 出问题时后端毫不知情（接口返回 200 且字节数正确），纯服务端测试查不出来。
 * 历史上踩过两个坑，这里各留一条断言防复发：
 *
 *   坑 1：responseType:'blob' 会连**错误响应体**一起包成 Blob。
 *        调用方读 e.response?.data?.error 永远 undefined，
 *        用户只看到「导出失败：undefined」，等于没有任何报错信息。
 *   坑 2：content-disposition 不在 CORS expose 白名单里时，
 *        浏览器不给 JS，文件名只能退回通用名（现在退到「报价单_<id>.xlsx」）。
 *
 * 测试方式：把 `../api` 里的 axios 实例换成假实现，只验证函数自身的
 * 响应处理逻辑 —— 不依赖真实网络，也不依赖真机浏览器。
 */

declare const require: any;

async function main() {
  const { JSDOM } = require('jsdom');

  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });

  const g: any = globalThis;
  const setGlobal = (k: string, v: any) =>
    Object.defineProperty(g, k, { value: v, writable: true, configurable: true });

  setGlobal('window', dom.window);
  setGlobal('document', dom.window.document);
  setGlobal('navigator', dom.window.navigator);
  setGlobal('Blob', dom.window.Blob);
  setGlobal('File', dom.window.File);
  setGlobal('FormData', dom.window.FormData);

  // 捕获下载动作：jsdom 不会真的下载，这里拦 createObjectURL + a.click
  const downloads: { name: string; size: number }[] = [];
  let lastBlobSize = -1;
  (dom.window.URL as any).createObjectURL = (b: any) => {
    lastBlobSize = b?.size ?? -1;
    return 'blob:fake-' + downloads.length;
  };
  (dom.window.URL as any).revokeObjectURL = () => {};
  setGlobal('URL', dom.window.URL);

  // 拦截 <a> 的 click，记录 download 属性与 blob 大小
  const origClick = dom.window.HTMLAnchorElement.prototype.click;
  dom.window.HTMLAnchorElement.prototype.click = function (this: any) {
    downloads.push({ name: this.download, size: lastBlobSize });
  };
  void origClick;

  const h = dom.window.document.createElement.bind(dom.window.document);

  const results: [string, boolean][] = [];
  const check = (label: string, cond: any) => results.push([label, !!cond]);

  // ---- 用假 axios 顶掉真实实例 ----
  // api.ts 里 `const api = axios.create(...)`，所以只需让 axios.create 返回
  // 一个我们可控的对象：get 返回预设响应即可。
  const calls: { url: string; status: number; body: any; headers: any }[] = [];
  let nextResp: any = null;

  const fakeAxios = {
    create: () => ({
      get: async (url: string) => {
        calls.push({ url, ...nextResp });
        if (nextResp.__throw) throw nextResp.__throw;
        return nextResp;
      },
      interceptors: {
        request: { use: () => {} },
        response: { use: () => {} },
      },
    }),
    get: async () => nextResp,
  };

  // api.ts 顶部 `import axios from 'axios'` —— 借 require 缓存把它替换掉。
  // 注意：打包产物落在 node_modules/.cache 下，require.resolve 用 __dirname
  // 找不到 axios，需要遍历 NODE_PATH 里给的那些目录去定位。
  const Module = require('module');
  const axiosPath = (() => {
    try {
      return require.resolve('axios');
    } catch {
      /* 继续用 NODE_PATH 找 */
    }
    const dirs = String(process.env.NODE_PATH || '')
      .split(require('path').delimiter)
      .filter(Boolean);
    for (const d of dirs) {
      try {
        return require.resolve('axios', { paths: [d] });
      } catch {
        /* 换下一个 */
      }
    }
    return null;
  })();
  void Module;

  if (axiosPath) {
    const axiosCacheEntry = require.cache[axiosPath];
    if (axiosCacheEntry) {
      axiosCacheEntry.exports = { ...fakeAxios, default: fakeAxios };
    } else {
      // 尚未被加载：先写进缓存，等 api.ts import 时直接命中
      require.cache[axiosPath] = {
        id: axiosPath,
        filename: axiosPath,
        loaded: true,
        exports: { ...fakeAxios, default: fakeAxios },
      } as any;
    }
  } else {
    check('（环境）能够定位到 axios 模块', false);
  }

  // 每个用例前重置调用记录
  const reset = () => {
    calls.length = 0;
    downloads.length = 0;
    lastBlobSize = -1;
  };

  let api: any;
  try {
    api = require('../src/api');
  } catch (e: any) {
    console.log('  ⚠ 无法加载 ../src/api：' + e.message);
    console.log('    该验证需要打包时保留 axios（不 stub ../api 整个模块）。');
    results.push(['（环境）../src/api 可加载', false]);
  }

  if (api?.quotes?.exportExcel) {
    // ---- 用例 1：正常返回，文件名从 content-disposition 解析（含中文）----
    reset();
    nextResp = {
      status: 200,
      data: new dom.window.Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])]),
      headers: {
        'content-disposition':
          'attachment; filename="%E6%8A%A5%E4%BB%B7%E5%8D%95_BJ-20260917-9569.xlsx"',
        'content-length': '4',
      },
    };
    await api.quotes.exportExcel('q1');
    check('正常导出：触发了下载', downloads.length === 1);
    check(
      '正常导出：文件名已从 content-disposition 解码（中文）',
      downloads[0]?.name === '报价单_BJ-20260917-9569.xlsx',
    );
    check('正常导出：blob 大小与响应体一致（4 字节）', downloads[0]?.size === 4);

    // ---- 用例 2：读不到 content-disposition → 退回通用中文名，但**仍要下载** ----
    reset();
    nextResp = {
      status: 200,
      data: new dom.window.Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])]),
      headers: {}, // CORS 没 expose 时的真实情形
    };
    await api.quotes.exportExcel('q2');
    check('读不到文件名头：仍然完成下载（不因文件名缺失而失败）', downloads.length === 1);
    check('读不到文件名头：退回「报价单_q2.xlsx」', downloads[0]?.name === '报价单_q2.xlsx');

    // ---- 用例 3：filename*=UTF-8'' 形式也能解析 ----
    reset();
    nextResp = {
      status: 200,
      data: new dom.window.Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])]),
      headers: {
        'content-disposition': "attachment; filename*=UTF-8''%E5%AE%A2%E6%88%B7.xlsx",
      },
    };
    await api.quotes.exportExcel('q3');
    check("RFC 5987 形式（filename*=UTF-8''）：解析出「客户.xlsx」", downloads[0]?.name === '客户.xlsx');

    // ---- 用例 4（坑 1 防复发）：4xx 时错误信息要能从 Blob 里还原 ----
    reset();
    nextResp = {
      status: 404,
      data: new dom.window.Blob([JSON.stringify({ error: '报价单不存在' })]),
      headers: { 'content-type': 'application/json' },
    };
    let err4: any = null;
    try {
      await api.quotes.exportExcel('nope');
    } catch (e: any) {
      err4 = e;
    }
    check('4xx：抛错而不是静默假装成功', !!err4);
    check(
      '4xx：错误信息从 Blob 还原成后端原文「报价单不存在」',
      String(err4?.message || '').includes('报价单不存在'),
    );
    check('4xx：错误信息不是 undefined/', !String(err4?.message || '').includes('undefined'));
    check('4xx：未触发下载', downloads.length === 0);

    // ---- 用例 5：500 且响应体不是 JSON → 兜底文案带状态码 ----
    reset();
    nextResp = {
      status: 500,
      data: new dom.window.Blob(['<html>Internal Server Error</html>']),
      headers: {},
    };
    let err5: any = null;
    try {
      await api.quotes.exportExcel('boom');
    } catch (e: any) {
      err5 = e;
    }
    check('5xx 非 JSON 响应：抛错', !!err5);
    check('5xx 非 JSON 响应：兜底文案含 HTTP 500', String(err5?.message || '').includes('500'));

    // ---- 用例 6：200 但内容为空 → 拦下，不下载空文件 ----
    reset();
    nextResp = {
      status: 200,
      data: new dom.window.Blob([]),
      headers: {},
    };
    let err6: any = null;
    try {
      await api.quotes.exportExcel('empty');
    } catch (e: any) {
      err6 = e;
    }
    check('200 但内容为空：抛错提醒重试', !!err6);
    check('200 但内容为空：未下载 0 字节文件', downloads.length === 0);

    // ---- 用例 7：网络层异常（断网/跨域）→ 转成可读 message ----
    reset();
    nextResp = { __throw: new Error('Network Error') };
    let err7: any = null;
    try {
      await api.quotes.exportExcel('net');
    } catch (e: any) {
      err7 = e;
    }
    check('网络异常：抛出的 message 为 Network Error', String(err7?.message || '') === 'Network Error');
  }

  // ---- 客户数据一键导出：与 exportExcel 同一套加固，抽两条关键断言 ----
  if (api?.customers?.exportAll) {
    reset();
    nextResp = {
      status: 200,
      data: new dom.window.Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])]),
      headers: { 'content-disposition': 'attachment; filename="%E5%AE%A2%E6%88%B7%E6%95%B0%E6%8D%AE.xlsx"' },
    };
    await api.customers.exportAll();
    check(
      '客户数据导出：文件名正确解码为「客户数据.xlsx」',
      downloads[0]?.name === '客户数据.xlsx',
    );

    reset();
    nextResp = {
      status: 403,
      data: new dom.window.Blob([JSON.stringify({ error: '无权导出' })]),
      headers: {},
    };
    let errC: any = null;
    try {
      await api.customers.exportAll();
    } catch (e: any) {
      errC = e;
    }
    check('客户数据导出 403：还原后端错误「无权导出」', String(errC?.message || '').includes('无权导出'));
  }

  // ---- 输出 ----
  const pass = results.filter(([, ok]) => ok).length;
  for (const [label, ok] of results) console.log(`  ${ok ? '✅' : '❌'} ${label}`);
  console.log(`\n导出下载链路：${pass}/${results.length} 通过`);

  if (pass !== results.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error('验证脚本自身报错：', e);
  process.exit(2);
});
