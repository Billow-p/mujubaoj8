/**
 * 从 Word 询价单（.docx）里提取内嵌图片。
 *
 * 客户经常发「一个 Word，上面写品名规格，下面贴图」。
 * .docx 本身就是 ZIP：word/media/ 存图片，word/document.xml 存正文。
 * 这里把图抠出来，并带上它附近段落的文字 —— 界面上就知道这张图是哪个件。
 *
 * 只支持 .docx：老 .doc 是 OLE 复合文档（不是 ZIP），读不了，直接让客户另存为 .docx。
 * 不引第三方 ZIP 库，用 Node 内置 zlib 自己解，少一个依赖少一份风险。
 */

import zlib from 'zlib';

export interface WordImageItem {
  id: number;
  /** 图片所在的段落序号（1 起） */
  para: number;
  name: string;
  dataUrl: string;
  /** 该段落的文字，作为「这是什么件」的线索 */
  paraText: string[];
  /** 图片本身的替代文字（Word 里可以填），有的话优先用 */
  altText: string;
  suggestedName: string;
  suggestedKind: 'mold' | 'part';
}

export interface WordExtractResult {
  fileName: string;
  /** 文档里的段落数 */
  paraCount: number;
  images: WordImageItem[];
  skipped: number;
  notes: string[];
}

const MAX_IMAGES = 40;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** 浏览器能直接显示的图片类型（排除 EMF/WMF 等矢量图） */
const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
};

// ------------------------------------------------------------------ ZIP

interface ZipEntry {
  name: string;
  data: Buffer;
}

/** 最小 ZIP 读取器：够读 docx，不支持 zip64 / 加密 / 分卷 */
function unzipSync(buf: Buffer): ZipEntry[] {
  // 从尾部往前找 EOCD（末尾可能有注释）
  let eocd = -1;
  const minStart = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= minStart; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是有效的 .docx（解压失败，文件可能已损坏）');

  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  const out: ZipEntry[] = [];

  for (let i = 0; i < count; i++) {
    if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== 0x02014b50) break;
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOff = buf.readUInt32LE(ptr + 42);
    const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen);

    if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== 0x04034b50) {
      ptr += 46 + nameLen + extraLen + commentLen;
      continue;
    }
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);

    let data: Buffer;
    try {
      if (method === 0) data = raw;
      else if (method === 8) data = zlib.inflateRawSync(raw);
      else {
        ptr += 46 + nameLen + extraLen + commentLen;
        continue;
      }
    } catch {
      ptr += 46 + nameLen + extraLen + commentLen;
      continue;
    }
    out.push({ name, data });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ------------------------------------------------------------------ 工具

function stripTags(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, '')
    .trim();
}

/** 这些开头的段落是属性说明，不是件名，取名时要跳过 */
const DESC_PREFIX =
  /^(数量|规格|材质|备注|尺寸|要求|说明|单位|单价|金额|颜色|表面|公差|包装|交期|重量|工期)/;

/**
 * 从候选文字里挑出最像件名的。
 * **从后往前找**：图片通常紧跟在它自己的说明后面，越近越可能是这个件的名字。
 * 但「数量 5000」这类属性行也常常紧跟在后面，所以要跳过描述性开头。
 */
function pickName(cands: string[]): string {
  for (let i = cands.length - 1; i >= 0; i--) {
    const t = cands[i];
    if (!t || t.length < 2 || t.length > 40) continue;
    if (/^[\d.,\s¥$￥\-/]+$/.test(t)) continue; // 纯数字/金额
    if (DESC_PREFIX.test(t)) continue; // 属性说明行
    if (/[一-龥]/.test(t)) return t;
    if (/[A-Za-z]/.test(t)) return t;
  }
  return '';
}

// ------------------------------------------------------------------ 主流程

