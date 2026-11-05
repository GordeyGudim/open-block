(function () {
  'use strict';

  const R = window.GostRender;
  const L = window.GostLayout;

  const $ = function (id) { return document.getElementById(id); };

  const codeEl = $('code');
  const lineNumbersEl = $('lineNumbers');
  const examplesEl = $('examples');
  const btnBuild = $('btn-build');
  const statusEl = $('parse-status');
  const statsEl = $('code-stats');
  const tabsEl = $('funcTabs');
  const svgEl = $('diagram');
  const wrapEl = $('canvasWrap');
  const emptyEl = $('emptyState');
  const emptyTitleEl = emptyEl.querySelector('.empty-title');
  const emptyTextEl = emptyEl.querySelector('.empty-text');
  const toastEl = $('toast');
  const legendEl = $('legendDialog');

  const STORAGE_KEY = 'cpp-gost-flowchart-src-v1';

  const state = {
    funcs: [],
    active: 0,
    width: 0,
    height: 0,
    content: '',
    defs: '',
    view: null,
    drag: null,
    timer: null,
    fileName: 'block-shema'
  };

  /* ---------- служебное ---------- */

  let toastTimer = null;
  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function updateLineNumbers() {
    const count = codeEl.value.split('\n').length;
    const parts = [];
    for (let i = 1; i <= count; i++) parts.push(i);
    lineNumbersEl.textContent = parts.join('\n');
    lineNumbersEl.scrollTop = codeEl.scrollTop;
  }

  function updateCodeStats() {
    const text = codeEl.value;
    const lines = text ? text.split('\n').length : 0;
    statsEl.textContent = lines + ' стр. · ' + text.length + ' симв.';
  }

  /* ---------- разбор и отрисовка ---------- */

  function countBlocks(list) {
    let n = 0;
    (list || []).forEach(function (st) {
      if (!st) return;
      switch (st.type) {
        case 'block': n += countBlocks(st.body); break;
        case 'if':
          n += 1 + countBlocks(st.then ? st.then.body : []);
          if (st.else) n += countBlocks(st.else.body);
          break;
        case 'while':
        case 'for':
        case 'dowhile':
          n += 2 + countBlocks(st.body ? st.body.body : []);
          break;
        case 'switch':
          n += 1;
          (st.cases || []).forEach(function (c) { n += countBlocks(c.body); });
          break;
        case 'try':
          n += 1 + countBlocks(st.body ? st.body.body : []);
          (st.catches || []).forEach(function (c) { n += countBlocks(c.body); });
          break;
        default: n += 1;
      }
    });
    return n;
  }

  function shortName(name) {
    return name.length > 24 ? name.slice(0, 22) + '…' : name;
  }

  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b === 1) return one;
    if (b >= 2 && b <= 4) return few;
    return many;
  }

  function renderTabs() {
    tabsEl.innerHTML = '';
    if (state.funcs.length > 1) {
      const all = document.createElement('button');
      all.type = 'button';
      all.className = 'tab' + (state.active === -1 ? ' active' : '');
      all.textContent = 'Все функции';
      all.addEventListener('click', function () {
        state.active = -1;
        renderTabs();
        renderDiagram();
      });
      tabsEl.appendChild(all);
    }
    state.funcs.forEach(function (fn, idx) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tab' + (state.active === idx ? ' active' : '');
      b.textContent = shortName(fn.name) + '()';
      b.title = fn.name + '(' + fn.params + ')';
      b.addEventListener('click', function () {
        state.active = idx;
        renderTabs();
        renderDiagram();
      });
      tabsEl.appendChild(b);
    });
  }

  function renderDiagram() {
    if (!state.funcs.length) return;

    let list;
    if (state.active === -1) list = state.funcs.slice();
    else list = [state.funcs[state.active] || state.funcs[0]];

    const diagrams = list.map(function (fn) { return L.layoutFunction(fn); });
    const margin = 44;
    const gap = 58;
    const maxW = Math.max.apply(null, diagrams.map(function (d) { return d.w; }).concat([240]));
    const totalH = diagrams.reduce(function (s, d) { return s + d.h; }, 0) + gap * (diagrams.length - 1);
    const width = Math.ceil(maxW + margin * 2);
    const height = Math.ceil(totalH + margin * 2);

    const p = new R.Painter();
    let cy = margin;
    diagrams.forEach(function (d, i) {
      d.draw(p, margin + (maxW - d.w) / 2, cy);
      cy += d.h;
      if (i < diagrams.length - 1) {
        p.add('<line x1="' + margin + '" y1="' + (cy + gap / 2) + '" x2="' +
          (width - margin) + '" y2="' + (cy + gap / 2) +
          '" stroke="#dbe2ee" stroke-width="1" stroke-dasharray="4 6"/>');
        cy += gap;
      }
    });

    state.width = width;
    state.height = height;
    state.defs = p.toSvgDefs();
    state.content = p.content();
    state.fileName = (state.active === -1 ? 'block-shema' :
      (state.funcs[state.active] || state.funcs[0]).name.replace(/[^\w.-]+/g, '_')) || 'block-shema';

    svgEl.innerHTML = '<rect x="0" y="0" width="' + width + '" height="' + height +
      '" fill="#ffffff"/>' + state.defs + state.content;
    svgEl.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    emptyEl.classList.add('hidden');
    fitView();
  }

  function build() {
    clearTimeout(state.timer);
    const src = codeEl.value;
    const started = (window.performance && performance.now) ? performance.now() : Date.now();

    updateLineNumbers();
    updateCodeStats();
    try { localStorage.setItem(STORAGE_KEY, src); } catch (e) { /* ignore */ }

    let funcs = [];
    try {
      funcs = CppParser.parse(src);
    } catch (err) {
      showError('Ошибка разбора', 'Не удалось разобрать код: ' + escapeHtml(err && err.message ? err.message : String(err)));
      return;
    }

    if (!funcs.length) {
      showError('Функции не найдены',
        'Добавьте определение функции, например:<br><code>int main() { ... }</code>');
      statusEl.textContent = 'Функции не найдены';
      statusEl.className = 'err';
      return;
    }

    const prev = state.funcs[state.active];
    const prevName = prev ? prev.name : null;
    state.funcs = funcs;

    let newActive = -1;
    if (state.active === -1 && funcs.length > 1) {
      newActive = -1;
    } else {
      let found = -1;
      if (prevName) {
        for (let i = 0; i < funcs.length; i++) {
          if (funcs[i].name === prevName) { found = i; break; }
        }
      }
      if (found < 0) {
        for (let i = 0; i < funcs.length; i++) {
          if (/(^|::)main$/.test(funcs[i].name)) { found = i; break; }
        }
      }
      newActive = found >= 0 ? found : 0;
    }
    state.active = newActive;

    try {
      renderTabs();
      renderDiagram();
    } catch (err) {
      showError('Ошибка построения', 'Не удалось построить схему: ' + escapeHtml(err && err.message ? err.message : String(err)));
      return;
    }

    const elapsed = Math.round(((window.performance && performance.now) ? performance.now() : Date.now()) - started);
    let blocks = 0;
    funcs.forEach(function (f) { blocks += countBlocks(f.body); });
    statusEl.className = 'ok';
    statusEl.textContent = 'Готово · ' + funcs.length + ' ' +
      plural(funcs.length, 'функция', 'функции', 'функций') +
      ' · ' + blocks + ' ' + plural(blocks, 'блок', 'блока', 'блоков') +
      ' · ' + elapsed + ' мс';
  }

  function showError(title, html) {
    state.funcs = [];
    state.width = 0;
    state.height = 0;
    svgEl.innerHTML = '';
    svgEl.setAttribute('viewBox', '0 0 100 100');
    tabsEl.innerHTML = '';
    emptyTitleEl.textContent = title;
    emptyTextEl.innerHTML = html;
    emptyEl.classList.remove('hidden');
    statusEl.className = 'err';
  }

  /* ---------- масштаб и панорама ---------- */

  function applyView() {
    if (!state.view) return;
    const v = state.view;
    svgEl.setAttribute('viewBox',
      R.fmt(v.x) + ' ' + R.fmt(v.y) + ' ' + R.fmt(v.w) + ' ' + R.fmt(v.h));
  }

  function fitView() {
    if (!state.width || !state.height) return;
    const pad = 26;
    state.view = {
      x: -pad,
      y: -pad,
      w: state.width + pad * 2,
      h: state.height + pad * 2
    };
    applyView();
  }

  function zoomAt(cx, cy, factor) {
    if (!state.view) return;
    const v = state.view;
    const nw = Math.max(60, Math.min(v.w * factor, state.width * 8 || 6000));
    const nh = nw * (v.h / v.w);
    v.x = cx - (cx - v.x) * (nw / v.w);
    v.y = cy - (cy - v.y) * (nh / v.h);
    v.w = nw;
    v.h = nh;
    applyView();
  }

  svgEl.addEventListener('wheel', function (e) {
    if (!state.view) return;
    e.preventDefault();
    const rect = svgEl.getBoundingClientRect();
    const px = state.view.x + ((e.clientX - rect.left) / rect.width) * state.view.w;
    const py = state.view.y + ((e.clientY - rect.top) / rect.height) * state.view.h;
    zoomAt(px, py, e.deltaY > 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });

  svgEl.addEventListener('pointerdown', function (e) {
    if (e.button !== 0 || !state.view) return;
    svgEl.setPointerCapture(e.pointerId);
    svgEl.classList.add('dragging');
    state.drag = {
      x: e.clientX,
      y: e.clientY,
      startX: state.view.x,
      startY: state.view.y
    };
  });

  svgEl.addEventListener('pointermove', function (e) {
    if (!state.drag || !state.view) return;
    const rect = svgEl.getBoundingClientRect();
    const kx = state.view.w / rect.width;
    const ky = state.view.h / rect.height;
    state.view.x = state.drag.startX - (e.clientX - state.drag.x) * kx;
    state.view.y = state.drag.startY - (e.clientY - state.drag.y) * ky;
    applyView();
  });

  function endDrag(e) {
    if (!state.drag) return;
    state.drag = null;
    svgEl.classList.remove('dragging');
    try { svgEl.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }
  svgEl.addEventListener('pointerup', endDrag);
  svgEl.addEventListener('pointercancel', endDrag);

  $('zoom-in').addEventListener('click', function () {
    if (!state.view) return;
    zoomAt(state.view.x + state.view.w / 2, state.view.y + state.view.h / 2, 1 / 1.2);
  });
  $('zoom-out').addEventListener('click', function () {
    if (!state.view) return;
    zoomAt(state.view.x + state.view.w / 2, state.view.y + state.view.h / 2, 1.2);
  });
  $('zoom-fit').addEventListener('click', fitView);

  /* ---------- экспорт ---------- */

  function exportSvg() {
    if (!state.width) return '';
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + state.width +
      '" height="' + state.height + '" viewBox="0 0 ' + state.width + ' ' + state.height +
      '" font-family="' + R.FONT_FAMILY + '">' +
      '<rect x="0" y="0" width="' + state.width + '" height="' + state.height + '" fill="#ffffff"/>' +
      state.defs + state.content + '</svg>';
  }

  function download(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  $('btn-svg').addEventListener('click', function () {
    if (!state.width) { toast('Сначала постройте схему'); return; }
    download(state.fileName + '.svg', new Blob([exportSvg()], { type: 'image/svg+xml;charset=utf-8' }));
    toast('SVG сохранён');
  });

  $('btn-png').addEventListener('click', function () {
    if (!state.width) { toast('Сначала постройте схему'); return; }
    const MAX_SIDE = 16000;
    const MAX_AREA = 100000000;
    let scale = Math.min(
      2,
      MAX_SIDE / state.width,
      MAX_SIDE / state.height,
      Math.sqrt(MAX_AREA / (state.width * state.height))
    );
    scale = Math.max(0.1, scale);
    const svgText = exportSvg();
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = function () {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(state.width * scale);
      canvas.height = Math.round(state.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(function (b) {
        if (b) {
          download(state.fileName + '.png', b);
          toast('PNG сохранён');
        } else {
          toast('Не удалось создать PNG');
        }
      }, 'image/png');
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      toast('Не удалось создать PNG');
    };
    img.src = url;
  });

  /* ---------- редактор ---------- */

  codeEl.addEventListener('input', function () {
    if (examplesEl.value) examplesEl.value = '';
    updateLineNumbers();
    updateCodeStats();
    clearTimeout(state.timer);
    state.timer = setTimeout(build, 500);
  });

  codeEl.addEventListener('scroll', function () {
    lineNumbersEl.scrollTop = codeEl.scrollTop;
  });

  codeEl.addEventListener('keydown', function (e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = codeEl.selectionStart;
      const end = codeEl.selectionEnd;
      const value = codeEl.value;
      if (start !== end) {
        const selected = value.slice(start, end);
        const shifted = selected.split('\n').map(function (line) {
          return e.shiftKey ? line.replace(/^ {1,2}/, '') : '  ' + line;
        }).join('\n');
        codeEl.setRangeText(shifted, start, end, 'select');
      } else {
        codeEl.setRangeText('  ', start, end, 'end');
      }
      updateLineNumbers();
      updateCodeStats();
      clearTimeout(state.timer);
      state.timer = setTimeout(build, 500);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      build();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      $('btn-svg').click();
    }
  });

  btnBuild.addEventListener('click', build);

  /* ---------- примеры ---------- */

  (window.CPP_EXAMPLES || []).forEach(function (ex) {
    const opt = document.createElement('option');
    opt.value = ex.id;
    opt.textContent = ex.title;
    examplesEl.appendChild(opt);
  });

  examplesEl.addEventListener('change', function () {
    const found = (window.CPP_EXAMPLES || []).filter(function (x) { return x.id === examplesEl.value; })[0];
    if (!found) return;
    codeEl.value = found.code;
    state.active = 0;
    state.funcs = [];
    updateLineNumbers();
    updateCodeStats();
    build();
  });

  /* ---------- легенда ---------- */

  $('btn-legend').addEventListener('click', function () {
    if (typeof legendEl.showModal === 'function') legendEl.showModal();
    else legendEl.setAttribute('open', '');
  });
  $('btn-legend-close').addEventListener('click', function () { legendEl.close(); });
  legendEl.addEventListener('click', function (e) {
    const rect = legendEl.getBoundingClientRect();
    const inside = e.clientX >= rect.left && e.clientX <= rect.right &&
                   e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (!inside) legendEl.close();
  });

  /* ---------- запуск ---------- */

  function init() {
    let saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    const fallback = (window.CPP_EXAMPLES && window.CPP_EXAMPLES[0]) ? window.CPP_EXAMPLES[0].code : '';
    codeEl.value = saved || fallback;
    updateLineNumbers();
    updateCodeStats();
    build();
  }

  init();
})();
