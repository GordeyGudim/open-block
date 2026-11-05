/* Компоновка блок-схемы: AST -> геометрия и SVG-примитивы. */
(function (global) {
  'use strict';

  const R = global.GostRender;
  const VGAP = 26;
  const HGAP = 44;
  const GUT = 46;

  function shape(type, text, opts) {
    return R.makeShapeNode(type, text, opts || {});
  }

  function emptyNode() {
    return { w: 0, h: 0, empty: true, draw: function () {} };
  }

  function connectV(r, x1, y1, x2, y2) {
    if (Math.abs(x1 - x2) < 0.5) {
      r.line([[x1, y1], [x2, y2]], false);
    } else {
      const mid = (y1 + y2) / 2;
      r.line([[x1, y1], [x1, mid], [x2, mid], [x2, y2]], false);
    }
  }

  function stackNodes(nodes, gap) {
    gap = gap == null ? VGAP : gap;
    const list = nodes.filter(function (n) { return n && !n.empty && n.w > 0.5; });
    if (!list.length) return emptyNode();
    const w = Math.max.apply(null, list.map(function (n) { return n.w; }));
    const h = list.reduce(function (s, n) { return s + n.h; }, 0) + gap * (list.length - 1);

    return {
      w: w,
      h: h,
      terminates: !!(list[list.length - 1] && list[list.length - 1].terminates),
      draw: function (r, x, y) {
        let cy = y;
        let prev = null;
        let prevAxis = 0;
        for (let i = 0; i < list.length; i++) {
          const n = list[i];
          const nx = x + (w - n.w) / 2;
          const axis = nx + n.w / 2;
          if (prev && !prev.terminates) {
            connectV(r, prevAxis, cy - gap, axis, cy);
          }
          n.draw(r, nx, cy);
          prev = n;
          prevAxis = axis;
          cy += n.h + gap;
        }
      }
    };
  }

  function layoutList(list) {
    const nodes = [];
    if (!list || !list.length) return emptyNode();
    for (let i = 0; i < list.length; i++) {
      const n = layoutStatement(list[i]);
      if (n && !n.empty) nodes.push(n);
      if (n && n.terminates) break;
    }
    return stackNodes(nodes);
  }

  function mergeLine(r, fromX, fromBottom, toX, mergeY) {
    const pts = [[fromX, fromBottom]];
    if (mergeY - fromBottom > 0.5) pts.push([fromX, mergeY]);
    if (Math.abs(fromX - toX) > 0.5) pts.push([toX, mergeY]);
    r.line(pts, false);
  }

  function branchLabel(r, x, y, text, align) {
    const width = R.measureText(text, '11.5px ' + R.FONT_FAMILY) + 8;
    const left = align === 'end' ? x - width + 4 : x - 4;
    r.add('<rect x="' + R.fmt(left) + '" y="' + R.fmt(y - 8) + '" width="' +
      R.fmt(width) + '" height="16" fill="#ffffff" stroke="none"/>');
    r.label(x, y, text, align);
  }

  function endsWithReturn(list) {
    if (!list || !list.length) return false;
    const last = list[list.length - 1];
    return !!last && (
      last.type === 'return' ||
      (last.type === 'process' && last.terminates && /^throw\b/.test(last.text || ''))
    );
  }

  function layoutIf(ast) {
    const dec = shape('decision', ast.cond || 'условие');
    const thenN = layoutStatement(ast.then);
    const elseN = ast.else ? layoutStatement(ast.else) : null;
    const hasElse = elseN && !elseN.empty;

    if (!hasElse) {
      const w = Math.max(dec.w + 44, thenN.w + 76);
      const branchTop = dec.h + VGAP;
      const mergeY = branchTop + thenN.h + 28;
      const h = mergeY;
      const cx = w / 2;
      const bypass = w - 16;
      const thenTerm = !!thenN.terminates;

      return {
        w: w, h: h, terminates: false,
        draw: function (r, x, y) {
          dec.draw(r, x + (w - dec.w) / 2, y);
          thenN.draw(r, x + cx - thenN.w / 2, y + branchTop);

          const leftV = x + (w - dec.w) / 2;
          const rightVX = leftV + dec.w;
          const midY = y + dec.h / 2;

          const leftVX = x + (w - dec.w) / 2;
          const yesLane = leftVX - 16;
          const yesJoinY = y + branchTop - 13;
          r.line([
            [leftVX, y + dec.h / 2], [yesLane, y + dec.h / 2],
            [yesLane, yesJoinY], [x + cx, yesJoinY], [x + cx, y + branchTop]
          ], false);
          branchLabel(r, yesLane - 7, y + dec.h / 2 - 9, 'Да', 'end');

          r.line([
            [rightVX, midY],
            [x + bypass, midY],
            [x + bypass, y + mergeY],
            [x + cx, y + mergeY]
          ], false);
          branchLabel(r, rightVX + 8, midY - 9, 'Нет', 'start');

          if (!thenTerm && mergeY - (branchTop + thenN.h) > 1) {
            r.line([[x + cx, y + branchTop + thenN.h], [x + cx, y + mergeY]], false);
          }
        }
      };
    }

    const contentW = thenN.w + HGAP + elseN.w;
    const w = Math.max(dec.w + 30, contentW);
    const branchTop = dec.h + VGAP;
    const maxBH = Math.max(thenN.h, elseN.h);
    const mergeY = branchTop + maxBH + 28;
    const h = mergeY;
    const cx = w / 2;
    const contentX = (w - contentW) / 2;
    const elseAxis = contentX + elseN.w / 2;
    const thenAxis = contentX + elseN.w + HGAP + thenN.w / 2;
    const thenTerm = !!thenN.terminates;
    const elseTerm = !!elseN.terminates;

    return {
      w: w, h: h, terminates: thenTerm && elseTerm,
      draw: function (r, x, y) {
        const decX = x + (w - dec.w) / 2;
        dec.draw(r, decX, y);
        elseN.draw(r, x + contentX, y + branchTop);
        thenN.draw(r, x + contentX + elseN.w + HGAP, y + branchTop);

        const leftV = [decX, y + dec.h / 2];
        const rightV = [decX + dec.w, y + dec.h / 2];
        const branchJoinY = y + branchTop - 13;
        const yesLane = decX + dec.w + 16;
        const noLane = decX - 16;

        r.line([
          rightV, [yesLane, rightV[1]], [yesLane, branchJoinY],
          [x + thenAxis, branchJoinY],
          [x + thenAxis, y + branchTop]
        ], false);
        r.line([
          leftV, [noLane, leftV[1]], [noLane, branchJoinY],
          [x + elseAxis, branchJoinY], [x + elseAxis, y + branchTop]
        ], false);
        branchLabel(r, yesLane + 7, rightV[1] - 9, 'Да', 'start');
        branchLabel(r, noLane - 7, leftV[1] - 9, 'Нет', 'end');

        if (!thenTerm) mergeLine(r, x + thenAxis, y + branchTop + thenN.h, x + cx, y + mergeY);
        if (!elseTerm) mergeLine(r, x + elseAxis, y + branchTop + elseN.h, x + cx, y + mergeY);
      }
    };
  }

  function layoutWhile(ast) {
    const head = shape('decision', ast.cond || 'условие');
    const body = layoutStatement(ast.body);
    const contentW = Math.max(head.w, body.w);
    const w = contentW + GUT * 2;
    const axis = GUT + contentW / 2;
    const bodyTop = head.h + VGAP;
    const bodyBottom = bodyTop + body.h;
    const bottomY = bodyBottom + 34;
    const h = bottomY;

    return {
      w: w, h: h,
      draw: function (r, x, y) {
        head.draw(r, x + axis - head.w / 2, y);
        body.draw(r, x + axis - body.w / 2, y + bodyTop);

        r.line([[x + axis, y + head.h], [x + axis, y + bodyTop]], false);
        r.label(x + axis + 8, y + head.h + 13, 'Да', 'start');

        if (!body.terminates) {
          const backY = bodyBottom + 13;
          r.line([
            [x + axis, y + bodyBottom],
            [x + axis, y + backY],
            [x + 16, y + backY],
            [x + 16, y + head.h / 2],
            [x + axis - head.w / 2, y + head.h / 2]
          ], true);
        }

        const rightVX = x + axis + head.w / 2;
        const exitX = x + w - 16;
        r.line([
          [rightVX, y + head.h / 2],
          [exitX, y + head.h / 2],
          [exitX, y + bottomY],
          [x + axis, y + bottomY]
        ], false);
        r.label(rightVX + 8, y + head.h / 2 - 9, 'Нет', 'start');
      }
    };
  }

  function layoutFor(ast) {
    const initN = ast.init ? shape('process', ast.init) : null;
    const head = shape('loop', ast.cond || 'true');
    const body = layoutStatement(ast.body);
    const stepN = (ast.step && !ast.range) ? shape('process', ast.step) : null;

    const initH = initN ? initN.h + VGAP : 0;
    const bodyTop = initH + head.h + VGAP;
    const stepTop = bodyTop + body.h + VGAP;
    const tail = stepN ? stepTop + stepN.h : bodyTop + body.h;
    const contentW = Math.max(head.w, body.w, initN ? initN.w : 0, stepN ? stepN.w : 0);
    const w = contentW + GUT * 2;
    const axis = GUT + contentW / 2;
    const bottomY = tail + 34;
    const h = bottomY;

    return {
      w: w, h: h,
      draw: function (r, x, y) {
        if (initN) {
          initN.draw(r, x + axis - initN.w / 2, y);
          r.line([[x + axis, y + initN.h], [x + axis, y + initH]], false);
        }
        head.draw(r, x + axis - head.w / 2, y + initH);
        body.draw(r, x + axis - body.w / 2, y + bodyTop);
        if (stepN) stepN.draw(r, x + axis - stepN.w / 2, y + stepTop);

        r.line([[x + axis, y + initH + head.h], [x + axis, y + bodyTop]], false);

        if (stepN) {
          r.line([[x + axis, y + bodyTop + body.h], [x + axis, y + stepTop]], false);
        }

        if (!body.terminates) {
          const backFrom = stepN ? y + stepTop + stepN.h : y + bodyTop + body.h;
          const backY = backFrom + 13;
          r.line([
            [x + axis, backFrom],
            [x + axis, backY],
            [x + 16, backY],
            [x + 16, y + initH + head.h / 2],
            [x + axis - head.w / 2, y + initH + head.h / 2]
          ], true);
        }

        // Выход из составного блока for продолжает общий поток снизу.
        // Выход идёт от правой вершины блока и огибает тело цикла справа.
        const rightVX = x + axis + head.w / 2;
        const exitX = x + w - 16;
        r.line([
          [rightVX, y + initH + head.h / 2],
          [exitX, y + initH + head.h / 2],
          [exitX, y + bottomY],
          [x + axis, y + bottomY]
        ], false);
      }
    };
  }

  function layoutDoWhile(ast) {
    const head = shape('loop', 'do', { minW: 104 });
    const body = layoutStatement(ast.body);
    const dec = shape('decision', ast.cond || 'условие');
    const contentW = Math.max(head.w, body.w, dec.w);
    const w = contentW + GUT * 2;
    const axis = GUT + contentW / 2;
    const bodyTop = head.h + VGAP;
    const decTop = bodyTop + body.h + VGAP;
    const decBottom = decTop + dec.h;
    const bottomY = decBottom + 32;
    const h = bottomY;

    return {
      w: w, h: h,
      draw: function (r, x, y) {
        head.draw(r, x + axis - head.w / 2, y);
        body.draw(r, x + axis - body.w / 2, y + bodyTop);
        dec.draw(r, x + axis - dec.w / 2, y + decTop);

        r.line([[x + axis, y + head.h], [x + axis, y + bodyTop]], false);
        r.line([[x + axis, y + bodyTop + body.h], [x + axis, y + decTop]], false);

        if (!body.terminates) {
          const leftVX = x + axis - dec.w / 2;
          const midY = y + decTop + dec.h / 2;
          r.line([
            [leftVX, midY],
            [x + 16, midY],
            [x + 16, y + head.h / 2],
            [x + axis - head.w / 2, y + head.h / 2]
          ], true);
          r.label(leftVX - 8, midY - 9, 'Да', 'end');
        }

        r.line([
          [x + axis, y + decBottom],
          [x + axis, y + bottomY]
        ], false);
        r.label(x + axis + 8, y + decBottom + 14, 'Нет', 'start');
      }
    };
  }

  function layoutSwitch(ast) {
    const head = shape('decision', 'switch (' + ast.expr + ')');
    const cases = ast.cases && ast.cases.length
      ? ast.cases
      : [{ label: 'default', body: [], isDefault: true }];

    const cols = cases.map(function (c) {
      const body = layoutList(c.body);
      return {
        label: (c.isDefault || c.label === 'default') ? 'default:' : 'case ' + c.label + ':',
        body: body,
        returns: endsWithReturn(c.body)
      };
    });

    const GAP = 28;
    const MIN_COL = 116;
    cols.forEach(function (c) {
      if (c.body.empty) {
        c.body = shape('process', '—', { minW: 96, minH: 32 });
      }
      const labelW = R.measureText(c.label, "600 11.5px " + R.FONT_FAMILY) + 12;
      c.w = Math.max(c.body.w, labelW, MIN_COL);
      c.h = c.body.h;
    });

    const colsW = cols.reduce(function (s, c) { return s + c.w; }, 0) + GAP * (cols.length - 1);
    const w = Math.max(head.w + 24, colsW);
    const fanY = head.h + 24;
    const colTop = fanY + 30;
    const maxH = Math.max.apply(null, cols.map(function (c) { return c.h; }));
    const mergeY = colTop + maxH + 28;
    const h = mergeY;
    const cx = w / 2;

    let off = (w - colsW) / 2;
    cols.forEach(function (c) {
      c.off = off;
      c.axis = off + c.w / 2;
      off += c.w + GAP;
    });

    const allReturn = cols.every(function (c) { return c.returns; }) &&
      cases.some(function (c) { return c.isDefault || c.label === 'default'; });

    return {
      w: w, h: h, terminates: allReturn,
      draw: function (r, x, y) {
        head.draw(r, x + (w - head.w) / 2, y);

        cols.forEach(function (c) {
          const ax = x + c.axis;
          const pts = [[x + cx, y + head.h], [x + cx, y + fanY]];
          if (c.axis !== cx) {
            pts.push([ax, y + fanY]);
            pts.push([ax, y + colTop]);
          } else {
            pts.push([ax, y + colTop]);
          }
          r.line(pts, false);
          r.text(ax, y + colTop - 11, c.label, {
            size: 11.5, weight: 600, fill: R.COLORS.accent
          });
          c.body.draw(r, x + c.off, y + colTop);
          if (!c.returns) mergeLine(r, ax, y + colTop + c.h, x + cx, y + mergeY);
        });
      }
    };
  }

  function makeFrame(title, inner) {
    if (!inner || inner.empty) inner = shape('process', '—', { minW: 96, minH: 32 });
    const titleW = R.measureText(title, "600 11.5px 'Cascadia Mono', 'Consolas', monospace") + 30;
    const w = Math.max(inner.w + 30, titleW);
    const h = inner.h + 40;
    return {
      w: w, h: h,
      draw: function (r, x, y) {
        r.dashedRect(x, y, w, h);
        r.text(x + 14, y + 14, title, {
          size: 11.5, weight: 600, anchor: 'start', fill: R.COLORS.accent,
          family: "'Cascadia Mono', 'Consolas', monospace"
        });
        inner.draw(r, x + (w - inner.w) / 2, y + 30);
      }
    };
  }

  function layoutTry(ast) {
    const frames = [makeFrame('try', layoutStatement(ast.body))];
    (ast.catches || []).forEach(function (c) {
      frames.push(makeFrame('catch (' + c.param + ')', layoutStatement(c.body)));
    });
    return stackNodes(frames, 22);
  }

  function layoutStatement(ast) {
    if (!ast) return emptyNode();
    switch (ast.type) {
      case 'block': return layoutList(ast.body);
      case 'if': return layoutIf(ast);
      case 'while': return layoutWhile(ast);
      case 'for': return layoutFor(ast);
      case 'dowhile': return layoutDoWhile(ast);
      case 'switch': return layoutSwitch(ast);
      case 'try': return layoutTry(ast);
      case 'return': {
        const rn = shape('process', ast.text || 'return', { maxText: 210 });
        rn.terminates = true;
        return rn;
      }
      case 'io':
        return shape('io', ast.text, {});
      case 'call':
        return shape('predefined', ast.text, {});
      case 'process': {
        const n = shape('process', ast.text, { minW: ast.terminates ? 104 : 122 });
        if (ast.terminates) n.terminates = true;
        return n;
      }
      default:
        return shape('process', ast.text || String(ast.type));
    }
  }

  function shorten(text, max) {
    const t = String(text || '');
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
  }

  function layoutFunction(fn) {
    const startNode = shape('terminator', 'начало');
    const body = layoutList(fn.body);
    const endNode = shape('terminator', 'конец');

    const parts = [startNode];
    if (fn.initList) parts.push(shape('process', fn.initList, { maxText: 215 }));
    if (!body.empty) parts.push(body);
    parts.push(endNode);
    const inner = stackNodes(parts);

    const title = fn.name + '(' + shorten(fn.params, 54) + ')';
    const titleW = R.measureText(title, R.TITLE_FONT) + 34;
    const w = Math.max(inner.w, titleW, 172);
    const h = 36 + inner.h;

    return {
      w: w, h: h,
      title: title,
      draw: function (r, x, y) {
        r.functionTitle(x, y, title);
        const firstNode = r.renderedNodes.length;
        inner.draw(r, x + (w - inner.w) / 2, y + 36);
        const functionNodes = r.renderedNodes.slice(firstNode);
        const end = functionNodes.filter(function (node) { return node.role === 'end'; })[0];
        const returns = functionNodes.filter(function (node) { return node.isReturn; });
        if (end) {
          returns.forEach(function (node, index) {
            const start = [node.x + node.w, node.y + node.h / 2];
            const target = [end.x + end.w / 2, end.y];
            const laneX = x + w + 24 + index * 14;
            const approachY = end.y - 14 - (returns.length - index - 1) * 10;
            r.line([
              start,
              [laneX, start[1]],
              [laneX, approachY],
              [target[0], approachY],
              target
            ], true);
          });
        }
      }
    };
  }

  global.GostLayout = {
    layoutFunction: layoutFunction,
    layoutStatement: layoutStatement,
    VGAP: VGAP,
    HGAP: HGAP
  };
})(window);
