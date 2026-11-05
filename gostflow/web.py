"""Локальный веб-интерфейс: вставил код — получил блок-схему."""

from __future__ import annotations

import base64
import contextlib
import json
import os
import tempfile
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .api import FunctionNotFound, GostFlowError, generate_svg
from .render import svg_to_png


SAMPLE = r'''#include <iostream>

int main() {
    int n;
    std::cout << "Введите n: ";
    std::cin >> n;

    long long fact = 1;
    for (int i = 2; i <= n; i++) {
        fact *= i;
    }

    if (n < 0) {
        std::cout << "Ошибка: n < 0";
    } else {
        std::cout << "n! = " << fact;
    }
    return 0;
}
'''


_HTML = r'''<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>gostflow — блок-схемы по ГОСТ из C++</title>
<style>
  :root {
    --bg: #eef1f5;
    --panel: #ffffff;
    --border: #d9dee7;
    --text: #1c2430;
    --muted: #6b7280;
    --accent: #2563eb;
    --accent-dark: #1d4ed8;
    --danger: #b91c1c;
    --danger-bg: #fef2f2;
    --shadow: 0 1px 2px rgba(16,24,40,.05), 0 8px 24px rgba(16,24,40,.06);
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Liberation Sans", Arial, sans-serif;
    font-size: 14px;
  }
  header {
    height: 68px;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 0 20px;
    background: #111827;
    color: #f9fafb;
  }
  .logo {
    width: 38px; height: 38px; border-radius: 10px;
    background: #2563eb; display: grid; place-items: center;
    box-shadow: 0 0 0 1px rgba(255,255,255,.12) inset;
    flex: none;
  }
  .logo svg { width: 24px; height: 24px; }
  header h1 { font-size: 17px; line-height: 1.2; margin: 0; font-weight: 650; letter-spacing: .1px; }
  header p { margin: 2px 0 0; font-size: 12px; color: #9ca3af; }
  .badge {
    margin-left: auto; font-size: 11px; color: #cbd5e1;
    border: 1px solid rgba(255,255,255,.18); border-radius: 999px;
    padding: 5px 10px; white-space: nowrap;
  }
  main {
    height: calc(100vh - 68px);
    display: grid;
    grid-template-columns: minmax(340px, 44%) 1fr;
    gap: 16px;
    padding: 16px;
  }
  .panel {
    min-width: 0; min-height: 0;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: var(--shadow);
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  .panel-head {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    background: #fbfcfe;
    flex-wrap: wrap;
  }
  .panel-title { font-weight: 650; font-size: 13px; margin-right: 4px; }
  .hint { color: var(--muted); font-size: 12px; }
  .spacer { flex: 1; }
  textarea {
    flex: 1; width: 100%; resize: none; border: 0; outline: 0;
    padding: 14px 16px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
    font-size: 13px; line-height: 1.55; tab-size: 4;
    color: #111827; background: #fcfdff;
  }
  input[type="text"], select {
    height: 32px; border: 1px solid var(--border); border-radius: 7px;
    padding: 0 9px; font-size: 13px; color: var(--text); background: #fff;
    outline: none; max-width: 210px;
  }
  input[type="text"]:focus, select:focus { border-color: #93b4f7; box-shadow: 0 0 0 3px rgba(37,99,235,.12); }
  button {
    height: 32px; border-radius: 7px; border: 1px solid transparent;
    padding: 0 12px; font-size: 13px; font-weight: 550; cursor: pointer;
    background: #fff; color: var(--text);
    transition: background .12s, border-color .12s, transform .05s;
  }
  button:active { transform: translateY(1px); }
  button.primary { background: var(--accent); color: #fff; }
  button.primary:hover { background: var(--accent-dark); }
  button.secondary { border-color: var(--border); }
  button.secondary:hover { background: #f3f6fb; }
  button.ghost { color: var(--muted); }
  button.ghost:hover { background: #f3f6fb; color: var(--text); }
  button:disabled { opacity: .55; cursor: default; transform: none; }
  .editor-wrap { flex: 1; min-height: 0; display: flex; }
  .preview-wrap {
    flex: 1; min-height: 0; overflow: auto;
    background:
      linear-gradient(90deg, rgba(0,0,0,.025) 1px, transparent 1px) 0 0 / 22px 22px,
      linear-gradient(rgba(0,0,0,.025) 1px, transparent 1px) 0 0 / 22px 22px,
      #eef1f5;
    padding: 18px;
    display: flex; align-items: flex-start; justify-content: center;
  }
  #preview { width: 100%; display: flex; justify-content: center; }
  #preview svg {
    max-width: 100%; height: auto;
    background: #fff; border-radius: 6px;
    box-shadow: 0 2px 6px rgba(16,24,40,.08), 0 16px 40px rgba(16,24,40,.08);
  }
  .status {
    min-height: 34px; padding: 8px 12px;
    border-top: 1px solid var(--border);
    font-size: 12px; color: var(--muted);
    display: flex; align-items: center; gap: 8px;
    background: #fbfcfe;
  }
  .status.error { color: var(--danger); background: var(--danger-bg); white-space: pre-wrap; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #16a34a; flex: none; }
  .status.error .dot { background: var(--danger); }
  .empty {
    color: var(--muted); font-size: 13px; text-align: center;
    padding: 40px 20px; max-width: 360px; line-height: 1.5;
  }
  .footer-note { font-size: 11px; color: var(--muted); }
  @media (max-width: 900px) {
    main { grid-template-columns: 1fr; height: auto; }
    .panel { height: 46vh; }
    .panel.preview-panel { height: 54vh; }
    .badge { display: none; }
  }
</style>
</head>
<body>
<header>
  <div class="logo" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <rect x="7" y="2.5" width="10" height="5" rx="2.5"></rect>
      <path d="M12 7.5v3.5"></path>
      <path d="M12 11l-5.5 3.5v0"></path>
      <path d="M12 11l5.5 3.5v0"></path>
      <rect x="2" y="17" width="8" height="4.5" rx="1"></rect>
      <rect x="14" y="17" width="8" height="4.5" rx="1"></rect>
    </svg>
  </div>
  <div>
    <h1>gostflow</h1>
    <p>Блок-схемы по ГОСТ 19.701-90 из кода C++</p>
  </div>
  <div class="badge">локальный сервер · без отправки кода в сеть</div>
</header>

<main>
  <section class="panel">
    <div class="panel-head">
      <span class="panel-title">Исходный код</span>
      <span class="hint">Ctrl+Enter — построить</span>
      <span class="spacer"></span>
      <button class="ghost" id="sampleBtn" type="button">Пример</button>
    </div>
    <div class="editor-wrap">
      <textarea id="code" spellcheck="false" aria-label="Исходный код C++"></textarea>
    </div>
    <div class="panel-head" style="border-top:1px solid var(--border); border-bottom:0;">
      <label class="hint" for="func">Функция</label>
      <select id="func" aria-label="Функция"><option value="">main</option></select>
      <label class="hint" for="title">Заголовок</label>
      <input type="text" id="title" placeholder="необязательно">
      <span class="spacer"></span>
      <button class="primary" id="buildBtn" type="button">Построить</button>
    </div>
  </section>

  <section class="panel preview-panel">
    <div class="panel-head">
      <span class="panel-title">Блок-схема</span>
      <span class="hint" id="funcHint"></span>
      <span class="spacer"></span>
      <button class="secondary" id="svgBtn" type="button" disabled>Скачать SVG</button>
      <button class="secondary" id="pngBtn" type="button" disabled>Скачать PNG</button>
    </div>
    <div class="preview-wrap">
      <div id="preview">
        <div class="empty">Вставьте код C++ и нажмите «Построить».<br>Схема появится здесь.</div>
      </div>
    </div>
    <div class="status" id="status"><span class="dot"></span><span id="statusText">Готово к работе</span></div>
  </section>
</main>

<script>
const SAMPLE = __SAMPLE__;
const codeEl = document.getElementById('code');
const funcEl = document.getElementById('func');
const titleEl = document.getElementById('title');
const previewEl = document.getElementById('preview');
const statusEl = document.getElementById('status');
const statusTextEl = document.getElementById('statusText');
const buildBtn = document.getElementById('buildBtn');
const svgBtn = document.getElementById('svgBtn');
const pngBtn = document.getElementById('pngBtn');
const funcHint = document.getElementById('funcHint');

let lastSvg = null;
let lastFunction = 'main';

function setStatus(text, isError = false) {
  statusEl.classList.toggle('error', isError);
  statusTextEl.textContent = text;
}

function setBusy(busy) {
  buildBtn.disabled = busy;
  buildBtn.textContent = busy ? 'Строю…' : 'Построить';
}

function updateFunctions(functions, selected) {
  if (!Array.isArray(functions) || functions.length === 0) return;
  const current = selected || funcEl.value;
  funcEl.innerHTML = '';
  for (const f of functions) {
    const opt = document.createElement('option');
    opt.value = f.name;
    opt.textContent = f.name + ' (строка ' + f.line + ')';
    funcEl.appendChild(opt);
  }
  if (current && [...funcEl.options].some(o => o.value === current)) {
    funcEl.value = current;
  } else {
    funcEl.value = functions[0].name;
  }
}

async function buildDiagram(retried = false) {
  const code = codeEl.value;
  if (!code.trim()) {
    setStatus('Введите код C++', true);
    return;
  }
  setBusy(true);
  setStatus('Разбираю код и строю схему…');
  try {
    const res = await fetch('/api/render', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        code,
        function: funcEl.value || null,
        title: titleEl.value.trim() || null
      })
    });
    const data = await res.json();
    if (!data.ok) {
      // Выбор в списке устарел (функция из прошлого кода отсутствует) —
      // обновляем список и автоматически перестраиваем схему.
      if (data.missing_function && !retried && Array.isArray(data.available_functions)) {
        funcEl.innerHTML = '';
        for (const name of data.available_functions) {
          const opt = document.createElement('option');
          opt.value = name;
          opt.textContent = name;
          funcEl.appendChild(opt);
        }
        funcEl.value = '';
        setStatus('Функция «' + data.missing_function + '» в новом коде нет — выбираю автоматически…');
        return buildDiagram(true);
      }
      setStatus(data.error || 'Не удалось построить схему', true);
      return;
    }
    lastSvg = data.svg;
    lastFunction = data.function || 'main';
    previewEl.innerHTML = data.svg;
    updateFunctions(data.functions, lastFunction);
    funcHint.textContent = 'функция ' + lastFunction;
    svgBtn.disabled = false;
    pngBtn.disabled = false;
    const lines = code.split('\n').length;
    setStatus((data.note ? data.note + '. ' : '') +
      'Готово: функция ' + lastFunction + ', ' + lines + ' строк кода');
  } catch (err) {
    setStatus('Ошибка соединения с сервером: ' + err, true);
  } finally {
    setBusy(false);
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

svgBtn.addEventListener('click', () => {
  if (!lastSvg) return;
  downloadBlob(new Blob([lastSvg], {type: 'image/svg+xml;charset=utf-8'}), lastFunction + '.svg');
});

pngBtn.addEventListener('click', async () => {
  if (!lastSvg) return;
  pngBtn.disabled = true;
  const old = pngBtn.textContent;
  pngBtn.textContent = 'Готовлю PNG…';
  try {
    const res = await fetch('/api/render', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        code: codeEl.value,
        function: lastFunction,
        title: titleEl.value.trim() || null,
        format: 'png'
      })
    });
    const data = await res.json();
    if (!data.ok) {
      setStatus(data.error || 'Не удалось создать PNG', true);
      return;
    }
    const bytes = Uint8Array.from(atob(data.png), c => c.charCodeAt(0));
    downloadBlob(new Blob([bytes], {type: 'image/png'}), lastFunction + '.png');
    setStatus('PNG готов');
  } catch (err) {
    setStatus('Ошибка при создании PNG: ' + err, true);
  } finally {
    pngBtn.disabled = false;
    pngBtn.textContent = old;
  }
});

document.getElementById('sampleBtn').addEventListener('click', () => {
  codeEl.value = SAMPLE;
  titleEl.value = '';
  buildDiagram();
});

buildBtn.addEventListener('click', buildDiagram);
codeEl.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    buildDiagram();
  }
});

codeEl.value = SAMPLE;
buildDiagram();
</script>
</body>
</html>
'''


