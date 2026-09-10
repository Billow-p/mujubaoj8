// 表达式求值器 — 受限 DSL，零依赖，零 eval
// 用途：参数中心用户自定义公式
//
// 支持语法：
//   - 数字字面量： 100, 0.5, 1.5e3
//   - 标识符/变量： cavityCount, materialUnitPrice, heatRunnerFee
//   - 运算符： + - * / %
//   - 一元负号： -x
//   - 括号： (a + b) * c
//   - 函数调用： max(a, b), min(a, b), round(x, n), abs(x), if(cond, a, b)
//   - 比较： a > b, a < b, a == b, a != b, a >= b, a <= b
//   - 逻辑： a && b, a || b, !a（也支持 and / or / not 关键字）
//   - 花括号变量： {cavityCount} 等价于 cavityCount
//
// 禁止：字符串、对象属性访问、赋值、声明、箭头函数、全局访问

export type Scope = Record<string, number>;

export interface EvalContext {
  // 用于变量解析时如果不在 scope 里，报错
  variablesAllowed?: string[];
}

const FUNC_IMPL: Record<string, (...args: number[]) => number> = {
  max: (...args) => Math.max(...args),
  min: (...args) => Math.min(...args),
  abs: (x) => Math.abs(x),
  round: (x, n = 0) => {
    const m = Math.pow(10, n);
    return Math.round(x * m) / m;
  },
  floor: (x) => Math.floor(x),
  ceil: (x) => Math.ceil(x),
  if: (cond, a, b) => (cond !== 0 ? a : b),
};

/** 中文别名 —— 用户自己写公式时不必记英文函数名 */
const FUNC_ALIAS: Record<string, string> = {
  最大值: 'max',
  最小值: 'min',
  绝对值: 'abs',
  四舍五入: 'round',
  取整: 'round',
  向下取整: 'floor',
  向上取整: 'ceil',
  如果: 'if',
};

const FUNC_ARG_COUNT: Record<string, number> = {
  max: -1, // 任意参数
  min: -1,
  abs: 1,
  round: -1, // 1 或 2 个
  floor: 1,
  ceil: 1,
  if: 3,
};

const FUNCS: Record<string, (...args: number[]) => number> = { ...FUNC_IMPL };
for (const [alias, target] of Object.entries(FUNC_ALIAS)) {
  FUNCS[alias] = FUNC_IMPL[target];
}

const FUNCNAMES = new Set(Object.keys(FUNCS));
const FUNCNAMES_ARG_COUNT: Record<string, number> = {};
for (const name of Object.keys(FUNCS)) {
  FUNCNAMES_ARG_COUNT[name] = FUNC_ARG_COUNT[FUNC_ALIAS[name] ?? name];
}

// ============================================================
// Tokenizer
// ============================================================
type TokenType =
  | 'num'
  | 'ident'
  | 'op'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'cmpop'
  | 'andop'
  | 'orop'
  | 'notop';
interface Token {
  type: TokenType;
  value: string | number;
  pos: number;
}

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = expr.length;
  while (i < n) {
    const c = expr[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    // 数字
    if (/[0-9.]/.test(c)) {
      const start = i;
      while (i < n && /[0-9.]/.test(expr[i])) i++;
      if (i < n && /[eE]/.test(expr[i])) {
        i++;
        if (i < n && (expr[i] === '+' || expr[i] === '-')) i++;
        while (i < n && /[0-9]/.test(expr[i])) i++;
      }
      tokens.push({ type: 'num', value: parseFloat(expr.slice(start, i)), pos: start });
      continue;
    }
    // 标识符（变量名或函数名）
    if (/[a-zA-Z_\u4e00-\u9fa5]/.test(c)) {
      const start = i;
      while (i < n && /[a-zA-Z0-9_\u4e00-\u9fa5]/.test(expr[i])) i++;
      tokens.push({ type: 'ident', value: expr.slice(start, i), pos: start });
      continue;
    }
    // 运算符
    if ('+-*/%'.includes(c)) {
      tokens.push({ type: 'op', value: c, pos: i });
      i++;
      continue;
    }
    // 逻辑与： && 或 and
    if (c === '&') {
      if (expr[i + 1] === '&') {
        tokens.push({ type: 'andop', value: '&&', pos: i });
        i += 2;
        continue;
      }
      throw new Error(`位置 ${i} 的 '&' 需要写成 '&&'`);
    }
    // 逻辑或： || 或 or
    if (c === '|') {
      if (expr[i + 1] === '|') {
        tokens.push({ type: 'orop', value: '||', pos: i });
        i += 2;
        continue;
      }
      throw new Error(`位置 ${i} 的 '|' 需要写成 '||'`);
    }
    // 逻辑非： !a（注意 != 已在上面处理）
    if (c === '!') {
      const start = i;
      let s = c;
      i++;
      if (i < n && expr[i] === '=') {
        s += '=';
        i++;
        tokens.push({ type: 'cmpop', value: s, pos: start });
      } else {
        tokens.push({ type: 'notop', value: '!', pos: start });
      }
      continue;
    }
    // 比较运算符
    if (c === '>' || c === '<' || c === '=' || c === '!') {
      const start = i;
      let s = c;
      i++;
      if (i < n && expr[i] === '=') {
        s += '=';
        i++;
      }
      tokens.push({ type: 'cmpop', value: s, pos: start });
      continue;
    }
    if (c === '(') {
      tokens.push({ type: 'lparen', value: '(', pos: i });
      i++;
      continue;
    }
    if (c === ')') {
      tokens.push({ type: 'rparen', value: ')', pos: i });
      i++;
      continue;
    }
    if (c === ',') {
      tokens.push({ type: 'comma', value: ',', pos: i });
      i++;
      continue;
    }
    throw new Error(`无法识别的字符 '${c}' (位置 ${i})：${expr}`);
  }
  return tokens;
}

