/**
 * 识别日志 —— 单独落盘，不混进业务日志。
 *
 * 目的：客户传了个文件识别不出来，光看界面上一句「解析失败」没法排查。
 * 这里把「谁、什么时候、传了什么、走到哪一步、为什么失败」都记下来，
 * 出问题时翻日志就能定位，不用让用户复现。
 *
 * 落盘位置：logs/recognition-YYYYMMDD.log（打包成 exe 时 = exe 同级 logs/）
 * 保留策略：只按天切分，不自动清理（文件很小，一天几 KB 量级）
 */

import fs from 'fs';
import path from 'path';

export type RecogOutcome = 'ok' | 'empty' | 'unsupported' | 'failed';

export interface RecogLogEntry {
  /** 认出来的文件类型 */
  kind: 'excel' | 'word' | '3d' | 'image' | 'unknown';
  fileName: string;
  fileSize: number;
  outcome: RecogOutcome;
  /** 提取到几张图 / 几个件 */
  extracted?: number;
  /** 失败原因（给用户看的简短说明，或内部错误） */
  reason?: string;
  /** 内部错误堆栈，只进日志不进界面 */
  detail?: string;
  /** 走的哪个步骤失败的 */
  step?: string;
}

function logDir(): string {
  const base = (process as any).pkg ? path.dirname(process.execPath) : process.cwd();
  const dir = path.join(base, 'logs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 一天一个文件，名字里带日期便于归档 */
function logFile(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return path.join(logDir(), `recognition-${ymd}.log`);
}

/** 手机号/邮箱脱敏，日志里不留完整账号 */
function maskUser(u: string | undefined): string {
  if (!u) return '-';
  if (/^\d{6,}$/.test(u)) return u.slice(0, 3) + '****' + u.slice(-2);
  const at = u.indexOf('@');
  if (at > 0) return u.slice(0, 2) + '***' + u.slice(at);
  return u.slice(0, 2) + '***';
}

export function writeRecogLog(entry: RecogLogEntry, userId?: string) {
  const line = {
    ts: new Date().toISOString(),
    user: maskUser(userId),
    kind: entry.kind,
    file: entry.fileName,
    size: entry.fileSize,
    outcome: entry.outcome,
    extracted: entry.extracted ?? 0,
    step: entry.step ?? '-',
    reason: entry.reason ?? '',
    detail: entry.detail ?? '',
  };
  const text = JSON.stringify(line) + '\n';
  try {
    fs.appendFileSync(logFile(), text, 'utf8');
  } catch {
    // 日志写不进去绝不能影响业务，静默吞掉
  }
  // 关键事件同时进标准输出，方便 journalctl / docker logs 直接看
  if (entry.outcome !== 'ok') {
    console.warn(`[recog] ${entry.outcome} ${entry.kind} ${entry.fileName} — ${entry.reason || entry.detail || ''}`);
  }
}