class Handler(BaseHTTPRequestHandler):
    server_version = "gostflow/1.0"

    def log_message(self, fmt: str, *args) -> None:  # noqa: A003
        # Не засоряем консоль каждым запросом.
        return

    def _send(self, status: int, content_type: str, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except BrokenPipeError:
            pass

    def _json(self, obj: dict, status: int = 200) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self._send(status, "application/json; charset=utf-8", body)

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path == "/":
            html = _HTML.replace("__SAMPLE__", json.dumps(SAMPLE, ensure_ascii=False))
            self._send(200, "text/html; charset=utf-8", html.encode("utf-8"))
        elif path == "/api/sample":
            self._json({"ok": True, "code": SAMPLE})
        elif path == "/favicon.ico":
            self._send(204, "image/x-icon", b"")
        else:
            self._send(404, "text/plain; charset=utf-8", "Не найдено".encode("utf-8"))

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path != "/api/render":
            self._send(404, "text/plain; charset=utf-8", "Не найдено".encode("utf-8"))
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > 2_000_000:
            self._json({"ok": False, "error": "Пустой или слишком большой запрос"}, 413)
            return

        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            self._json({"ok": False, "error": f"Некорректный JSON: {exc}"}, 400)
            return

        code = payload.get("code", "")
        if not isinstance(code, str) or not code.strip():
            self._json({"ok": False, "error": "Исходный код пуст"}, 400)
            return

        function = payload.get("function")
        title = payload.get("title")
        fmt = payload.get("format", "svg")
        line_numbers = bool(payload.get("line_numbers", False))

        try:
            note: str | None = None
            try:
                svg, functions, func = generate_svg(
                    code, function=function, title=title, line_numbers=line_numbers
                )
            except FunctionNotFound as exc:
                # Выбор функции в интерфейсе устарел (функции нет в новом
                # коде) — строим автоматически, а не возвращаем ошибку.
                svg, functions, func = generate_svg(
                    code, function=None, title=title, line_numbers=line_numbers
                )
                note = f"Функции «{exc.name}» в этом коде нет, построено: {func.name}"

            funcs_payload = [
                {"name": f.name, "line": f.line, "params": f.params} for f in functions
            ]
            if fmt == "png":
                # Обычный путь, а не NamedTemporaryFile: сторонний конвертер
                # (rsvg-convert/ImageMagick) пишет файл заново по имени.
                fd, png_path = tempfile.mkstemp(suffix=".png")
                os.close(fd)
                try:
                    svg_to_png(svg, png_path, scale=2.0)
                    with open(png_path, "rb") as fh:
                        data = fh.read()
                finally:
                    with contextlib.suppress(OSError):
                        os.unlink(png_path)
                self._json(
                    {
                        "ok": True,
                        "png": base64.b64encode(data).decode("ascii"),
                        "function": func.name,
                        "functions": funcs_payload,
                        "note": note,
                    }
                )
            else:
                self._json(
                    {
                        "ok": True,
                        "svg": svg,
                        "function": func.name,
                        "functions": funcs_payload,
                        "note": note,
                    }
                )
        except GostFlowError as exc:
            self._json({"ok": False, "error": str(exc)})
        except Exception as exc:  # noqa: BLE001
            self._json({"ok": False, "error": f"Ошибка построения: {exc}"})


def serve(host: str = "127.0.0.1", port: int = 8000, open_browser: bool = False) -> None:
    httpd = ThreadingHTTPServer((host, port), Handler)
    url = f"http://{host}:{port}/"
    print(f"gostflow: {url}")
    print("Остановить — Ctrl+C")
    if open_browser:
        webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nОстановлено.")
    finally:
        httpd.server_close()
