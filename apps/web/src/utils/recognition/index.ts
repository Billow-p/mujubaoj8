/**
 * 统一识别入口的类型与兜底判断。
 *
 * 核心原则：**任何情况都要有回复**。
 * 用户传个文件进来，不管成功失败、不管什么格式，都要告诉他发生了什么、该怎么办。
 * 绝不允许出现「点了没反应」或者一句干巴巴的「解析失败」。
 */

export type FileKind =
  | 'model3d' // 我们能真解析的：STEP/IGES/BREP/STL/OBJ/PLY/3MF
  | 'vendor3d' // 专有 3D 格式：SLDPRT/PRT/IPT/CATPart... 读不了，引导转 STEP
  | 'excel'
  | 'word'
  | 'image' // 截图 / 照片 / 手写件（不做 OCR，人眼看）
  | 'pdf'
  | 'archive' // zip/rar/7z
  | 'dwg' // 2D CAD 图纸
  | 'unknown';

export interface RecogError {
  /** 用于日志归类的短码 */
  code: string;
  /** 人话：到底为什么没成 */
  message: string;
  /** 人话：具体怎么改（要说清点哪个菜单，别只说「转换格式」） */
  suggestion: string;
}

/** 能真解析的 3D 格式 */
export const MODEL3D_EXT = ['step', 'stp', 'iges', 'igs', 'brep', 'stl', 'obj', 'ply', '3mf'];
/** 专有 3D 格式：没公开规范，读不出几何 */
export const VENDOR3D_EXT = [
  'sldprt', 'sldasm', 'prt', 'asm', 'ipt', 'iam',
  'catpart', 'catproduct', 'x_t', 'x_b', 'sat', '3dxml', 'jt', 'skp',
];
export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'];
/** 苹果照片格式，浏览器显示不了 —— 单独的坑，要专门提示 */
export const HEIC_EXT = ['heic', 'heif'];
export const ARCHIVE_EXT = ['zip', 'rar', '7z', 'tar', 'gz'];
export const DWG_EXT = ['dwg', 'dxf'];
/** 老版 Office，读不出图片 */
export const LEGACY_OFFICE_EXT = ['doc', 'xls', 'ppt'];