// ============================================================
// Parser → 数值结果（直接求值，无中间 AST，更省内存）
// 采用 递归下降 + 优先级
//   expr   = compare
//   compare = add (( '>' | '<' | '==' | '!=' | '>=' | '<=' ) add)*
//   add    = mul (('+' | '-') mul)*
//   mul    = unary (('*' | '/' | '%') unary)*
//   unary  = '-' unary | primary
//   primary = num | ident ( '(' args ')' )? | '(' expr ')'
// ============================================================

class Parser {
  private pos = 0;
  constructor(private tokens: Token[], private scope: Scope, private allowed: Set<string>) {}

  parse(): number {
    const r = this.parseExpr();
    if (this.pos < this.tokens.length) {
      const t = this.tokens[this.pos];
      throw new Error(`表达式末尾有未消费 token '${t.value}' (位置 ${t.pos})`);
    }
    return r;
  }

  private isLogicKeyword(kw: string): boolean {
    const t = this.tokens[this.pos];
    return !!t && t.type === 'ident' && String(t.value).toLowerCase() === kw;
  }

  private parseExpr(): number {
    return this.parseLogicOr();
  }

  private parseLogicOr(): number {
    let left = this.parseLogicAnd();
    while (this.isLogicKeyword('or') || this.tokens[this.pos]?.type === 'orop') {
      this.pos++;
      const right = this.parseLogicAnd();
      left = left !== 0 || right !== 0 ? 1 : 0;
    }
    return left;
  }

  private parseLogicAnd(): number {
    let left = this.parseLogicNot();
    while (this.isLogicKeyword('and') || this.tokens[this.pos]?.type === 'andop') {
      this.pos++;
      const right = this.parseLogicNot();
      left = left !== 0 && right !== 0 ? 1 : 0;
    }
    return left;
  }

  private parseLogicNot(): number {
    if (this.tokens[this.pos]?.type === 'notop' || this.isLogicKeyword('not')) {
      this.pos++;
      const v = this.parseLogicNot();
      return v !== 0 ? 0 : 1;
    }
    return this.parseCompare();
  }

  private parseCompare(): number {
    let left = this.parseAdd();
    while (this.pos < this.tokens.length && this.tokens[this.pos].type === 'cmpop') {
      const op = this.tokens[this.pos].value as string;
      this.pos++;
      const right = this.parseAdd();
      const v =
        op === '>' ? (left > right ? 1 : 0)
          : op === '<' ? (left < right ? 1 : 0)
          : op === '==' ? (left === right ? 1 : 0)
          : op === '!=' ? (left !== right ? 1 : 0)
          : op === '>=' ? (left >= right ? 1 : 0)
          : op === '<=' ? (left <= right ? 1 : 0)
          : (() => { throw new Error(`未知比较运算符 ${op}`); })();
      left = v;
    }
    return left;
  }

