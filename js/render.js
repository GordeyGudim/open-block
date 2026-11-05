/* Фигуры ГОСТ 19.701-90 и низкоуровневая отрисовка SVG. */
(function (global) {
  'use strict';

  const FONT_FAMILY = "Arial, 'Liberation Sans', 'Segoe UI', sans-serif";
  const FONT = '12.5px ' + FONT_FAMILY;
  const TITLE_FONT = "600 15px " + FONT_FAMILY;
  const LABEL_FONT = "11.5px " + FONT_FAMILY;

  const LINE_COLOR = '#1e293b';
  const TEXT_COLOR = '#0f172a';
  const MUTED = '#64748b';
  const ACCENT = '#4f46e5';
  const ACCENT_LIGHT = '#eef2ff';

  let canvasCtx = null;
  function getCtx() {
    if (!canvasCtx) {
      const c = document.createElement('canvas');
      c.width = 8;
      c.height = 8;
      canvasCtx = c.getContext('2d');
    }
    return canvasCtx;
  }

  function measureText(text, font) {
    const ctx = getCtx();
    ctx.font = font || FONT;
    return ctx.measureText(String(text)).width;
  }

  function escapeXml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function hardBreak(word, maxW, font, out) {
    let chunk = '';
    for (const ch of word) {
      if (chunk && measureText(chunk + ch, font) > maxW) {
        out.push(chunk);
        chunk = ch;
      } else {
        chunk += ch;
      }
    }
    return chunk;
  }

  function wrapText(text, maxW, font) {
    const words = String(text).replace(/\s+/g, ' ').trim().split(' ');
    const lines = [];
    let cur = '';
    for (const word of words) {
      if (!word) continue;
      const test = cur ? cur + ' ' + word : word;
      if (measureText(test, font) <= maxW) {
        cur = test;
        continue;
      }
      if (cur) {
        lines.push(cur);
        cur = '';
      }
      if (measureText(word, font) > maxW) {
        const rest = hardBreak(word, maxW, font, lines);
        cur = rest;
      } else {
        cur = word;
      }
    }
    if (cur) lines.push(cur);
    if (!lines.length) lines.push('');
    if (lines.length > 7) {
      lines.length = 7;
      lines[6] = lines[6].replace(/\s+$/, '') + ' …';
    }
    return lines;
  }

  function fmt(n) {
    return Math.round(n * 10) / 10;
  }

  function roundedPath(points, radius) {
    const r0 = radius == null ? 7 : radius;
    if (!points || points.length < 2) return '';
    let d = 'M' + fmt(points[0][0]) + ',' + fmt(points[0][1]);
    for (let i = 1; i < points.length - 1; i++) {
      const p0 = points[i - 1];
      const p1 = points[i];
      const p2 = points[i + 1];
      const v1x = p1[0] - p0[0], v1y = p1[1] - p0[1];
      const v2x = p2[0] - p1[0], v2y = p2[1] - p1[1];
      const l1 = Math.hypot(v1x, v1y);
      const l2 = Math.hypot(v2x, v2y);
      const r = Math.min(r0, l1 / 2, l2 / 2);
      if (r < 0.5 || l1 < 0.5 || l2 < 0.5) {
        d += ' L' + fmt(p1[0]) + ',' + fmt(p1[1]);
        continue;
      }
      const ax = p1[0] - (v1x / l1) * r;
      const ay = p1[1] - (v1y / l1) * r;
      const bx = p1[0] + (v2x / l2) * r;
      const by = p1[1] + (v2y / l2) * r;
      d += ' L' + fmt(ax) + ',' + fmt(ay) +
           ' Q' + fmt(p1[0]) + ',' + fmt(p1[1]) + ' ' + fmt(bx) + ',' + fmt(by);
    }
    const last = points[points.length - 1];
    d += ' L' + fmt(last[0]) + ',' + fmt(last[1]);
    return d;
  }

  const CFG = {
    process:    { maxText: 230, padX: 17, padY: 11, minW: 122, minH: 42 },
    terminator: { maxText: 200, padX: 28, padY: 8,  minW: 130, minH: 40 },
    decision:   { maxText: 190, padX: 32, padY: 18, minW: 152, minH: 64 },
    io:         { maxText: 215, padX: 34, padY: 11, minW: 142, minH: 44 },
    predefined: { maxText: 210, padX: 28, padY: 11, minW: 134, minH: 44 },
    loop:       { maxText: 215, padX: 34, padY: 11, minW: 144, minH: 46 }
  };

  const LINE_H = 16;

  function makeShapeNode(type, text, opts) {
    opts = opts || {};
    const cfg = CFG[type] || CFG.process;
    const maxText = opts.maxText || cfg.maxText;
    const font = opts.font || FONT;
    const lines = wrapText(text == null ? '' : text, maxText, font);
    const textW = Math.max.apply(null, lines.map(function (l) { return measureText(l, font); }));
    const padX = opts.padX != null ? opts.padX : cfg.padX;
    const padY = opts.padY != null ? opts.padY : cfg.padY;
    const w = Math.max(opts.minW || cfg.minW, Math.ceil(textW + padX * 2));
    const h = Math.max(opts.minH || cfg.minH, lines.length * LINE_H + padY * 2);
    const stroke = opts.stroke || LINE_COLOR;

    return {
      w: w,
      h: h,
      shape: type,
      text: text,
      draw: function (r, x, y) {
        const cx = x + w / 2;
        const cy = y + h / 2;
        r.beginNode(type, text, x, y, w, h);
        if (type === 'decision') {
          const pts = [
            [cx, y], [x + w, cy], [cx, y + h], [x, cy]
          ].map(function (p) { return fmt(p[0]) + ',' + fmt(p[1]); }).join(' ');
          r.add('<polygon points="' + pts + '" fill="#ffffff" stroke="' + stroke + '" stroke-width="1.6"/>');
        } else if (type === 'io') {
          const s = Math.min(20, w * 0.13);
          const pts = [
            [x + s, y], [x + w, y], [x + w - s, y + h], [x, y + h]
          ].map(function (p) { return fmt(p[0]) + ',' + fmt(p[1]); }).join(' ');
          r.add('<polygon points="' + pts + '" fill="#ffffff" stroke="' + stroke + '" stroke-width="1.6"/>');
        } else if (type === 'loop') {
          const c = Math.min(22, w * 0.14);
          const pts = [
            [x + c, y], [x + w - c, y], [x + w, cy],
            [x + w - c, y + h], [x + c, y + h], [x, cy]
          ].map(function (p) { return fmt(p[0]) + ',' + fmt(p[1]); }).join(' ');
          r.add('<polygon points="' + pts + '" fill="#ffffff" stroke="' + stroke + '" stroke-width="1.6"/>');
        } else if (type === 'terminator') {
          r.add('<rect x="' + fmt(x) + '" y="' + fmt(y) + '" width="' + fmt(w) + '" height="' + fmt(h) +
                '" rx="' + fmt(h / 2) + '" ry="' + fmt(h / 2) + '" fill="#ffffff" stroke="' + stroke + '" stroke-width="1.6"/>');
        } else if (type === 'predefined') {
          r.add('<rect x="' + fmt(x) + '" y="' + fmt(y) + '" width="' + fmt(w) + '" height="' + fmt(h) +
                '" fill="#ffffff" stroke="' + stroke + '" stroke-width="1.6"/>');
          r.add('<line x1="' + fmt(x + 14) + '" y1="' + fmt(y) + '" x2="' + fmt(x + 14) + '" y2="' + fmt(y + h) +
                '" stroke="' + stroke + '" stroke-width="1.3"/>');
          r.add('<line x1="' + fmt(x + w - 14) + '" y1="' + fmt(y) + '" x2="' + fmt(x + w - 14) + '" y2="' + fmt(y + h) +
                '" stroke="' + stroke + '" stroke-width="1.3"/>');
        } else {
          r.add('<rect x="' + fmt(x) + '" y="' + fmt(y) + '" width="' + fmt(w) + '" height="' + fmt(h) +
                '" fill="#ffffff" stroke="' + stroke + '" stroke-width="1.6"/>');
        }

        if (opts.prefix) {
          r.text(cx, y + 9, opts.prefix, {
            size: 10.5, fill: MUTED, anchor: 'middle'
          });
        }
        const shiftY = opts.prefix ? 6 : 0;
        r.textLines(cx, cy + shiftY, lines, {
          font: font, lineH: LINE_H, fill: opts.textFill || TEXT_COLOR
        });
        r.endNode();
      }
    };
  }

  class Painter {
    constructor() {
      this.items = [];
      this.routeIndex = 0;
      this.routePrefix = '';
      this.routeOverrides = null;
      this.nodeIndex = 0;
      this.nodePrefix = '';
      this.nodeIdOverride = null;
      this.renderedNodes = [];
    }

    beginNode(type, text, x, y, w, h) {
      const id = this.nodeIdOverride || this.nodePrefix + ':node:' + this.nodeIndex++;
      this.nodeIdOverride = null;
      const label = String(text == null ? '' : text);
      const isManualNode = id.indexOf(this.nodePrefix + ':manual:') === 0;
      const role = !isManualNode && type === 'terminator' && /^начало$/i.test(label.trim())
        ? 'start' : (!isManualNode && type === 'terminator' && /^конец$/i.test(label.trim()) ? 'end' : '');
      this.renderedNodes.push({
        id: id, type: type, label: label, x: x, y: y, w: w, h: h,
        role: role, isReturn: /^return\b/.test(label.trim())
      });
      this.add('<g data-node-id="' + escapeXml(id) + '" data-graph-key="' +
        escapeXml(this.nodePrefix) + '" data-node-type="' + escapeXml(type) +
        '" data-node-label="' + escapeXml(label) + '" data-node-x="' + fmt(x) +
        '" data-node-y="' + fmt(y) + '" data-node-w="' + fmt(w) +
        '" data-node-h="' + fmt(h) + '"' +
        (role ? ' data-node-role="' + role + '"' : '') +
        (/^return\b/.test(label.trim()) ? ' data-node-return="true"' : '') + '>');
      return id;
    }

    endNode() {
      this.add('</g>');
    }

    add(markup) {
      this.items.push(markup);
    }

    text(x, y, str, opts) {
      opts = opts || {};
      const size = opts.size || 12.5;
      const fill = opts.fill || TEXT_COLOR;
      const anchor = opts.anchor || 'middle';
      const weight = opts.weight || '400';
      const family = opts.family || FONT_FAMILY;
      const style = opts.italic ? ' font-style="italic"' : '';
      this.add('<text x="' + fmt(x) + '" y="' + fmt(y) + '" font-family="' + family +
        '" font-size="' + size + '" font-weight="' + weight + '"' + style +
        ' fill="' + fill + '" text-anchor="' + anchor +
        '" dominant-baseline="middle">' + escapeXml(str) + '</text>');
    }

    textLines(cx, cy, lines, opts) {
      opts = opts || {};
      const lineH = opts.lineH || LINE_H;
      const size = opts.size || 12.5;
      const fill = opts.fill || TEXT_COLOR;
      const weight = opts.weight || '400';
      const family = opts.family || FONT_FAMILY;
      const total = (lines.length - 1) * lineH;
      for (let i = 0; i < lines.length; i++) {
        this.add('<text x="' + fmt(cx) + '" y="' + fmt(cy - total / 2 + i * lineH) +
          '" font-family="' + family + '" font-size="' + size +
          '" font-weight="' + weight + '" fill="' + fill +
          '" text-anchor="middle" dominant-baseline="middle">' +
          escapeXml(lines[i]) + '</text>');
      }
    }

    label(x, y, str, align) {
      this.text(x, y, str, {
        size: 11.5, fill: MUTED, anchor: align || 'middle',
        family: FONT_FAMILY, italic: true
      });
    }

    line(points, arrow) {
      if (!points || points.length < 2) return;
      const routeId = this.routePrefix + ':' + this.routeIndex++;
      const override = this.routeOverrides && this.routeOverrides[routeId];
      const routePoints = override || points;
      const d = roundedPath(routePoints, 7);
      this.add('<path d="' + d + '" fill="none" stroke="' + LINE_COLOR +
        '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"' +
        ' data-route-id="' + escapeXml(routeId) + '" data-route-points="' +
        escapeXml(JSON.stringify(routePoints)) + '" data-route-default="' +
        escapeXml(JSON.stringify(points)) + '"' +
        (arrow ? ' marker-end="url(#gost-arrow)"' : '') + '/>');
    }

    dashedRect(x, y, w, h) {
      this.add('<rect x="' + fmt(x) + '" y="' + fmt(y) + '" width="' + fmt(w) +
        '" height="' + fmt(h) + '" rx="10" fill="none" stroke="#94a3b8"' +
        ' stroke-width="1.4" stroke-dasharray="6 5"/>');
    }

    functionTitle(x, topY, text) {
      this.add('<rect x="' + fmt(x) + '" y="' + fmt(topY) + '" width="3.5" height="18" rx="1.5" fill="' + ACCENT + '"/>');
      this.text(x + 11, topY + 9, text, {
        size: 15, weight: 600, anchor: 'start', fill: '#0f172a'
      });
    }

    legendNote(x, y, text) {
      this.text(x, y, text, { size: 11, fill: MUTED, anchor: 'start' });
    }

    toSvgDefs() {
      return '<defs>' +
        '<marker id="gost-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">' +
        '<path d="M 0 0 L 10 5 L 0 10 z" fill="' + LINE_COLOR + '"/></marker>' +
        '</defs>';
    }

    content() {
      return this.items.join('');
    }
  }

  global.GostRender = {
    FONT: FONT,
    FONT_FAMILY: FONT_FAMILY,
    TITLE_FONT: TITLE_FONT,
    LINE_H: LINE_H,
    COLORS: { line: LINE_COLOR, text: TEXT_COLOR, muted: MUTED, accent: ACCENT, accentLight: ACCENT_LIGHT },
    measureText: measureText,
    wrapText: wrapText,
    escapeXml: escapeXml,
    makeShapeNode: makeShapeNode,
    roundedPath: roundedPath,
    Painter: Painter,
    fmt: fmt
  };
})(window);
