/**
 * 把 OpenCascade 返回的多个 mesh 合并成一个。
 * 独立成文件：Worker 用 importScripts 加载，Node 里也能 require 来做单元测试。
 */
function mergeMeshes(meshes) {
  let totalVerts = 0;
  let totalIdx = 0;
  for (const m of meshes) {
    const pos = m && m.attributes && m.attributes.position && m.attributes.position.array;
    if (!pos || !pos.length) continue;
    totalVerts += pos.length;
    totalIdx += (m && m.index && m.index.array && m.index.array.length) || 0;
  }
  if (!totalVerts) return null;

  const positions = new Float32Array(totalVerts);
  const indices = new Uint32Array(totalIdx);
  let vOff = 0; // 已写入的 float 数
  let iOff = 0;
  let base = 0; // 当前 mesh 的顶点起始下标（索引要整体偏移）

  for (const m of meshes) {
    const pos = m && m.attributes && m.attributes.position && m.attributes.position.array;
    if (!pos || !pos.length) continue;
    positions.set(pos, vOff);

    const idx = m && m.index && m.index.array;
    if (idx && idx.length) {
      for (let i = 0; i < idx.length; i++) indices[iOff + i] = idx[i] + base;
      iOff += idx.length;
    }
    vOff += pos.length;
    base += pos.length / 3;
  }
  return { positions: positions, indices: iOff ? indices : null };
}

if (typeof module === 'object' && typeof module.exports === 'object') {
  module.exports = { mergeMeshes: mergeMeshes };
}