  private parseAdd(): number {
    let left = this.parseMul();
    while (
      this.pos < this.tokens.length &&
      this.tokens[this.pos].type === 'op' &&
      (this.tokens[this.pos].value === '+' || this.tokens[this.pos].value === '-')
    ) {
      const op = this.tokens[this.pos].value as string;
      this.pos++;
      const right = this.parseMul();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  private parseMul(): number {
    let left = this.parseUnary();
    while (
      this.pos < this.tokens.length &&
      this.tokens[this.pos].type === 'op' &&
      (this.tokens[this.pos].value === '*' ||
        this.tokens[this.pos].value === '/' ||
        this.tokens[this.pos].value === '%')
    ) {
      const op = this.tokens[this.pos].value as string;
      this.pos++;
      const right = this.parseUnary();
      if (op === '*') left = left * right;
      else if (op === '/') {
        if (right === 0) throw new Error('除数为 0');
        left = left / right;
      } else {
        if (right === 0) throw new Error('取模为 0');
        left = left % right;
      }
    }
    return left;
  }

  private parseUnary(): number {
    if (
      this.pos < this.tokens.length &&
      this.tokens[this.pos].type === 'op' &&
      this.tokens[this.pos].value === '-'
    ) {
      this.pos++;
      return -this.parseUnary();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    const t = this.tokens[this.pos];
    if (!t) throw new Error('表达式意外结束');
    if (t.type === 'num') {
      this.pos++;
      return t.value as number;
    }
    if (t.type === 'lparen') {
      this.pos++;
      const v = this.parseExpr();
      if (this.tokens[this.pos]?.type !== 'rparen') {
        throw new Error(`位置 ${t.pos} 缺少右括号`);
      }
      this.pos++;
      return v;
    }
    if (t.type === 'ident') {
      const name = t.value as string;
      this.pos++;
      // 函数调用？
      if (this.tokens[this.pos]?.type === 'lparen') {
        this.pos++;
        const expected = FUNCNAMES_ARG_COUNT[name];
        if (expected === undefined) throw new Error(`未知函数 ${name}`);
        const args: number[] = [];
        if (this.tokens[this.pos]?.type !== 'rparen') {
          args.push(this.parseExpr());
          while (this.tokens[this.pos]?.type === 'comma') {
            this.pos++;
            args.push(this.parseExpr());
          }
        }
        if (this.tokens[this.pos]?.type !== 'rparen') {
          throw new Error(`函数 ${name} 缺少右括号`);
        }
        this.pos++;
        if (expected > 0 && args.length !== expected) {
          throw new Error(`函数 ${name} 期望 ${expected} 个参数，实际 ${args.length}`);
        }
        if (expected === -1) {
          // 变长：round 需 1-2，max/min 需 ≥2
          if (name === 'round' && (args.length < 1 || args.length > 2)) {
            throw new Error(`函数 round 期望 1 或 2 个参数，实际 ${args.length}`);
          }
          if ((name === 'max' || name === 'min') && args.length < 2) {
            throw new Error(`函数 ${name} 至少需要 2 个参数，实际 ${args.length}`);
          }
        }
        return FUNCS[name](...args);
      }
      // 变量引用
      if (!this.allowed.has(name)) {
        throw new Error(`未定义变量「${name}」`);
      }
      if (!(name in this.scope)) {
        throw new Error(`变量「${name}」未赋值`);
      }
      return this.scope[name];
    }
    throw new Error(`位置 ${t.pos} 出现意外的 token '${t.value}'`);
  }
}

// ============================================================
// 对外接口
// ============================================================
// 花括号变量 {cavityCount} → cavityCount，两种写法都支持
export function normalizeExpression(expr: string): string {
  return (expr ?? '').replace(/\{([a-zA-Z0-9_\u4e00-\u9fa5]+)\}/g, '$1');
}

export function evaluateExpression(
  expr: string,
  scope: Scope,
  allowed: Set<string>,
): number {
  const trimmed = normalizeExpression(expr).trim();
  if (!trimmed) throw new Error('表达式为空');
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) throw new Error('表达式为空');
  return new Parser(tokens, scope, allowed).parse();
}

// 自检：基础用例
if (typeof require !== 'undefined' && require.main === module) {
  const tests: [string, Scope, number][] = [
    ['1 + 2 * 3', {}, 7],
    ['(1 + 2) * 3', {}, 9],
    ['max(1, 2, 3)', {}, 3],
    ['round(3.14159, 2)', {}, 3.14],
    ['if(cavityCount > 2, 5000, 2000)', { cavityCount: 4 }, 5000],
    ['cavityCount * 800 + 5000', { cavityCount: 4 }, 8200],
    ['-5 + 10', {}, 5],
    ['10 / 3', {}, 10 / 3],
  ];
  let pass = 0, fail = 0;
  for (const [expr, scope, expected] of tests) {
    try {
      const v = evaluateExpression(expr, scope, new Set(Object.keys(scope).concat(['cavityCount', 'materialUnitPrice'])));
      const ok = Math.abs(v - expected) < 1e-9;
      console.log(`${ok ? '✓' : '✗'}  ${expr}  =  ${v}  ${ok ? '' : `（期望 ${expected}）`}`);
      if (ok) pass++; else fail++;
    } catch (e: any) {
      console.log(`✗  ${expr}  →  ${e.message}`);
      fail++;
    }
  }
  console.log(`\n${pass} 通过 / ${fail} 失败`);
}