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
  const diagramEditBtn = $('btn-diagram-edit');
  const selectionResetBtn = $('btn-selection-reset');
  const selectionDeleteBtn = $('btn-selection-delete');
  const undoBtn = $('btn-undo');
  const canvasHintEl = $('canvasHint');
  const blockTypeEl = $('block-type');
  const blockAddBtn = $('btn-block-add');
  const blockPropertiesBtn = $('btn-block-properties');
  const blockConnectBtn = $('btn-block-connect');
  const blockDialog = $('blockDialog');
  const blockForm = $('blockForm');
  const blockDialogType = $('block-dialog-type');
  const blockDialogLabel = $('block-dialog-label');

  const STORAGE_KEY = 'cpp-gost-flowchart-src-v1';
  const ROUTES_STORAGE_KEY = 'cpp-gost-flowchart-routes-v1';
  const BLOCKS_STORAGE_KEY = 'cpp-gost-flowchart-blocks-v1';

  const state = {
    funcs: [],
    active: 0,
    width: 0,
    height: 0,
    content: '',
    defs: '',
    view: null,
    drag: null,
    routeDrag: null,
    routeOverrides: readRouteOverrides(),
    manualGraphs: readManualGraphs(),
    undoStack: [],
    graphKeys: [],
    editRoutes: false,
    editBlocks: false,
    connectBlocks: false,
    selectedRoute: null,
    selectedNode: null,
    connectFrom: null,
    suppressBlockClickUntil: 0,
    nodeDrag: null,
    nodeResize: null,
    timer: null,
    fileName: 'block-shema'
  };

  /* ---------- служебное ---------- */

  let toastTimer = null;
  function readRouteOverrides() {
    try {
      const saved = JSON.parse(localStorage.getItem(ROUTES_STORAGE_KEY) || '{}');
      return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    } catch (e) {
      return {};
    }
  }

  function readManualGraphs() {
    try {
      const saved = JSON.parse(localStorage.getItem(BLOCKS_STORAGE_KEY) || '{}');
      return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    } catch (e) {
      return {};
    }
  }

  function saveManualGraphs() {
    try { localStorage.setItem(BLOCKS_STORAGE_KEY, JSON.stringify(state.manualGraphs)); }
    catch (e) { toast('Не удалось сохранить ручные правки блоков'); }
  }

  function pushUndoSnapshot() {
    state.undoStack.push({
      manualGraphs: JSON.parse(JSON.stringify(state.manualGraphs)),
      routeOverrides: JSON.parse(JSON.stringify(state.routeOverrides))
    });
    if (state.undoStack.length > 40) state.undoStack.shift();
    syncUndoButton();
  }

  function syncUndoButton() {
    undoBtn.disabled = state.undoStack.length === 0;
  }

  function undoLastChange() {
    const snapshot = state.undoStack.pop();
    if (!snapshot) return;
    state.manualGraphs = snapshot.manualGraphs;
    state.routeOverrides = snapshot.routeOverrides;
    state.selectedNode = null;
    state.selectedRoute = null;
    state.connectFrom = null;
    saveManualGraphs();
    saveRouteOverrides();
    renderDiagram();
    syncUndoButton();
    toast('Последнее изменение отменено');
  }

  function manualGraph(graphKey) {
    if (!state.manualGraphs[graphKey]) {
      state.manualGraphs[graphKey] = { edits: {}, added: [], edges: [], nextId: 1 };
    }
    const graph = state.manualGraphs[graphKey];
    graph.edits = graph.edits || {};
    graph.added = graph.added || [];
    graph.edges = graph.edges || [];
    graph.deletedRoutes = graph.deletedRoutes || {};
    graph.nextId = graph.nextId || 1;
    return graph;
  }

  function getGraphKey(fn) {
    const mode = state.active === -1 ? 'all' : 'single';
    return [
      sourceKey(codeEl.value), mode, state.funcs.indexOf(fn),
      fn.name, fn.params || ''
    ].map(encodeURIComponent).join(':');
  }

  function saveRouteOverrides() {
    try { localStorage.setItem(ROUTES_STORAGE_KEY, JSON.stringify(state.routeOverrides)); }
    catch (e) { toast('Не удалось сохранить ручные маршруты'); }
  }

  function sourceKey(source) {
    let hash = 2166136261;
    for (let i = 0; i < source.length; i++) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

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
    p.routeOverrides = state.routeOverrides;
    state.graphKeys = [];
    let cy = margin;
    diagrams.forEach(function (d, i) {
      const fn = list[i];
      const graphKey = getGraphKey(fn);
      state.graphKeys.push(graphKey);
      manualGraph(graphKey);
      p.routePrefix = graphKey;
      p.nodePrefix = graphKey;
      p.routeIndex = 0;
      p.nodeIndex = 0;
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
    state.graphKeys.forEach(applyNodeEdits);
    state.graphKeys.forEach(appendManualGraphContent);
    associateRoutesWithNodes();
    hideRoutesForDeletedNodes();
    if (state.selectedRoute && !findRoute(state.selectedRoute)) state.selectedRoute = null;
    if (state.selectedNode && !findNode(state.selectedNode)) state.selectedNode = null;
    renderRouteEditor();
    renderBlockEditor();
    fitView();
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function findNode(nodeId) {
    const nodes = svgEl.querySelectorAll('g[data-node-id]');
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute('data-node-id') === nodeId) return nodes[i];
    }
    return null;
  }

  function replaceNodeDrawing(group, type, label) {
    const bounds = {
      x: Number(group.getAttribute('data-node-x')),
      y: Number(group.getAttribute('data-node-y')),
      w: Number(group.getAttribute('data-node-w')),
      h: Number(group.getAttribute('data-node-h'))
    };
    const maxText = Math.max(30, bounds.w - 72);
    const maxLines = Math.max(1, Math.floor((bounds.h - 20) / R.LINE_H));
    const maxChars = Math.max(12, Math.floor(maxText / 7) * maxLines);
    const displayLabel = label.length > maxChars
      ? label.slice(0, maxChars - 1) + '…' : label;
    const painter = new R.Painter();
    painter.nodePrefix = group.getAttribute('data-graph-key');
    painter.nodeIdOverride = group.getAttribute('data-node-id');
    R.makeShapeNode(type, displayLabel, {
      minW: bounds.w, minH: bounds.h, maxText: maxText
    }).draw(
      painter, bounds.x, bounds.y
    );
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.innerHTML = painter.content();
    const replacement = svg.firstElementChild;
    if (!replacement) return;
    ['data-node-role', 'data-node-return'].forEach(function (name) {
      replacement.removeAttribute(name);
    });
    const keep = ['data-node-id', 'data-graph-key', 'data-node-x', 'data-node-y',
      'data-node-w', 'data-node-h', 'data-node-role', 'data-node-return',
      'data-node-dx', 'data-node-dy', 'transform', 'style'];
    keep.forEach(function (name) {
      const value = group.getAttribute(name);
      if (value != null) replacement.setAttribute(name, value);
    });
    replacement.setAttribute('data-node-type', type);
    replacement.setAttribute('data-node-label', label);
    group.replaceWith(replacement);
  }

  function applyNodeEdits(graphKey) {
    const graph = manualGraph(graphKey);
    const nodes = svgEl.querySelectorAll('g[data-node-id][data-graph-key]');
    nodes.forEach(function (node) {
      if (node.getAttribute('data-graph-key') !== graphKey) return;
      const id = node.getAttribute('data-node-id');
      const edit = graph.edits[id] || {};
      const baseLabel = node.getAttribute('data-node-label') || '';
      const baseType = node.getAttribute('data-node-type') || 'process';
      const baseW = Number(node.getAttribute('data-node-w'));
      const baseH = Number(node.getAttribute('data-node-h'));
      const label = edit.label == null ? baseLabel : edit.label;
      const type = edit.type || baseType;
      const width = Number(edit.w) || baseW;
      const height = Number(edit.h) || baseH;
      node.setAttribute('data-node-w', width);
      node.setAttribute('data-node-h', height);
      if (label !== baseLabel || type !== baseType || width !== baseW || height !== baseH) {
        replaceNodeDrawing(node, type, label);
      }
      const current = findNode(id);
      if (!current) return;
      const dx = Number(edit.dx) || 0;
      const dy = Number(edit.dy) || 0;
      current.setAttribute('data-node-dx', dx);
      current.setAttribute('data-node-dy', dy);
      if (dx || dy) current.setAttribute('transform', 'translate(' + dx + ' ' + dy + ')');
      else current.removeAttribute('transform');
      current.style.display = edit.hidden ? 'none' : '';
    });
  }

  function nodeBounds(node) {
    const dx = Number(node.getAttribute('data-node-dx')) || 0;
    const dy = Number(node.getAttribute('data-node-dy')) || 0;
    const x = Number(node.getAttribute('data-node-x')) + dx;
    const y = Number(node.getAttribute('data-node-y')) + dy;
    const w = Number(node.getAttribute('data-node-w'));
    const h = Number(node.getAttribute('data-node-h'));
    return { x: x, y: y, w: w, h: h, cx: x + w / 2, cy: y + h / 2 };
  }

  function nodeAtEndpoint(point, nodes) {
    let best = null;
    let distance = Infinity;
    nodes.forEach(function (node) {
      const b = nodeBounds(node);
      if (point[0] < b.x - 2 || point[0] > b.x + b.w + 2 ||
          point[1] < b.y - 2 || point[1] > b.y + b.h + 2) return;
      const d = Math.min(Math.abs(point[0] - b.x), Math.abs(point[0] - (b.x + b.w)),
        Math.abs(point[1] - b.y), Math.abs(point[1] - (b.y + b.h)));
      if (d < distance) { best = node; distance = d; }
    });
    return distance <= 2.5 ? best : null;
  }

  function associateRoutesWithNodes() {
    const nodes = Array.prototype.slice.call(svgEl.querySelectorAll('g[data-node-id]'));
    svgEl.querySelectorAll('path[data-route-id]').forEach(function (path) {
      const points = routePoints(path);
      if (points.length < 2) return;
      const source = nodeAtEndpoint(points[0], nodes);
      const target = nodeAtEndpoint(points[points.length - 1], nodes);
      if (source && !path.hasAttribute('data-source-node-id')) {
        path.setAttribute('data-source-node-id', source.getAttribute('data-node-id'));
      }
      if (target && !path.hasAttribute('data-target-node-id')) {
        path.setAttribute('data-target-node-id', target.getAttribute('data-node-id'));
      }
      if (target) path.setAttribute('marker-end', 'url(#gost-arrow)');
    });
  }

  function hideRoutesForDeletedNodes() {
    const hidden = {};
    svgEl.querySelectorAll('g[data-node-id]').forEach(function (node) {
      if (node.style.display === 'none') hidden[node.getAttribute('data-node-id')] = true;
    });
    svgEl.querySelectorAll('path[data-route-id]').forEach(function (path) {
      const routeId = path.getAttribute('data-route-id');
      const deleted = state.graphKeys.some(function (key) {
        const graph = manualGraph(key);
        return graph.deletedRoutes[routeId];
      });
      const attached = deleted || hidden[path.getAttribute('data-source-node-id')] ||
        hidden[path.getAttribute('data-target-node-id')];
      path.style.display = attached ? 'none' : '';
    });
  }

  function drawManualNode(graphKey, record) {
    const id = graphKey + ':manual:' + record.id;
    const painter = new R.Painter();
    painter.nodePrefix = graphKey;
    painter.nodeIdOverride = id;
    R.makeShapeNode(record.type, record.label).draw(painter, record.x, record.y);
    svgEl.insertAdjacentHTML('beforeend', painter.content());
  }

  function manualEdgeMarkup(graphKey, edge) {
    const id = graphKey + ':manual-edge:' + edge.id;
    const points = simplifyRoutePoints(state.routeOverrides[id] || edge.points);
    let d = R.roundedPath(points, 0);
    return '<path d="' + d + '" fill="none" stroke="' + R.COLORS.line +
      '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"' +
      ' data-route-style="straight"' +
      ' data-route-id="' + R.escapeXml(id) + '" data-route-points="' +
      R.escapeXml(JSON.stringify(points)) + '" data-route-default="' +
      R.escapeXml(JSON.stringify(edge.points)) + '" data-source-node-id="' +
      R.escapeXml(edge.src) + '" data-target-node-id="' + R.escapeXml(edge.dst) +
      '" marker-end="url(#gost-arrow)"/>';
  }

  function appendManualGraphContent(graphKey) {
    const graph = manualGraph(graphKey);
    graph.edges.forEach(function (edge) {
      svgEl.insertAdjacentHTML('beforeend', manualEdgeMarkup(graphKey, edge));
    });
    graph.added.forEach(function (record) { drawManualNode(graphKey, record); });
    applyNodeEdits(graphKey);
  }

  function renderBlockEditor() {
    svgEl.classList.toggle('block-edit-mode', state.editBlocks);
    const editing = state.editBlocks || state.editRoutes;
    diagramEditBtn.classList.toggle('active', editing);
    diagramEditBtn.setAttribute('aria-pressed', editing ? 'true' : 'false');
    diagramEditBtn.textContent = editing ? 'Готово' : 'Править схему';
    blockConnectBtn.classList.toggle('active', state.connectBlocks);
    blockConnectBtn.setAttribute('aria-pressed', state.connectBlocks ? 'true' : 'false');
    blockConnectBtn.textContent = state.connectBlocks ? 'Готово' : '+ Стрелка';
    svgEl.querySelectorAll('g.block-selected, g.connect-source').forEach(function (node) {
      node.classList.remove('block-selected', 'connect-source');
    });
    svgEl.querySelectorAll('.node-resize-handle').forEach(function (handle) { handle.remove(); });
    svgEl.querySelectorAll('.connection-port').forEach(function (port) { port.remove(); });
    const selected = state.selectedNode ? findNode(state.selectedNode) : null;
    if (selected && state.editBlocks) {
      selected.classList.add('block-selected');
      const bounds = nodeBounds(selected);
      const handle = document.createElementNS(SVG_NS, 'rect');
      handle.setAttribute('class', 'node-resize-handle');
      handle.setAttribute('data-node-id', selected.getAttribute('data-node-id'));
      handle.setAttribute('x', bounds.x + bounds.w - 5);
      handle.setAttribute('y', bounds.y + bounds.h - 5);
      handle.setAttribute('width', '10');
      handle.setAttribute('height', '10');
      handle.setAttribute('rx', '2');
      svgEl.appendChild(handle);
    }
    if (state.connectFrom) {
      const source = findNode(state.connectFrom.nodeId);
      if (source) source.classList.add('connect-source');
    }
    if (state.connectBlocks) {
      svgEl.querySelectorAll('g[data-node-id]').forEach(function (node) {
        const b = nodeBounds(node);
        const id = node.getAttribute('data-node-id');
        [['N', 0.2], ['N', 0.5], ['N', 0.8], ['E', 0.2], ['E', 0.5], ['E', 0.8],
          ['S', 0.2], ['S', 0.5], ['S', 0.8], ['W', 0.2], ['W', 0.5], ['W', 0.8]]
          .forEach(function (port) {
            const p = connectionPortPoint(b, port[0], port[1]);
            const circle = document.createElementNS(SVG_NS, 'circle');
            circle.setAttribute('class', 'connection-port');
            circle.setAttribute('data-node-id', id);
            circle.setAttribute('data-port-side', port[0]);
            circle.setAttribute('data-port-offset', port[1]);
            circle.setAttribute('cx', p[0]);
            circle.setAttribute('cy', p[1]);
            circle.setAttribute('r', '4');
            if (state.connectFrom && state.connectFrom.nodeId === id &&
                state.connectFrom.side === port[0] && state.connectFrom.offset === port[1]) {
              circle.classList.add('connection-port-selected');
            }
            svgEl.appendChild(circle);
          });
      });
    }
    const canEdit = !!selected && !selected.hasAttribute('data-node-role') && state.editBlocks;
    const canWork = state.editBlocks && state.active !== -1;
    blockPropertiesBtn.disabled = !canEdit;
    syncDeleteButton();
    syncResetButton();
    blockConnectBtn.disabled = !canWork;
    blockAddBtn.disabled = !canWork;
    blockTypeEl.disabled = !canWork;
    if (canvasHintEl) {
      canvasHintEl.textContent = !editing
        ? 'Колесо — масштаб · перетаскивание пустого места — сдвиг'
        : state.connectBlocks
          ? 'Стрелка: выберите точку выхода, затем точку входа на другом блоке'
          : 'Правка схемы: двигайте блоки, выбирайте стрелки для редактирования или добавляйте новые';
    }
  }

  function selectNode(node) {
    if (!state.editBlocks) return;
    const id = node.getAttribute('data-node-id');
    const graphKey = node.getAttribute('data-graph-key');
    if (state.connectBlocks) {
      selectConnectionPort(id, state.connectFrom ? 'N' : 'S', 0.5);
      return;
    }
    state.selectedRoute = null;
    renderRouteEditor();
    state.selectedNode = id;
    renderBlockEditor();
  }

  function syncDeleteButton() {
    const node = state.selectedNode && findNode(state.selectedNode);
    const route = state.selectedRoute && findRoute(state.selectedRoute);
    const deletableNode = state.editBlocks && node && !node.hasAttribute('data-node-role');
    const deletableRoute = state.editRoutes && route;
    selectionDeleteBtn.disabled = !(deletableNode || deletableRoute);
  }

  function graphHasEdits(graph) {
    return graph.added.length || graph.edges.length || Object.keys(graph.edits).some(function (id) {
      const edit = graph.edits[id];
      return edit && (edit.hidden || edit.label != null || edit.type || edit.dx || edit.dy || edit.w || edit.h);
    }) || Object.keys(graph.deletedRoutes).length;
  }

  function syncResetButton() {
    const prefix = sourceKey(codeEl.value) + ':';
    const hasGraphChanges = Object.keys(state.manualGraphs).some(function (key) {
      return key.indexOf(prefix) === 0 && graphHasEdits(manualGraph(key));
    });
    const hasRouteChanges = Object.keys(state.routeOverrides).some(function (id) {
      return id.indexOf(prefix) === 0;
    });
    selectionResetBtn.disabled = !(hasGraphChanges || hasRouteChanges);
    syncUndoButton();
  }

  function connectionPortPoint(bounds, side, offset) {
    const t = Math.max(0.12, Math.min(0.88, Number(offset) || 0.5));
    if (side === 'N') return [bounds.x + bounds.w * t, bounds.y];
    if (side === 'E') return [bounds.x + bounds.w, bounds.y + bounds.h * t];
    if (side === 'W') return [bounds.x, bounds.y + bounds.h * t];
    return [bounds.x + bounds.w * t, bounds.y + bounds.h];
  }

  function selectConnectionPort(nodeId, side, offset) {
    const node = findNode(nodeId);
    if (!node) return;
    const port = { nodeId: nodeId, side: side, offset: Number(offset) };
    if (!state.connectFrom) {
      state.connectFrom = port;
      state.selectedNode = nodeId;
      renderBlockEditor();
      toast('Теперь выберите точку входа на другом блоке');
      return;
    }
    if (state.connectFrom.nodeId === nodeId) {
      toast('Выберите точку на другом блоке');
      return;
    }
    const source = findNode(state.connectFrom.nodeId);
    if (!source || source.getAttribute('data-graph-key') !== node.getAttribute('data-graph-key')) {
      state.connectFrom = port;
      state.selectedNode = nodeId;
      renderBlockEditor();
      toast('Стрелку можно провести только между блоками одной функции');
      return;
    }
    addManualConnection(node.getAttribute('data-graph-key'), state.connectFrom, port);
    state.connectFrom = null;
    state.selectedNode = nodeId;
    renderDiagram();
    renderBlockEditor();
    toast('Стрелка добавлена');
  }

  function addManualConnection(graphKey, sourcePort, targetPort) {
    const source = findNode(sourcePort.nodeId);
    const target = findNode(targetPort.nodeId);
    if (!source || !target) return;
    const a = nodeBounds(source);
    const b = nodeBounds(target);
    const start = connectionPortPoint(a, sourcePort.side, sourcePort.offset);
    const end = connectionPortPoint(b, targetPort.side, targetPort.offset);
    const distance = 24;
    const outward = function (p, side) {
      if (side === 'N') return [p[0], p[1] - distance];
      if (side === 'E') return [p[0] + distance, p[1]];
      if (side === 'W') return [p[0] - distance, p[1]];
      return [p[0], p[1] + distance];
    };
    const from = outward(start, sourcePort.side);
    const to = outward(end, targetPort.side);
    const sourceVertical = sourcePort.side === 'N' || sourcePort.side === 'S';
    const targetVertical = targetPort.side === 'N' || targetPort.side === 'S';
    let points;
    if (sourceVertical && targetVertical) {
      const midY = (from[1] + to[1]) / 2;
      points = [start, from, [from[0], midY], [to[0], midY], to, end];
    } else if (!sourceVertical && !targetVertical) {
      const midX = (from[0] + to[0]) / 2;
      points = [start, from, [midX, from[1]], [midX, to[1]], to, end];
    } else {
      points = [start, from, [from[0], to[1]], to, end];
    }
    points = simplifyRoutePoints(points);
    pushUndoSnapshot();
    const graph = manualGraph(graphKey);
    graph.edges.push({
      id: String(graph.nextId++), src: sourcePort.nodeId, dst: targetPort.nodeId,
      points: points, straight: true
    });
    saveManualGraphs();
  }

  function addManualBlock() {
    if (!state.funcs.length) return;
    if (state.active === -1) {
      toast('Выберите отдельную функцию перед добавлением блока');
      return;
    }
    const graphKey = state.graphKeys[0];
    const graph = manualGraph(graphKey);
    const type = blockTypeEl.value;
    const defaults = {
      process: 'Действие', decision: 'Условие?', io: 'Ввод / вывод',
      predefined: 'Вызов функции', loop: 'Условие цикла', terminator: 'Блок'
    };
    const label = defaults[type] || 'Блок';
    const shape = R.makeShapeNode(type, label);
    const stagger = (graph.added.length % 4) * 18;
    const cx = state.width / 2 + stagger;
    const cy = state.height / 2 + stagger;
    const record = {
      id: String(graph.nextId++), type: type, label: label,
      x: Math.max(8, Math.min(state.width - shape.w - 8, cx - shape.w / 2)),
      y: Math.max(8, Math.min(state.height - shape.h - 8, cy - shape.h / 2)),
      w: shape.w, h: shape.h
    };
    pushUndoSnapshot();
    graph.added.push(record);
    saveManualGraphs();
    state.editBlocks = true;
    state.editRoutes = true;
    state.selectedNode = graphKey + ':manual:' + record.id;
    renderDiagram();
    renderRouteEditor();
    renderBlockEditor();
    toast('Блок добавлен; перетащите его в нужное место');
  }

  function editSelectedBlock() {
    const node = state.selectedNode && findNode(state.selectedNode);
    if (!node || node.hasAttribute('data-node-role')) return;
    blockDialogType.value = node.getAttribute('data-node-type') || 'process';
    blockDialogLabel.value = node.getAttribute('data-node-label') || '';
    if (typeof blockDialog.showModal === 'function') blockDialog.showModal();
    else blockDialog.setAttribute('open', '');
    blockDialogLabel.focus();
  }

  function saveSelectedBlock() {
    const node = state.selectedNode && findNode(state.selectedNode);
    if (!node || node.hasAttribute('data-node-role')) return;
    const graphKey = node.getAttribute('data-graph-key');
    const graph = manualGraph(graphKey);
    pushUndoSnapshot();
    graph.edits[state.selectedNode] = graph.edits[state.selectedNode] || {};
    graph.edits[state.selectedNode].label = blockDialogLabel.value.trim() || 'Блок';
    graph.edits[state.selectedNode].type = blockDialogType.value;
    saveManualGraphs();
    blockDialog.close();
    renderDiagram();
    renderBlockEditor();
  }

  function deleteSelectedBlock() {
    const node = state.selectedNode && findNode(state.selectedNode);
    if (!node || node.hasAttribute('data-node-role')) return;
    const graphKey = node.getAttribute('data-graph-key');
    const id = state.selectedNode;
    const graph = manualGraph(graphKey);
    pushUndoSnapshot();
    const addedIndex = graph.added.findIndex(function (item) {
      return id === graphKey + ':manual:' + item.id;
    });
    if (addedIndex >= 0) graph.added.splice(addedIndex, 1);
    else {
      graph.edits[id] = graph.edits[id] || {};
      graph.edits[id].hidden = true;
    }
    graph.edges = graph.edges.filter(function (edge) { return edge.src !== id && edge.dst !== id; });
    state.selectedNode = null;
    state.selectedRoute = null;
    if (state.connectFrom && state.connectFrom.nodeId === id) state.connectFrom = null;
    saveManualGraphs();
    renderDiagram();
    renderBlockEditor();
    toast('Блок удалён со схемы');
  }

  function resetManualDiagram() {
    const sourcePrefix = sourceKey(codeEl.value) + ':';
    const keys = Object.keys(state.manualGraphs).filter(function (key) {
      return key.indexOf(sourcePrefix) === 0;
    });
    const hasOverrides = Object.keys(state.routeOverrides).some(function (id) {
      return id.indexOf(sourcePrefix) === 0;
    });
    const hasChanges = hasOverrides || keys.some(function (key) { return graphHasEdits(manualGraph(key)); });
    if (!hasChanges) return;
    pushUndoSnapshot();
    keys.forEach(function (key) {
      delete state.manualGraphs[key];
    });
    Object.keys(state.routeOverrides).forEach(function (id) {
      if (id.indexOf(sourcePrefix) === 0) delete state.routeOverrides[id];
    });
    state.selectedNode = null;
    state.selectedRoute = null;
    state.connectFrom = null;
    saveManualGraphs();
    saveRouteOverrides();
    renderDiagram();
    toast('Все ручные правки для этого кода сброшены');
  }

  function resizePort(point, oldBounds, newBounds) {
    const distances = [
      { side: 'W', value: Math.abs(point[0] - oldBounds.x) },
      { side: 'E', value: Math.abs(point[0] - (oldBounds.x + oldBounds.w)) },
      { side: 'N', value: Math.abs(point[1] - oldBounds.y) },
      { side: 'S', value: Math.abs(point[1] - (oldBounds.y + oldBounds.h)) }
    ].sort(function (a, b) { return a.value - b.value; });
    switch (distances[0].side) {
      case 'W': return [newBounds.x, newBounds.cy];
      case 'E': return [newBounds.x + newBounds.w, newBounds.cy];
      case 'N': return [newBounds.cx, newBounds.y];
      default: return [newBounds.cx, newBounds.y + newBounds.h];
    }
  }

  function resizeRoute(points, sourceAttached, targetAttached, oldBounds, newBounds, original) {
    const out = points.map(function (p) { return [p[0], p[1]]; });
    function updateEnd(isStart) {
      const index = isStart ? 0 : out.length - 1;
      const neighbor = isStart ? 1 : out.length - 2;
      const oldPoint = out[index];
      const vertical = Math.abs(oldPoint[0] - out[neighbor][0]) < 0.5;
      const next = resizePort(oldPoint, oldBounds, newBounds);
      out[index] = next;
      if (vertical) out[neighbor][0] = next[0];
      else out[neighbor][1] = next[1];
    }
    if (sourceAttached) updateEnd(true);
    if (targetAttached) updateEnd(false);
    if (out.length === 2 && Math.abs(out[0][0] - out[1][0]) >= 0.5 &&
        Math.abs(out[0][1] - out[1][1]) >= 0.5) {
      const wasVertical = Math.abs(original[0][0] - original[1][0]) < 0.5;
      out.splice(1, 0, wasVertical ? [out[0][0], out[1][1]] : [out[1][0], out[0][1]]);
    }
    return out;
  }

  function resizeNode(drag, pointer) {
    const node = findNode(drag.nodeId);
    if (!node) return;
    const dx = pointer[0] - drag.startPointer[0];
    const dy = pointer[1] - drag.startPointer[1];
    const limits = {
      process: [122, 42], terminator: [130, 40], decision: [152, 64],
      io: [142, 44], predefined: [134, 44], loop: [144, 46]
    }[node.getAttribute('data-node-type')] || [122, 42];
    const maxW = Math.max(drag.startW, state.width - drag.oldBounds.x - 8);
    const maxH = Math.max(drag.startH, state.height - drag.oldBounds.y - 8);
    const width = Math.max(limits[0], Math.min(maxW, drag.startW + dx));
    const height = Math.max(limits[1], Math.min(maxH, drag.startH + dy));
    node.setAttribute('data-node-w', width);
    node.setAttribute('data-node-h', height);
    const graph = manualGraph(drag.graphKey);
    const edit = graph.edits[drag.nodeId] || {};
    const type = edit.type || node.getAttribute('data-node-type') || 'process';
    const label = edit.label == null ? node.getAttribute('data-node-label') || '' : edit.label;
    replaceNodeDrawing(node, type, label);
    const current = findNode(drag.nodeId);
    if (current && state.editBlocks) current.classList.add('block-selected');
    const newBounds = {
      x: drag.oldBounds.x, y: drag.oldBounds.y, w: width, h: height,
      cx: drag.oldBounds.x + width / 2, cy: drag.oldBounds.y + height / 2
    };
    drag.routes.forEach(function (item) {
      updateEditedRoute(item.id, resizeRoute(
        item.points, item.source === drag.nodeId, item.target === drag.nodeId,
        drag.oldBounds, newBounds, item.points
      ), false);
    });
    const handle = svgEl.querySelector('.node-resize-handle');
    if (handle && current) {
      handle.setAttribute('x', newBounds.x + width - 5);
      handle.setAttribute('y', newBounds.y + height - 5);
    }
  }

  function moveNode(drag, pointer) {
    const node = findNode(drag.nodeId);
    if (!node) return;
    const bounds = {
      x: Number(node.getAttribute('data-node-x')),
      y: Number(node.getAttribute('data-node-y')),
      w: Number(node.getAttribute('data-node-w')),
      h: Number(node.getAttribute('data-node-h'))
    };
    const dx = pointer[0] - drag.startPointer[0];
    const dy = pointer[1] - drag.startPointer[1];
    const nextDx = Math.max(-bounds.x, Math.min(state.width - bounds.x - bounds.w, drag.startDx + dx));
    const nextDy = Math.max(-bounds.y, Math.min(state.height - bounds.y - bounds.h, drag.startDy + dy));
    const actualDx = nextDx - drag.startDx;
    const actualDy = nextDy - drag.startDy;
    node.setAttribute('data-node-dx', nextDx);
    node.setAttribute('data-node-dy', nextDy);
    node.setAttribute('transform', 'translate(' + nextDx + ' ' + nextDy + ')');

    drag.routes.forEach(function (item) {
      const points = item.points.map(function (p) { return [p[0], p[1]]; });
      const startAttached = item.source === drag.nodeId;
      const endAttached = item.target === drag.nodeId;
      if (startAttached && endAttached) {
        points.forEach(function (p) { p[0] += actualDx; p[1] += actualDy; });
      } else if (points.length === 2 && (startAttached || endAttached)) {
        const start = points[0], end = points[1];
        if (startAttached) { start[0] += actualDx; start[1] += actualDy; }
        if (endAttached) { end[0] += actualDx; end[1] += actualDy; }
        if (Math.abs(item.points[0][0] - item.points[1][0]) < 0.5) {
          points.splice(0, 2, start, [start[0], end[1]], end);
        } else {
          points.splice(0, 2, start, [end[0], start[1]], end);
        }
      } else {
        if (startAttached) {
          const vertical = Math.abs(points[0][0] - points[1][0]) < 0.5;
          points[0][0] += actualDx; points[0][1] += actualDy;
          if (vertical) points[1][0] += actualDx; else points[1][1] += actualDy;
        }
        if (endAttached) {
          const last = points.length - 1;
          const vertical = Math.abs(points[last][0] - points[last - 1][0]) < 0.5;
          points[last][0] += actualDx; points[last][1] += actualDy;
          if (vertical) points[last - 1][0] += actualDx; else points[last - 1][1] += actualDy;
        }
      }
      updateEditedRoute(item.id, points, false);
    });
  }

  function findRoute(routeId) {
    const paths = svgEl.querySelectorAll('path[data-route-id]');
    for (let i = 0; i < paths.length; i++) {
      if (paths[i].getAttribute('data-route-id') === routeId) return paths[i];
    }
    return null;
  }

  function routePoints(path) {
    try { return JSON.parse(path.getAttribute('data-route-points') || '[]'); }
    catch (e) { return []; }
  }

  function addRouteHandle(routeId, type, index, x, y) {
    const handle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    handle.setAttribute('class', 'route-handle route-handle-' + type);
    handle.setAttribute('data-route-id', routeId);
    handle.setAttribute('data-route-handle', type);
    handle.setAttribute('data-route-index', index);
    handle.setAttribute('cx', x);
    handle.setAttribute('cy', y);
    handle.setAttribute('r', type === 'corner' ? '5.5' : '4');
    svgEl.appendChild(handle);
  }

  function followDraggedHandle(drag, pointer) {
    const handles = svgEl.querySelectorAll('.route-handle[data-route-id]');
    let handle = null;
    for (let i = 0; i < handles.length; i++) {
      if (handles[i].getAttribute('data-route-id') === drag.routeId &&
          handles[i].getAttribute('data-route-handle') === drag.type &&
          Number(handles[i].getAttribute('data-route-index')) === drag.index) {
        handle = handles[i];
        break;
      }
    }
    if (!handle) return;
    let x = pointer[0], y = pointer[1];
    if (drag.type === 'corner') {
      const path = findRoute(drag.routeId);
      const points = path ? routePoints(path) : [];
      let nearest = Infinity;
      for (let i = 1; i < points.length - 1; i++) {
        const prev = points[i - 1], cur = points[i], next = points[i + 1];
        const inV = Math.abs(prev[0] - cur[0]) < 0.5;
        const outV = Math.abs(cur[0] - next[0]) < 0.5;
        if (inV === outV) continue;
        const distance = Math.hypot(cur[0] - pointer[0], cur[1] - pointer[1]);
        if (distance < nearest) {
          nearest = distance;
          x = cur[0];
          y = cur[1];
        }
      }
    }
    handle.setAttribute('cx', x);
    handle.setAttribute('cy', y);
  }

  function renderRouteEditor() {
    svgEl.classList.toggle('route-edit-mode', state.editRoutes);
    svgEl.querySelectorAll('.route-handle').forEach(function (el) { el.remove(); });
    svgEl.querySelectorAll('path.route-selected').forEach(function (el) {
      el.classList.remove('route-selected');
    });

    const path = state.editRoutes && state.selectedRoute ? findRoute(state.selectedRoute) : null;
    syncDeleteButton();
    syncResetButton();
    if (!path) return;

    path.classList.add('route-selected');
    const points = routePoints(path);
    const routeId = path.getAttribute('data-route-id');
    for (let i = 1; i < points.length - 1; i++) {
      const prev = points[i - 1];
      const cur = points[i];
      const next = points[i + 1];
      const incomingVertical = Math.abs(prev[0] - cur[0]) < 0.5;
      const outgoingVertical = Math.abs(cur[0] - next[0]) < 0.5;
      if (incomingVertical !== outgoingVertical) {
        addRouteHandle(routeId, 'corner', i, cur[0], cur[1]);
      }
    }
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      addRouteHandle(routeId, 'segment', i, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    }
  }

  function simplifyRoutePoints(points) {
    const out = [];
    points.forEach(function (p) {
      const prev = out[out.length - 1];
      if (prev && Math.abs(prev[0] - p[0]) < 0.1 && Math.abs(prev[1] - p[1]) < 0.1) return;
      out.push([p[0], p[1]]);
      while (out.length >= 3) {
        const a = out[out.length - 3];
        const b = out[out.length - 2];
        const c = out[out.length - 1];
        if ((Math.abs(a[0] - b[0]) < 0.1 && Math.abs(b[0] - c[0]) < 0.1) ||
            (Math.abs(a[1] - b[1]) < 0.1 && Math.abs(b[1] - c[1]) < 0.1)) {
          out.splice(out.length - 2, 1);
        } else break;
      }
    });
    return out;
  }

  function updateEditedRoute(routeId, points, persist) {
    const path = findRoute(routeId);
    if (!path || points.length < 2) return;
    const clean = simplifyRoutePoints(points);
    path.setAttribute('d', R.roundedPath(clean,
      path.getAttribute('data-route-style') === 'straight' ? 0 : 7));
    path.setAttribute('data-route-points', JSON.stringify(clean));
    if (persist) {
      state.routeOverrides[routeId] = clean;
      saveRouteOverrides();
    }
  }

  function deleteSelectedRoute() {
    const routeId = state.selectedRoute;
    const path = routeId && findRoute(routeId);
    if (!state.editRoutes || !routeId || !path) return;
    const graphKey = state.graphKeys.find(function (key) {
      return routeId.indexOf(key + ':') === 0;
    });
    if (!graphKey) return;
    const graph = manualGraph(graphKey);
    pushUndoSnapshot();
    const edgePrefix = graphKey + ':manual-edge:';
    if (routeId.indexOf(edgePrefix) === 0) {
      const edgeId = routeId.slice(edgePrefix.length);
      graph.edges = graph.edges.filter(function (edge) { return String(edge.id) !== edgeId; });
    } else {
      graph.deletedRoutes[routeId] = true;
    }
    delete state.routeOverrides[routeId];
    state.selectedRoute = null;
    state.selectedNode = null;
    saveManualGraphs();
    saveRouteOverrides();
    renderDiagram();
    renderRouteEditor();
    toast('Стрелка удалена');
  }

  function deleteSelection() {
    if (state.selectedRoute && findRoute(state.selectedRoute)) deleteSelectedRoute();
    else deleteSelectedBlock();
  }

  function diagramPoint(e) {
    const matrix = svgEl.getScreenCTM();
    if (!matrix) return [state.view.x, state.view.y];
    const point = svgEl.createSVGPoint();
    point.x = e.clientX;
    point.y = e.clientY;
    const local = point.matrixTransform(matrix.inverse());
    return [local.x, local.y];
  }

  function moveRouteHandle(drag, pointer) {
    const points = drag.points.map(function (p) { return [p[0], p[1]]; });
    const i = drag.index;
    if (drag.type === 'corner') {
      const original = drag.points[i];
      const dx = pointer[0] - drag.startPointer[0];
      const dy = pointer[1] - drag.startPointer[1];
      const prev = drag.points[i - 1];
      const next = drag.points[i + 1];
      const incomingVertical = Math.abs(prev[0] - original[0]) < 0.5;
      const outgoingVertical = Math.abs(original[0] - next[0]) < 0.5;
      if (points.length === 3) {
        if (incomingVertical) {
          points.splice(0, 3,
            drag.points[0],
            [drag.points[0][0], original[1] + dy],
            [original[0] + dx, original[1] + dy],
            [original[0] + dx, drag.points[2][1]],
            drag.points[2]);
        } else {
          points.splice(0, 3,
            drag.points[0],
            [original[0] + dx, drag.points[0][1]],
            [original[0] + dx, original[1] + dy],
            [drag.points[2][0], original[1] + dy],
            drag.points[2]);
        }
      } else if (i === 1) {
        if (incomingVertical) {
          points[i][1] += dy;
          points[i + 1][1] = points[i][1];
        } else {
          points[i][0] += dx;
          points[i + 1][0] = points[i][0];
        }
      } else if (i === points.length - 2) {
        if (outgoingVertical) {
          points[i][1] += dy;
          points[i - 1][1] = points[i][1];
        } else {
          points[i][0] += dx;
          points[i - 1][0] = points[i][0];
        }
      } else {
        points[i][0] += dx;
        points[i][1] += dy;
        if (incomingVertical) {
          points[i - 1][0] = points[i][0];
          points[i + 1][1] = points[i][1];
        } else {
          points[i - 1][1] = points[i][1];
          points[i + 1][0] = points[i][0];
        }
      }
      updateEditedRoute(drag.routeId, points, false);
      followDraggedHandle(drag, pointer);
      return;
    }

    const a = drag.points[i];
    const b = drag.points[i + 1];
    if (Math.abs(a[1] - b[1]) < 0.5) {
      const y = (a[1] + b[1]) / 2 + pointer[1] - drag.startPointer[1];
      if (i > 0 && i + 1 < points.length - 1) {
        points[i][1] = y;
        points[i + 1][1] = y;
      } else {
        points.splice(i, 2, a, [a[0], y], [b[0], y], b);
      }
    } else {
      const x = (a[0] + b[0]) / 2 + pointer[0] - drag.startPointer[0];
      if (i > 0 && i + 1 < points.length - 1) {
        points[i][0] = x;
        points[i + 1][0] = x;
      } else {
        points.splice(i, 2, a, [x, a[1]], [x, b[1]], b);
      }
    }
    updateEditedRoute(drag.routeId, points, false);
    followDraggedHandle(drag, pointer);
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
    const connectionPort = state.connectBlocks && e.target.closest
      ? e.target.closest('.connection-port') : null;
    if (connectionPort) {
      e.preventDefault();
      e.stopPropagation();
      selectConnectionPort(
        connectionPort.getAttribute('data-node-id'),
        connectionPort.getAttribute('data-port-side'),
        Number(connectionPort.getAttribute('data-port-offset'))
      );
      return;
    }
    const handle = state.editRoutes && e.target.closest
      ? e.target.closest('.route-handle') : null;
    if (handle) {
      const routeId = handle.getAttribute('data-route-id');
      const path = findRoute(routeId);
      if (!path) return;
      e.preventDefault();
      e.stopPropagation();
      state.routeDrag = {
        routeId: routeId,
        type: handle.getAttribute('data-route-handle'),
        index: Number(handle.getAttribute('data-route-index')),
        points: routePoints(path),
        startPointer: diagramPoint(e),
        moved: false
      };
      svgEl.setPointerCapture(e.pointerId);
      return;
    }
    const resizeHandle = state.editBlocks && e.target.closest
      ? e.target.closest('.node-resize-handle') : null;
    if (resizeHandle) {
      const node = findNode(resizeHandle.getAttribute('data-node-id'));
      if (!node || node.hasAttribute('data-node-role')) return;
      e.preventDefault();
      e.stopPropagation();
      const bounds = nodeBounds(node);
      const routes = [];
      svgEl.querySelectorAll('path[data-route-id]').forEach(function (path) {
        const source = path.getAttribute('data-source-node-id');
        const target = path.getAttribute('data-target-node-id');
        if (source !== resizeHandle.getAttribute('data-node-id') &&
            target !== resizeHandle.getAttribute('data-node-id')) return;
        routes.push({
          id: path.getAttribute('data-route-id'), source: source, target: target,
          points: routePoints(path)
        });
      });
      state.nodeResize = {
        nodeId: resizeHandle.getAttribute('data-node-id'),
        graphKey: node.getAttribute('data-graph-key'),
        oldBounds: bounds,
        startW: bounds.w,
        startH: bounds.h,
        startPointer: diagramPoint(e),
        routes: routes,
        moved: false
      };
      svgEl.setPointerCapture(e.pointerId);
      return;
    }
    const node = state.editBlocks && e.target.closest
      ? e.target.closest('g[data-node-id]') : null;
    if (node) {
      if (state.connectBlocks) return;
      e.preventDefault();
      e.stopPropagation();
      selectNode(node);
      state.suppressBlockClickUntil = Date.now() + 350;
      const nodeId = node.getAttribute('data-node-id');
      const routes = [];
      svgEl.querySelectorAll('path[data-route-id]').forEach(function (path) {
        const source = path.getAttribute('data-source-node-id');
        const target = path.getAttribute('data-target-node-id');
        if (source !== nodeId && target !== nodeId) return;
        routes.push({
          id: path.getAttribute('data-route-id'),
          source: source,
          target: target,
          points: routePoints(path)
        });
      });
      state.nodeDrag = {
        nodeId: nodeId,
        graphKey: node.getAttribute('data-graph-key'),
        startDx: Number(node.getAttribute('data-node-dx')) || 0,
        startDy: Number(node.getAttribute('data-node-dy')) || 0,
        startPointer: diagramPoint(e),
        routes: routes,
        moved: false
      };
      svgEl.setPointerCapture(e.pointerId);
      return;
    }
    if (state.editRoutes && e.target.closest && e.target.closest('path[data-route-id]')) return;
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
    if (state.routeDrag && state.view) {
      state.routeDrag.moved = true;
      moveRouteHandle(state.routeDrag, diagramPoint(e));
      return;
    }
    if (state.nodeResize && state.view) {
      const point = diagramPoint(e);
      if (Math.hypot(point[0] - state.nodeResize.startPointer[0],
          point[1] - state.nodeResize.startPointer[1]) > 1.5) state.nodeResize.moved = true;
      resizeNode(state.nodeResize, point);
      return;
    }
    if (state.nodeDrag && state.view) {
      const point = diagramPoint(e);
      if (Math.hypot(point[0] - state.nodeDrag.startPointer[0],
          point[1] - state.nodeDrag.startPointer[1]) > 1.5) state.nodeDrag.moved = true;
      moveNode(state.nodeDrag, point);
      return;
    }
    if (!state.drag || !state.view) return;
    const rect = svgEl.getBoundingClientRect();
    const kx = state.view.w / rect.width;
    const ky = state.view.h / rect.height;
    state.view.x = state.drag.startX - (e.clientX - state.drag.x) * kx;
    state.view.y = state.drag.startY - (e.clientY - state.drag.y) * ky;
    applyView();
  });

  function endDrag(e) {
    if (state.nodeResize) {
      const drag = state.nodeResize;
      if (drag.moved) {
        pushUndoSnapshot();
        const graph = manualGraph(drag.graphKey);
        graph.edits[drag.nodeId] = graph.edits[drag.nodeId] || {};
        const node = findNode(drag.nodeId);
        if (node) {
          graph.edits[drag.nodeId].w = Number(node.getAttribute('data-node-w'));
          graph.edits[drag.nodeId].h = Number(node.getAttribute('data-node-h'));
        }
        drag.routes.forEach(function (item) {
          const path = findRoute(item.id);
          if (path) state.routeOverrides[item.id] = routePoints(path);
        });
        saveManualGraphs();
        saveRouteOverrides();
        state.suppressBlockClickUntil = Date.now() + 350;
      }
      state.nodeResize = null;
      renderBlockEditor();
      try { svgEl.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      return;
    }
    if (state.nodeDrag) {
      const drag = state.nodeDrag;
      if (drag.moved) {
        pushUndoSnapshot();
        const graph = manualGraph(drag.graphKey);
        graph.edits[drag.nodeId] = graph.edits[drag.nodeId] || {};
        const node = findNode(drag.nodeId);
        if (node) {
          graph.edits[drag.nodeId].dx = Number(node.getAttribute('data-node-dx')) || 0;
          graph.edits[drag.nodeId].dy = Number(node.getAttribute('data-node-dy')) || 0;
        }
        drag.routes.forEach(function (item) {
          const path = findRoute(item.id);
          if (path) state.routeOverrides[item.id] = routePoints(path);
        });
        saveManualGraphs();
        saveRouteOverrides();
        state.suppressBlockClickUntil = Date.now() + 350;
      }
      state.nodeDrag = null;
      renderBlockEditor();
      try { svgEl.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      return;
    }
    if (state.routeDrag) {
      const routeId = state.routeDrag.routeId;
      const path = findRoute(routeId);
      if (path && state.routeDrag.moved) {
        const points = routePoints(path);
        pushUndoSnapshot();
        updateEditedRoute(routeId, points, true);
      }
      state.routeDrag = null;
      renderRouteEditor();
      try { svgEl.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      return;
    }
    if (!state.drag) return;
    state.drag = null;
    svgEl.classList.remove('dragging');
    try { svgEl.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }
  svgEl.addEventListener('pointerup', endDrag);
  svgEl.addEventListener('pointercancel', endDrag);

  svgEl.addEventListener('click', function (e) {
    if (state.editBlocks && e.target.closest) {
      const node = e.target.closest('g[data-node-id]');
      if (node) {
        if (Date.now() < state.suppressBlockClickUntil) {
          state.suppressBlockClickUntil = 0;
          return;
        }
        selectNode(node);
        e.stopPropagation();
        return;
      }
    }
    if (!state.editRoutes || !e.target.closest) return;
    const path = e.target.closest('path[data-route-id]');
    if (!path) return;
    state.selectedNode = null;
    state.selectedRoute = path.getAttribute('data-route-id');
    renderRouteEditor();
    renderBlockEditor();
    e.stopPropagation();
  });

  svgEl.addEventListener('dblclick', function (e) {
    if (!state.editBlocks || !e.target.closest) return;
    const node = e.target.closest('g[data-node-id]');
    if (!node) return;
    state.selectedRoute = null;
    state.selectedNode = node.getAttribute('data-node-id');
    renderRouteEditor();
    renderBlockEditor();
    editSelectedBlock();
    e.preventDefault();
  });

  diagramEditBtn.addEventListener('click', function () {
    const editing = !(state.editBlocks || state.editRoutes);
    state.editBlocks = editing;
    state.editRoutes = editing;
    state.connectBlocks = false;
    state.connectFrom = null;
    state.selectedNode = null;
    state.selectedRoute = null;
    renderRouteEditor();
    renderBlockEditor();
    toast(editing
      ? 'Режим правки схемы включён: выбирайте блоки и стрелки'
      : 'Режим правки схемы выключен');
  });

  selectionResetBtn.addEventListener('click', resetManualDiagram);
  undoBtn.addEventListener('click', undoLastChange);
  selectionDeleteBtn.addEventListener('click', deleteSelection);

  blockAddBtn.addEventListener('click', addManualBlock);
  blockPropertiesBtn.addEventListener('click', editSelectedBlock);
  blockConnectBtn.addEventListener('click', function () {
    if (state.active === -1) return;
    state.connectBlocks = !state.connectBlocks;
    state.connectFrom = null;
    if (state.connectBlocks) state.selectedRoute = null;
    renderRouteEditor();
    renderBlockEditor();
    toast(state.connectBlocks
      ? 'Выберите точку выхода и точку входа на другом блоке'
      : 'Режим соединения выключен');
  });
  blockForm.addEventListener('submit', function (e) {
    e.preventDefault();
    saveSelectedBlock();
  });
  $('block-dialog-cancel').addEventListener('click', function () { blockDialog.close(); });

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
    const diagram = svgEl.cloneNode(true);
    diagram.querySelectorAll('.route-handle').forEach(function (el) { el.remove(); });
    diagram.querySelectorAll('.node-resize-handle').forEach(function (el) { el.remove(); });
    diagram.querySelectorAll('.connection-port').forEach(function (el) { el.remove(); });
    diagram.querySelectorAll('.route-selected').forEach(function (el) { el.classList.remove('route-selected'); });
    diagram.querySelectorAll('.block-selected, .connect-source').forEach(function (el) {
      el.classList.remove('block-selected', 'connect-source');
    });
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + state.width +
      '" height="' + state.height + '" viewBox="0 0 ' + state.width + ' ' + state.height +
      '" font-family="' + R.FONT_FAMILY + '">' +
      diagram.innerHTML + '</svg>';
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