export function extractWordImages(buf: Buffer, fileName: string): WordExtractResult {
  const entries = unzipSync(buf);
  const byName = new Map(entries.map((e) => [e.name, e]));

  const doc = byName.get('word/document.xml');
  if (!doc) {
    throw new Error('这不是一个正常的 Word 文档（缺 word/document.xml）');
  }
  const xml = doc.data.toString('utf8');

  // 1) 关系映射：rId → media 路径
  //    <Relationship Id="rId4" Type=".../image" Target="media/image1.png"/>
  const relMap = new Map<string, string>();
  const relEntry = byName.get('word/_rels/document.xml.rels');
  if (relEntry) {
    const relXml = relEntry.data.toString('utf8');
    const re = /<Relationship\b[^>]*\bId\s*=\s*"([^"]+)"[^>]*>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(relXml))) {
      const id = m[1];
      const target = /Target\s*=\s*"([^"]+)"/.exec(m[0]);
      const type = /Type\s*=\s*"([^"]+)"/.exec(m[0]);
      // 只关心图片关系
      if (target && type && /\/image$/.test(type[1])) {
        // Target 可能是 "media/image1.png"（相对 word/）
        const clean = target[1].replace(/^\/?/, '');
        relMap.set(id, clean.startsWith('word/') ? clean : `word/${clean}`);
      }
    }
  }

  // 2) 按段落遍历，收集文字与图片
  const images: WordImageItem[] = [];
  const notes: string[] = [];
  let skipped = 0;
  let paraIndex = 0;
  // 最近几个非空段落的文字（按文档顺序，旧在前）。
  // 图片常常单独占一段，本身没文字 —— 要往前回溯才能找到品名。
  // 只取一个不够：品名后面往往还跟着「数量 5000」这类行，取最近一个会拿到数量。
  const recentTexts: string[] = [];

  const paraRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let pm: RegExpExecArray | null;
  while ((pm = paraRe.exec(xml))) {
    paraIndex++;
    const body = pm[1];

    // 段落文字
    let text = '';
    const tRe = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
    let tm: RegExpExecArray | null;
    while ((tm = tRe.exec(body))) text += tm[1];
    text = stripTags(text);
    if (text) {
      recentTexts.push(text);
      if (recentTexts.length > 3) recentTexts.shift(); // 只保留最近 3 段，够用又不喧宾夺主
    }

    // 段落里的图片：<a:blip r:embed="rId4"/>
    const bRe = /<a:blip\b[^>]*>/g;
    let bm: RegExpExecArray | null;
    while ((bm = bRe.exec(body))) {
      const embed = /\br:embed\s*=\s*"([^"]+)"/.exec(bm[0]);
      if (!embed) continue;
      if (images.length >= MAX_IMAGES) {
        skipped++;
        continue;
      }
      const mediaPath = relMap.get(embed[1]);
      if (!mediaPath) {
        skipped++;
        continue;
      }
      const entry = byName.get(mediaPath);
      if (!entry) {
        skipped++;
        continue;
      }
      const ext = (mediaPath.split('.').pop() || '').toLowerCase();
      const mime = MIME[ext];
      if (!mime) {
        skipped++; // EMF/WMF 浏览器显示不了
        continue;
      }
      if (entry.data.length > MAX_IMAGE_BYTES) {
        skipped++;
        continue;
      }

      // 图片替代文字：Word 里可以给图填「可选文字」
      const altM = /descr\s*=\s*"([^"]+)"/.exec(body);
      const altText = altM ? stripTags(altM[1]) : '';
      // 本段有字就带上，再拼上前面几段 —— 按文档顺序，取名字时从头挑
      const paraText = [...(text ? [text] : []), ...recentTexts.filter((t) => t !== text)];
      const joined = paraText.join(' ');

      images.push({
        id: images.length,
        para: paraIndex,
        name: mediaPath.split('/').pop() || `image${images.length + 1}`,
        dataUrl: `data:${mime};base64,${entry.data.toString('base64')}`,
        paraText,
        altText,
        suggestedName: altText || pickName(paraText),
        suggestedKind: /模|mold|模架|模芯|模仁/i.test(joined) ? 'mold' : 'part',
      });
    }
  }

  if (!images.length && !skipped) notes.push('这个 Word 里没有内嵌图片');
  if (skipped) notes.push(`有 ${skipped} 张图被跳过（超过 ${MAX_IMAGES} 张上限、单张大于 2MB，或是 EMF/WMF 矢量图）`);
  if (images.length) notes.push(`共提取 ${images.length} 张图，请确认每张图属于哪个件`);

  return { fileName, paraCount: paraIndex, images, skipped, notes };
}