export function extOf(name: string): string {
  const clean = name.split(/[?#]/)[0].toLowerCase();
  const i = clean.lastIndexOf('.');
  return i < 0 ? '' : clean.slice(i + 1);
}

/** 判断一个文件属于哪一类 */
export function classifyFile(name: string): { kind: FileKind; ext: string } {
  const ext = extOf(name);
  if (MODEL3D_EXT.includes(ext)) return { kind: 'model3d', ext };
  if (VENDOR3D_EXT.includes(ext)) return { kind: 'vendor3d', ext };
  if (ext === 'xlsx' || ext === 'xlsm') return { kind: 'excel', ext };
  if (ext === 'docx') return { kind: 'word', ext };
  if (IMAGE_EXT.includes(ext)) return { kind: 'image', ext };
  if (HEIC_EXT.includes(ext)) return { kind: 'image', ext }; // 归类为图，但会提示转码
  if (ext === 'pdf') return { kind: 'pdf', ext };
  if (ARCHIVE_EXT.includes(ext)) return { kind: 'archive', ext };
  if (DWG_EXT.includes(ext)) return { kind: 'dwg', ext };
  return { kind: 'unknown', ext };
}

/** 单个文件上限 30MB（与后端一致） */
export const MAX_FILE_BYTES = 30 * 1024 * 1024;

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 兜底矩阵：把「识别不出来」翻译成人话 + 可执行建议。
 * 顺序很重要 —— 先查最常见、最具体的坑。
 */
export function diagnose(file: { name: string; size: number }): RecogError | null {
  const { name, size } = file;
  const { kind, ext } = classifyFile(name);

  // 1) 空文件
  if (size === 0) {
    return {
      code: 'EMPTY_FILE',
      message: `「${name}」是空文件（0 字节）`,
      suggestion: '这个文件可能没保存好或传输中断了，请重新导出一份再上传',
    };
  }
  // 2) 太大
  if (size > MAX_FILE_BYTES) {
    return {
      code: 'TOO_LARGE',
      message: `「${name}」有 ${humanSize(size)}，超过 30MB 上限`,
      suggestion: '把文件里的图片压缩一下，或者拆成几个小文件分别上传',
    };
  }
  // 3) 苹果照片 HEIC —— 最常见的「明明是图片却传不了」
  if (HEIC_EXT.includes(ext)) {
    return {
      code: 'HEIC_UNSUPPORTED',
      message: `「${name}」是苹果手机的照片格式（HEIC），浏览器显示不了`,
      suggestion:
        'iPhone 上：设置 → 相机 → 格式 → 选「兼容性最佳」，以后拍的就是 JPG；' +
        '这一张可以在「照片」里分享时选「自动转换为 JPEG」，或用微信发给自己再保存',
    };
  }
  // 4) 专有 3D 格式
  if (kind === 'vendor3d') {
    const vendor = VENDOR_NAME[ext] || '该软件';
    return {
      code: 'VENDOR_3D',
      message: `「${name}」是 ${vendor} 的专有格式，读不出几何数据`,
      suggestion: `在 ${vendor} 里打开 →「文件 → 另存为 / 导出」→ 格式选 **STEP(.step 或 .stp)**（优先）或 STL → 再上传。这样才能算出准确的体积和重量`,
    };
  }
  // 5) 老版 Office
  if (LEGACY_OFFICE_EXT.includes(ext)) {
    const app = ext === 'doc' ? 'Word' : ext === 'xls' ? 'Excel' : 'PowerPoint';
    const target = ext === 'doc' ? 'Word 文档 (*.docx)' : ext === 'xls' ? 'Excel 工作簿 (*.xlsx)' : 'PowerPoint 演示文稿 (*.pptx)';
    return {
      code: 'LEGACY_OFFICE',
      message: `「${name}」是老版 ${app} 格式，里面的图片读不出来`,
      suggestion: `用 ${app} 打开 →「文件 → 另存为」→ 格式选「${target}」→ 重新上传`,
    };
  }
  // 6) PDF
  if (kind === 'pdf') {
    return {
      code: 'PDF_UNSUPPORTED',
      message: `「${name}」是 PDF，暂不支持自动提取`,
      suggestion:
        '如果是产品图，直接截图或另存为图片再传；如果是参数表，请提供原始的 Excel/Word；' +
        '也可以把每一页单独截图后，作为「图片」批量上传',
    };
  }
  // 7) 压缩包
  if (kind === 'archive') {
    return {
      code: 'ARCHIVE_UNSUPPORTED',
      message: `「${name}」是压缩包，无法直接识别里面的内容`,
      suggestion: '请先解压，然后把里面的 3D 文件、Excel、Word 或图片分别上传（支持一次选多个）',
    };
  }
  // 8) 2D CAD 图纸
  if (kind === 'dwg') {
    return {
      code: 'DWG_UNSUPPORTED',
      message: `「${name}」是 2D 工程图纸，只能看尺寸标注，算不了体积和重量`,
      suggestion:
        '要自动算体积/重量，需要提供 3D 数模（STEP 优先，或 STL）；' +
        '只有 2D 图纸也没关系 —— 可以直接传图纸截图当件图，参数按图纸手工填写',
    };
  }
  // 9) 完全不认识
  if (kind === 'unknown') {
    return {
      code: 'UNKNOWN_EXT',
      message: ext ? `不认识 .${ext} 这种文件` : `「${name}」没有文件后缀，判断不出类型`,
      suggestion:
        '目前支持：3D（STEP / IGES / STL / OBJ / PLY / 3MF）、Excel(.xlsx)、Word(.docx)、图片（PNG / JPG / WEBP）；' +
        '其他格式请先转成上面这些',
    };
  }
  return null;
}

const VENDOR_NAME: Record<string, string> = {
  sldprt: 'SolidWorks',
  sldasm: 'SolidWorks',
  prt: 'Pro/E 或 Creo',
  asm: 'Pro/E 或 Creo',
  ipt: 'Inventor',
  iam: 'Inventor',
  catpart: 'CATIA',
  catproduct: 'CATIA',
  x_t: 'Parasolid',
  x_b: 'Parasolid',
  sat: 'ACIS',
  '3dxml': 'CATIA',
  jt: 'Siemens NX',
  skp: 'SketchUp',
};

// ------------------------------------------------------------------ 日志

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: string;
  level: LogLevel;
  /** 走的哪一步 */
  step: string;
  detail: string;
}

/**
 * 前端识别日志。
 * 界面上可以展开看「这次识别到底发生了什么」，同时关键事件上报到后端落盘。
 */
export class RecogLogger {
  entries: LogEntry[] = [];
  private onChange?: (e: LogEntry[]) => void;

  constructor(onChange?: (e: LogEntry[]) => void) {
    this.onChange = onChange;
  }

  private push(level: LogLevel, step: string, detail: string) {
    const e = { ts: new Date().toLocaleTimeString('zh-CN', { hour12: false }), level, step, detail };
    this.entries.push(e);
    this.onChange?.([...this.entries]);
    if (level !== 'info') console.warn(`[识别] ${step}: ${detail}`);
  }
  info(step: string, detail: string) {
    this.push('info', step, detail);
  }
  warn(step: string, detail: string) {
    this.push('warn', step, detail);
  }
  error(step: string, detail: string) {
    this.push('error', step, detail);
  }
  clear() {
    this.entries = [];
    this.onChange?.([]);
  }
}
