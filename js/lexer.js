/* Токенизатор C++.
   Комментарии и препроцессор пропускаются, строковые литералы
   остаются одним токеном, чтобы ';' и ',' внутри них не ломали разбор. */
(function (global) {
  'use strict';

  const MULTI_OPS = [
    '>>=', '<<=', '->*', '...', '::', '->', '<<', '>>', '<=', '>=',
    '==', '!=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '%=',
    '&=', '|=', '^=', '.*'
  ];

  function tokenizeCpp(src) {
    const toks = [];
    const n = src.length;
    let i = 0;
    let line = 1;

    const isIdStart = (ch) => /[A-Za-z_$]/.test(ch) || ch.charCodeAt(0) > 127;
    const isIdPart = (ch) => /[A-Za-z0-9_$]/.test(ch) || ch.charCodeAt(0) > 127;

    function push(t, v, start, end, ln) {
      toks.push({ t: t, v: v, start: start, end: end, line: ln });
    }

    while (i < n) {
      const ch = src[i];

      if (ch === '\n') { line++; i++; continue; }
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f' || ch === '\v') { i++; continue; }

      // комментарии
      if (ch === '/' && src[i + 1] === '/') {
        while (i < n && src[i] !== '\n') i++;
        continue;
      }
      if (ch === '/' && src[i + 1] === '*') {
        i += 2;
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
          if (src[i] === '\n') line++;
          i++;
        }
        i += 2;
        continue;
      }

      // препроцессор (с переносами через обратный слэш)
      if (ch === '#') {
        while (i < n && src[i] !== '\n') {
          if (src[i] === '\\' && src[i + 1] === '\n') { i += 2; line++; }
          else i++;
        }
        continue;
      }

      const start = i;
      const startLine = line;

      // сырые строки R"delim(...)delim"
      const rawMatch = /^(u8R|uR|UR|LR|R)"/.exec(src.slice(i, i + 5));
      if (rawMatch) {
        i += rawMatch[0].length;
        let delim = '';
        while (i < n && src[i] !== '(') { delim += src[i]; i++; }
        i++;
        const endSeq = ')' + delim + '"';
        let close = src.indexOf(endSeq, i);
        if (close < 0) close = n;
        for (let k = i; k < close; k++) if (src[k] === '\n') line++;
        const endPos = Math.min(n, close + endSeq.length);
        push('str', src.slice(start, endPos), start, endPos, startLine);
        i = endPos;
        continue;
      }

      // обычные и префиксные строки/символы
      if (/^(u8|u|U|L)?["']/.test(src.slice(i, i + 3))) {
        let j = i;
        if (src[j] !== '"' && src[j] !== "'") {
          j += (src[j + 1] === '8') ? 2 : 1;
        }
        const quote = src[j];
        let k = j + 1;
        while (k < n) {
          if (src[k] === '\\') { k += 2; continue; }
          if (src[k] === quote) { k++; break; }
          if (src[k] === '\n') line++;
          k++;
        }
        push('str', src.slice(i, k), start, k, startLine);
        i = k;
        continue;
      }

      // числа
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        const m = /^(0[xX][0-9a-fA-F']+|0[bB][01']+|\d[\d']*\.?[\d']*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)([uUlLfF]*)/.exec(src.slice(i));
        if (m) {
          const end = i + m[0].length;
          push('num', m[0], start, end, startLine);
          i = end;
          continue;
        }
      }

      // идентификаторы
      if (isIdStart(ch)) {
        let j = i + 1;
        while (j < n && isIdPart(src[j])) j++;
        push('id', src.slice(i, j), start, j, startLine);
        i = j;
        continue;
      }

      // операторы и пунктуация
      let matched = null;
      for (const op of MULTI_OPS) {
        if (src.startsWith(op, i)) { matched = op; break; }
      }
      if (matched) {
        push('op', matched, start, start + matched.length, startLine);
        i += matched.length;
        continue;
      }

      push('op', ch, start, start + 1, startLine);
      i++;
    }

    return toks;
  }

  global.tokenizeCpp = tokenizeCpp;
})(window);
