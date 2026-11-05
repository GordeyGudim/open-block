/* Разбор C++ в дерево операторов для построения блок-схемы.
   Поддержка: функции и методы (в т.ч. вне класса), if/else, for (включая
   range-for), while, do-while, switch/case, try/catch, return, break,
   continue, goto, лямбды внутри выражений (как текст). */
(function (global) {
  'use strict';

  function findMatch(T, openIdx) {
    const open = T[openIdx] && T[openIdx].v;
    if (open !== '(' && open !== '[' && open !== '{') return -1;
    const close = open === '(' ? ')' : open === '[' ? ']' : '}';
    let depth = 0;
    for (let i = openIdx; i < T.length; i++) {
      if (T[i].v === open) depth++;
      else if (T[i].v === close) {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  function findMatchBack(T, closeIdx) {
    const close = T[closeIdx] && T[closeIdx].v;
    if (close !== ')' && close !== ']') return -1;
    const open = close === ')' ? '(' : '[';
    let depth = 0;
    for (let i = closeIdx; i >= 0; i--) {
      if (T[i].v === close) depth++;
      else if (T[i].v === open) {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  function findAngleBack(T, closeIdx) {
    let depth = 0;
    for (let i = closeIdx; i >= 0; i--) {
      const v = T[i].v;
      if (v === '>') depth++;
      else if (v === '>>') depth += 2;
      else if (v === '<') {
        depth--;
        if (depth <= 0) return i;
      }
    }
    return -1;
  }

  function emptyBlock() { return { type: 'block', body: [] }; }

  function classifyExpression(text) {
    const t = text.trim();
    if (!t) return null;

    const ioIn =
      /(^|[^\w:])(std\s*::\s*)?cin\s*>>/.test(t) ||
      /(^|[^\w:])(std\s*::\s*)?cin\s*\.\s*(get|read|getline)/.test(t) ||
      /(^|[^\w])(scanf|fscanf|sscanf|getline|gets|fgets|getchar)\s*\(/.test(t);

    const ioOut =
      /(^|[^\w:])(std\s*::\s*)?(cout|cerr|clog)\s*<</.test(t) ||
      /(^|[^\w])(printf|fprintf|sprintf|snprintf|puts|putchar|putch)\s*\(/.test(t);

    if (ioIn) return { type: 'io', text: t, io: 'in' };
    if (ioOut) return { type: 'io', text: t, io: 'out' };

    const call =
      /^[A-Za-z_~][\w:~]*(?:\s*::\s*[A-Za-z_~][\w]*)*(?:\s*(?:\.|->)\s*[A-Za-z_~][\w]*)*\s*(?:<[^()]*>)?\s*\([\s\S]*\)$/.test(t);
    if (call) return { type: 'call', text: t };

    return { type: 'process', text: t };
  }

  class StatementParser {
    constructor(parser, start, end) {
      this.p = parser;
      this.T = parser.toks;
      this.i = start;
      this.end = end;
    }

    parseList() {
      const out = [];
      let guard = 0;
      while (this.i < this.end && guard++ < 200000) {
        if (this.T[this.i].v === '}') break;
        if (this.T[this.i].v === ';') { this.i++; continue; }
        const before = this.i;
        let st = null;
        try { st = this.parseStatement(); } catch (e) { st = null; }
        if (st) out.push(st);
        if (this.i === before) this.i++;
      }
      return out;
    }

    parseStatement() {
      const T = this.T;
      if (this.i >= this.end) return null;
      const v = T[this.i].v;

      if (v === '{') return this.parseBlock();
      if (v === 'if') return this.parseIf();
      if (v === 'for') return this.parseFor();
      if (v === 'while') return this.parseWhile();
      if (v === 'do') return this.parseDo();
      if (v === 'switch') return this.parseSwitch();
      if (v === 'try') return this.parseTry();

      if (v === 'return') {
        const t = this.collectSemi();
        return { type: 'return', text: t || 'return', terminates: true };
      }
      if (v === 'break' || v === 'continue') {
        this.i++;
        if (T[this.i] && T[this.i].v === ';') this.i++;
        return { type: 'process', text: v, terminates: true };
      }
      if (v === 'goto') {
        const t = this.collectSemi();
        return { type: 'process', text: t };
      }
      if (v === 'throw') {
        const t = this.collectSemi();
        return { type: 'process', text: t, terminates: true };
      }
      if (v === 'else' || v === 'case' || v === 'default') { this.i++; return null; }
      if (v === 'using' || v === 'typedef' || v === 'static_assert' ||
          v === 'namespace' || v === 'friend') {
        this.collectSemi();
        return null;
      }

      const t = this.collectSemi();
      if (!t) return null;
      return classifyExpression(t);
    }

    parseBlock() {
      const close = findMatch(this.T, this.i);
      if (close < 0 || close > this.end) {
        this.i++;
        return emptyBlock();
      }
      const sub = new StatementParser(this.p, this.i + 1, close);
      const body = sub.parseList();
      this.i = close + 1;
      return { type: 'block', body: body };
    }

    readParen() {
      const T = this.T;
      if (!T[this.i] || T[this.i].v !== '(') return '';
      const close = findMatch(T, this.i);
      if (close < 0) { this.i++; return ''; }
      const text = this.p.text(this.i + 1, close);
      this.i = close + 1;
      return text;
    }

    parseIf() {
      const T = this.T;
      this.i++;
      if (T[this.i] && (T[this.i].v === 'constexpr' || T[this.i].v === 'consteval')) this.i++;
      const cond = this.readParen();
      const thenSt = this.parseStatement() || emptyBlock();
      let elseSt = null;
      if (T[this.i] && T[this.i].v === 'else') {
        this.i++;
        elseSt = this.parseStatement() || emptyBlock();
      }
      return { type: 'if', cond: cond, then: thenSt, else: elseSt };
    }

    parseWhile() {
      this.i++;
      const cond = this.readParen();
      const body = this.parseStatement() || emptyBlock();
      return { type: 'while', cond: cond, body: body };
    }

    parseDo() {
      this.i++;
      const body = this.parseStatement() || emptyBlock();
      let cond = '';
      if (this.T[this.i] && this.T[this.i].v === 'while') {
        this.i++;
        cond = this.readParen();
        if (this.T[this.i] && this.T[this.i].v === ';') this.i++;
      }
      return { type: 'dowhile', cond: cond, body: body };
    }

    splitFor(start, end) {
      const T = this.T;
      const segs = [];
      let segStart = start;
      let depth = 0;
      let colon = -1;
      for (let i = start; i < end; i++) {
        const v = T[i].v;
        if (v === '(' || v === '[' || v === '{') depth++;
        else if (v === ')' || v === ']' || v === '}') depth--;
        else if (v === ';' && depth === 0) {
          segs.push([segStart, i]);
          segStart = i + 1;
        } else if (v === ':' && depth === 0 && colon < 0) {
          colon = i;
        }
      }
      segs.push([segStart, end]);
      return { segs: segs, colon: colon };
    }

    parseFor() {
      const T = this.T;
      this.i++;
      if (!T[this.i] || T[this.i].v !== '(') return null;
      const headerStart = this.i + 1;
      const close = findMatch(T, this.i);
      if (close < 0) return null;
      const info = this.splitFor(headerStart, close);
      this.i = close + 1;

      let init = '', cond = '', step = '', range = false;
      if (info.colon >= 0 && info.segs.length === 1) {
        range = true;
        cond = this.p.text(headerStart, info.colon) + ' : ' +
               this.p.text(info.colon + 1, close);
      } else {
        const s = info.segs;
        init = s[0] ? this.p.text(s[0][0], s[0][1]) : '';
        cond = s[1] ? this.p.text(s[1][0], s[1][1]) : '';
        step = s[2] ? this.p.text(s[2][0], s[2][1]) : '';
      }
      const body = this.parseStatement() || emptyBlock();
      return { type: 'for', init: init, cond: cond, step: step, range: range, body: body };
    }

    parseSwitch() {
      const T = this.T;
      this.i++;
      const expr = this.readParen();
      if (!T[this.i] || T[this.i].v !== '{') {
        const st = this.parseStatement();
        return {
          type: 'switch', expr: expr,
          cases: [{ label: 'default', body: st ? [st] : [] }]
        };
      }
      const close = findMatch(T, this.i);
      if (close < 0) { this.i++; return { type: 'switch', expr: expr, cases: [] }; }
      const cases = this.parseSwitchCases(this.i + 1, close);
      this.i = close + 1;
      return { type: 'switch', expr: expr, cases: cases };
    }

    parseSwitchCases(start, end) {
      const T = this.T;
      const cases = [];
      let i = start;
      let guard = 0;
      while (i < end && guard++ < 20000) {
        if (T[i].v === 'case') {
          const colon = this.findColon(i + 1, end);
          if (colon < 0) break;
          const label = this.p.text(i + 1, colon);
          const bodyEnd = this.findCaseBoundary(colon + 1, end);
          const sub = new StatementParser(this.p, colon + 1, bodyEnd);
          cases.push({ label: label, body: sub.parseList() });
          i = bodyEnd;
        } else if (T[i].v === 'default') {
          let colon = i + 1;
          while (colon < end && T[colon].v !== ':') colon++;
          if (colon >= end) break;
          const bodyEnd = this.findCaseBoundary(colon + 1, end);
          const sub = new StatementParser(this.p, colon + 1, bodyEnd);
          cases.push({ label: 'default', body: sub.parseList(), isDefault: true });
          i = bodyEnd;
        } else {
          i++;
        }
      }
      return cases;
    }

    findColon(start, end) {
      const T = this.T;
      let depth = 0;
      for (let i = start; i < end; i++) {
        const v = T[i].v;
        if (v === '(' || v === '[' || v === '{') depth++;
        else if (v === ')' || v === ']' || v === '}') depth--;
        else if (v === ':' && depth === 0) return i;
      }
      return -1;
    }

    findCaseBoundary(start, end) {
      const T = this.T;
      let depth = 0;
      for (let i = start; i < end; i++) {
        const v = T[i].v;
        if (v === '{' || v === '(' || v === '[') depth++;
        else if (v === '}' || v === ')' || v === ']') depth--;
        else if (depth === 0 && (v === 'case' || v === 'default')) return i;
      }
      return end;
    }

    parseTry() {
      const T = this.T;
      this.i++;
      const body = this.parseStatement() || emptyBlock();
      const catches = [];
      while (T[this.i] && T[this.i].v === 'catch') {
        this.i++;
        let param = '';
        if (T[this.i] && T[this.i].v === '(') param = this.readParen();
        const cb = this.parseStatement() || emptyBlock();
        catches.push({ param: param, body: cb });
      }
      return { type: 'try', body: body, catches: catches };
    }

    collectSemi() {
      const T = this.T;
      const start = this.i;
      let depth = 0;
      while (this.i < this.end) {
        const v = T[this.i].v;
        if (v === '(' || v === '[' || v === '{') { depth++; this.i++; continue; }
        if (v === ')' || v === ']' || v === '}') {
          if (depth === 0 && v === '}') break;
          depth--;
          this.i++;
          continue;
        }
        if (v === ';' && depth === 0) {
          const text = this.p.text(start, this.i);
          this.i++;
          return text;
        }
        this.i++;
      }
      return this.p.text(start, this.i);
    }
  }

  class CppParser {
    constructor(src) {
      this.src = src;
      this.toks = global.tokenizeCpp(src);
      this.T = this.toks;
    }

    text(a, b) {
      if (a >= b) return '';
      const first = this.toks[a];
      const last = this.toks[b - 1];
      if (!first || !last) return '';
      return this.src.slice(first.start, last.end).replace(/\s+/g, ' ').trim();
    }

    parse() {
      const funcs = [];
      this.scanTop(0, this.toks.length, funcs, '');
      return funcs;
    }

    skipToSemi(i, end) {
      const T = this.toks;
      let depth = 0;
      for (; i < end; i++) {
        const v = T[i].v;
        if (v === '(' || v === '[' || v === '{') depth++;
        else if (v === ')' || v === ']' || v === '}') depth--;
        else if (v === ';' && depth <= 0) return i + 1;
      }
      return end;
    }

    skipAngle(i) {
      const T = this.toks;
      let depth = 0;
      for (let k = i; k < this.toks.length; k++) {
        const v = T[k].v;
        if (v === '<') depth++;
        else if (v === '>') depth--;
        else if (v === '>>') depth -= 2;
        else if (v === ';' || v === '{') return k;
        if (depth <= 0) return k + 1;
      }
      return this.toks.length;
    }

    scanTop(start, end, funcs, prefix) {
      const T = this.toks;
      let i = start;
      let guard = 0;
      while (i < end && guard++ < 200000) {
        const v = T[i].v;
        if (v === ';' || v === '}') { i++; continue; }

        if (v === 'template') {
          i++;
          if (T[i] && T[i].v === '<') i = this.skipAngle(i);
          continue;
        }
        if (v === 'namespace') {
          let j = i + 1;
          while (j < end && T[j].v !== '{' && T[j].v !== ';' && T[j].v !== '}') j++;
          if (j < end && T[j].v === '{') {
            const close = findMatch(T, j);
            if (close > j) this.scanTop(j + 1, close, funcs, prefix);
            i = close > j ? close + 1 : j + 1;
          } else {
            i = j + 1;
          }
          continue;
        }
        if (v === 'class' || v === 'struct' || v === 'union') {
          i = this.parseClass(i, end, funcs, prefix);
          continue;
        }
        if (v === 'enum') { i = this.skipToSemi(i, end); continue; }
        if (v === 'using' || v === 'typedef' || v === 'static_assert') {
          i = this.skipToSemi(i, end);
          continue;
        }
        if (v === 'extern' && T[i + 1] && T[i + 1].t === 'str') { i += 2; continue; }

        const r = this.tryFunction(i, end, prefix);
        if (r) {
          funcs.push(r.func);
          i = r.next;
        } else {
          i++;
        }
      }
    }

    classNameAt(i) {
      const T = this.toks;
      let j = i + 1;
      if (T[j] && T[j].v === '[') {
        const c = findMatch(T, j);
        if (c > j) j = c + 1;
      }
      if (T[j] && T[j].t === 'id') return T[j].v;
      return '';
    }

    parseClass(i, end, funcs, prefix) {
      const T = this.toks;
      let j = i;
      let depth = 0;
      while (j < end) {
        const v = T[j].v;
        if (v === '(' || v === '[') depth++;
        else if (v === ')' || v === ']') depth--;
        else if (v === '{' && depth === 0) break;
        else if (v === ';' && depth === 0) return j + 1;
        j++;
      }
      if (j >= end || T[j].v !== '{') return j + 1;
      const close = findMatch(T, j);
      if (close < 0) return end;
      const cls = this.classNameAt(i);
      const fullName = prefix && cls ? prefix + '::' + cls : cls;
      if (cls) this.scanClassMembers(j + 1, close, funcs, fullName);
      return close + 1;
    }

    scanClassMembers(start, end, funcs, cls) {
      const T = this.toks;
      const access = ['public', 'private', 'protected', 'signals', 'slots'];
      let i = start;
      let guard = 0;
      while (i < end && guard++ < 200000) {
        const v = T[i].v;
        if (v === ';' || v === '}') { i++; continue; }
        if (v === 'template') {
          i++;
          if (T[i] && T[i].v === '<') i = this.skipAngle(i);
          continue;
        }
        if (v === 'class' || v === 'struct' || v === 'union') {
          i = this.parseClass(i, end, funcs, cls);
          continue;
        }
        if (v === 'enum') { i = this.skipToSemi(i, end); continue; }
        if (v === 'using' || v === 'typedef' || v === 'friend' || v === 'static_assert') {
          i = this.skipToSemi(i, end);
          continue;
        }
        if (access.indexOf(v) >= 0 && T[i + 1] && T[i + 1].v === ':') { i += 2; continue; }

        const r = this.tryFunction(i, end, cls);
        if (r) {
          funcs.push(r.func);
          i = r.next;
        } else {
          i++;
        }
      }
    }

    functionName(parenIdx, prefix) {
      const T = this.toks;
      let j = parenIdx;
      const previous = T[j - 1];
      if (!previous) return '?';

      const finish = (name, k) => {
        if (prefix && name.indexOf('::') < 0 && name.charAt(0) !== '~') {
          name = prefix + '::' + name;
        } else if (prefix && name.charAt(0) === '~' && name.indexOf('::') < 0) {
          name = prefix + '::' + name;
        }
        return name;
      };

      // operator() и operator[]
      if (previous.v === ')' && T[j - 2] && T[j - 2].v === '(' &&
          T[j - 3] && T[j - 3].v === 'operator') {
        return finish('operator()', j - 3);
      }
      if (previous.v === ']' && T[j - 2] && T[j - 2].v === '[' &&
          T[j - 3] && T[j - 3].v === 'operator') {
        return finish('operator[]', j - 3);
      }
      // operator<<, operator+, operator=
      if (T[j - 2] && T[j - 2].v === 'operator' && previous.v !== '(') {
        return finish('operator ' + previous.v, j - 2);
      }

      let k = j - 1;
      let name = T[k].v;
      k--;
      if (T[k] && T[k].v === '~') { name = '~' + name; k--; }
      while (k >= 1 && T[k].v === '::') {
        let seg = '';
        let segEnd = k - 1;
        if (T[segEnd] && T[segEnd].v === '>') {
          const open = findAngleBack(T, segEnd);
          if (open > 0 && T[open - 1] && T[open - 1].t === 'id') {
            seg = this.text(open - 1, segEnd + 1);
            k = open - 2;
            name = seg + '::' + name;
            continue;
          }
          break;
        }
        if (!T[segEnd] || (T[segEnd].t !== 'id' && T[segEnd].v !== '~')) break;
        seg = T[segEnd].v;
        k = segEnd - 1;
        if (T[k] && T[k].v === '~') { seg = '~' + seg; k--; }
        name = seg + '::' + name;
      }
      return finish(name, k + 1);
    }

    tryFunction(start, end, prefix) {
      const T = this.toks;
      let j = start;
      let guard = 0;
      while (j < end && guard++ < 50000) {
        const v = T[j].v;
        if (v === ';' || v === '}' || v === '{') return null;
        if (v === '(') break;
        j++;
      }
      if (j >= end) return null;

      // имя оператора перед скобками параметров
      if (T[j - 1] && T[j - 1].v === 'operator') {
        const o = findMatch(T, j);
        if (o < 0 || o >= end) return null;
        j = o + 1;
        while (j < end && T[j].v !== '(') {
          if (T[j].v === ';' || T[j].v === '{' || T[j].v === '}') return null;
          j++;
        }
        if (j >= end) return null;
      }

      const pOpen = j;
      const pClose = findMatch(T, pOpen);
      if (pClose < 0 || pClose >= end) return null;

      let k = pClose + 1;
      let trailing = 0;
      let initList = '';
      while (k < end && trailing++ < 500) {
        const v = T[k].v;
        if (v === '{') break;
        if (v === ';' || v === '=' || v === ',') return null;

        if (v === ':') {
          const initStart = k + 1;
          k++;
          let depth = 0;
          while (k < end) {
            const w = T[k].v;
            if (w === '(' || w === '[') depth++;
            else if (w === ')' || w === ']') depth--;
            else if (w === '{') { if (depth === 0) break; }
            else if ((w === ';' || w === '}') && depth === 0) return null;
            k++;
          }
          initList = this.text(initStart, k);
          continue;
        }
        if (v === 'noexcept' || v === 'throw') {
          k++;
          if (T[k] && T[k].v === '(') {
            const c = findMatch(T, k);
            if (c < 0) return null;
            k = c + 1;
          }
          continue;
        }
        if (v === '->') {
          k++;
          while (k < end && T[k].v !== '{' && T[k].v !== ';') k++;
          continue;
        }
        if (v === 'requires') {
          k++;
          let depth = 0;
          while (k < end) {
            const w = T[k].v;
            if (w === '(' || w === '[') depth++;
            else if (w === ')' || w === ']') depth--;
            else if ((w === '{' || w === ';') && depth === 0) break;
            k++;
          }
          continue;
        }
        if (v === 'const' || v === 'volatile' || v === 'override' || v === 'final' ||
            v === 'mutable' || v === 'constexpr' || v === 'consteval' ||
            v === 'constinit' || v === '&' || v === '&&') {
          k++;
          continue;
        }
        if (v === '[' && T[k + 1] && T[k + 1].v === '[') {
          const c = findMatch(T, k);
          if (c < 0) return null;
          k = c + 1;
          continue;
        }
        break;
      }

      if (k >= end || T[k].v !== '{') return null;
      const close = findMatch(T, k);
      if (close < 0 || close > end) return null;

      const name = this.functionName(pOpen, prefix);
      const params = this.text(pOpen + 1, pClose);
      const sp = new StatementParser(this, k + 1, close);
      const body = sp.parseList();
      return {
        func: {
          name: name, params: params, body: body, initList: initList,
          line: T[pOpen - 1] ? T[pOpen - 1].line : 1
        },
        next: close + 1
      };
    }
  }

  global.CppParser = {
    parse: function (src) { return new CppParser(src).parse(); },
    tokenize: function (src) { return global.tokenizeCpp(src); }
  };
})(window);
