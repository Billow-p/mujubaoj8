/**
 * 最小 ZIP 读取器 —— 只为读 3MF 里的 3D/3dmodel.model。
 * 只支持 stored(0) 与 deflate(8)，够 3MF 用了；不处理加密、分卷、zip64。
 * 浏览器与 Node 18+ 都可用（依赖内置 DecompressionStream）。
 */

export interface ZipEntry {
  name: string;
  /** 解压后的字节 */
  data: Uint8Array;
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

function u16(b: Uint8Array, o: number) {
  return b[o] | (b[o + 1] << 8);
}
function u32(b: Uint8Array, o: number) {
  // 用 >>> 0 保证无符号，避免大文件溢出成负数
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

/** 从尾部往前找 EOCD（末尾可能有注释） */
function findEocd(b: Uint8Array): number {
  const minStart = Math.max(0, b.length - 22 - 0xffff);
  for (let i = b.length - 22; i >= minStart; i--) {
    if (u32(b, i) === EOCD_SIG) return i;
  }
  return -1;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  // 复制一份再取 buffer：subarray 的底层是共享内存，类型上也不被 Blob 接受
  const copy = new Uint8Array(data.length);
  copy.set(data);
  const stream = new Blob([copy.buffer as ArrayBuffer]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * 解开 ZIP，返回全部条目。
 * @throws 不是合法 ZIP 或解压失败时抛错
 */
export async function unzip(bytes: Uint8Array): Promise<ZipEntry[]> {
  const eocd = findEocd(bytes);
  if (eocd < 0) throw new Error('不是有效的压缩包（找不到目录结构）');

  const count = u16(bytes, eocd + 10);
  let ptr = u32(bytes, eocd + 16); // 中央目录起始位置

  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (u32(bytes, ptr) !== CEN_SIG) break;
    const method = u16(bytes, ptr + 10);
    const compSize = u32(bytes, ptr + 20);
    const nameLen = u16(bytes, ptr + 28);
    const extraLen = u16(bytes, ptr + 30);
    const commentLen = u16(bytes, ptr + 32);
    const localOff = u32(bytes, ptr + 42);

    const name = new TextDecoder().decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));

    // 本地头：30 字节固定 + 文件名 + 额外字段 → 之后才是数据
    if (u32(bytes, localOff) !== LOC_SIG) {
      ptr += 46 + nameLen + extraLen + commentLen;
      continue;
    }
    const lNameLen = u16(bytes, localOff + 26);
    const lExtraLen = u16(bytes, localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(dataStart, dataStart + compSize);

    let data: Uint8Array;
    if (method === 0) {
      data = raw;
    } else if (method === 8) {
      data = await inflateRaw(raw);
    } else {
      // 其他压缩方式（如 LZMA）跳过，3MF 基本不会遇到
      ptr += 46 + nameLen + extraLen + commentLen;
      continue;
    }

    out.push({ name, data });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
