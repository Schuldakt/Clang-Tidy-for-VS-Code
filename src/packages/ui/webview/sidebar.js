const vscode = acquireVsCodeApi();

window.onerror = function (message, source, lineno, colno, error) {
  vscode.postMessage({
    command: 'log',
    text: 'Global JS Error: ' + message + ' at line ' + lineno,
  });
};

// Safe event binder to prevent null reference crashes
function safeListen(id, event, handler) {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener(event, handler);
  } else {
    vscode.postMessage({ command: 'log', text: `Warning: Missing DOM element: ${id}` });
  }
}

// Returns the effective flex-grow of a pane (inline style takes precedence).
function getPaneFlexGrow(pane) {
  const flex = pane.style.flex;
  if (flex && flex !== 'none' && flex !== '') {
    const v = parseFloat(flex);
    if (!isNaN(v) && v > 0) return v;
  }
  const computed = parseFloat(getComputedStyle(pane).flexGrow);
  return !isNaN(computed) && computed > 0 ? computed : 1;
}

// Sets flex-grow via the shorthand so it can't be shadowed by lingering
// individual flex-grow / flex-shrink / flex-basis inline properties.
function setPaneFlexGrow(pane, grow) {
  pane.style.flex = `${grow} 1 0%`;
}

function setupCollapse(headerId, paneId) {
  const header = document.getElementById(headerId);
  const pane = document.getElementById(paneId);
  if (!header || !pane) return;

  let collapsed = false;
  header.addEventListener('click', (e) => {
    if (e.target.closest('.btn') || e.target.closest('button')) return;
    collapsed = !collapsed;
    if (!collapsed) {
      // Restore the flex-grow that was saved when the pane was collapsed.
      setPaneFlexGrow(pane, parseFloat(pane.dataset.savedFlex) || 1);
    } else {
      pane.dataset.savedFlex = String(getPaneFlexGrow(pane));
    }
    pane.classList.toggle('collapsed', collapsed);
  });
}

function setupDrag(handleId, topPaneId, botPaneId) {
  const handle = document.getElementById(handleId);
  const topPane = document.getElementById(topPaneId);
  const botPane = document.getElementById(botPaneId);
  if (!handle || !topPane || !botPane) return;

  let dragging = false,
    startY = 0,
    startTH = 0,
    startBH = 0,
    S = 0,
    T = 0;
  let effectiveTop = topPane,
    effectiveBot = botPane;

  // When a pane adjacent to this handle is collapsed, skip it and find the
  // nearest non-collapsed pane in that direction so the handle stays useful.
  function resolveEffectivePanes() {
    const all = Array.from(handle.parentElement.querySelectorAll('.pane'));
    if (topPane.classList.contains('collapsed')) {
      const i = all.indexOf(topPane);
      effectiveTop = null;
      for (let j = i - 1; j >= 0; j--) {
        if (!all[j].classList.contains('collapsed')) {
          effectiveTop = all[j];
          break;
        }
      }
    } else {
      effectiveTop = topPane;
    }
    if (botPane.classList.contains('collapsed')) {
      const i = all.indexOf(botPane);
      effectiveBot = null;
      for (let j = i + 1; j < all.length; j++) {
        if (!all[j].classList.contains('collapsed')) {
          effectiveBot = all[j];
          break;
        }
      }
    } else {
      effectiveBot = botPane;
    }
  }

  handle.addEventListener('mousedown', (e) => {
    resolveEffectivePanes();
    if (!effectiveTop || !effectiveBot) return; // nothing to resize on one side
    dragging = true;
    startY = e.clientY;
    startTH = effectiveTop.getBoundingClientRect().height;
    startBH = effectiveBot.getBoundingClientRect().height;
    S = 0;
    T = 0;
    for (const p of handle.parentElement.querySelectorAll('.pane')) {
      if (!p.classList.contains('collapsed')) {
        S += p.getBoundingClientRect().height;
        T += getPaneFlexGrow(p);
      }
    }
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ns-resize';
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging || S === 0) return;
    const dy = e.clientY - startY;
    const min = 30;
    const newTH = Math.max(min, Math.min(startTH + startBH - min, startTH + dy));
    setPaneFlexGrow(effectiveTop, (newTH / S) * T);
    setPaneFlexGrow(effectiveBot, ((startTH + startBH - newTH) / S) * T);
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  });
}

// ── Wrap setup in an init function ──
function init() {
  setupCollapse('hdr-fixes', 'pane-fixes');
  setupCollapse('hdr-history', 'pane-history');
  setupCollapse('hdr-checks', 'pane-checks');
  setupCollapse('hdr-settings', 'pane-settings');

  setupDrag('drag-1', 'pane-fixes', 'pane-history');
  setupDrag('drag-2', 'pane-history', 'pane-checks');
  setupDrag('drag-3', 'pane-checks', 'pane-settings');

  safeListen('refresh-btn', 'click', (e) => {
    e.stopPropagation();
    vscode.postMessage({ command: 'refresh' });
  });
  safeListen('apply-all-btn', 'click', (e) => {
    e.stopPropagation();
    vscode.postMessage({ command: 'applyAll' });
  });
  safeListen('dismiss-all-btn', 'click', (e) => {
    e.stopPropagation();
    vscode.postMessage({ command: 'dismissAll' });
  });
  safeListen('clear-history-btn', 'click', (e) => {
    e.stopPropagation();
    vscode.postMessage({ command: 'clearHistory' });
  });

  safeListen('checks-search', 'input', (e) => {
    const q = e.target.value.toLowerCase();
    document
      .querySelectorAll('#checks-list .check-row, #checks-list .check-option')
      .forEach((el) => {
        el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
  });

  wire('s-fixOnSave', 'fixOnSave', (el) => el.checked);
  wire('s-fixTimeoutMs', 'fixTimeoutMs', (el) => parseInt(el.value) || 3000);
  wire('s-checksFilter', 'checksFilter', (el) =>
    el.value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  wire('s-blacklist', 'blacklist', (el) =>
    el.value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

// ── Execute immediately if DOM is already parsed ──
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// ── Helpers ──
function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function makeDiff(before, after) {
  const rows = [
    ...String(before || '')
      .split(/\r?\n/)
      .map((l) => ({ t: 'minus', l })),
    ...String(after || '')
      .split(/\r?\n/)
      .map((l) => ({ t: 'plus', l })),
  ];
  return (
    '<div class="diff-block">' +
    rows
      .map(
        (r) =>
          '<div class="diff-line ' +
          r.t +
          '"><span class="diff-gutter">' +
          (r.t === 'minus' ? '-' : '+') +
          '</span><span class="diff-text">' +
          esc(r.l) +
          '</span></div>',
      )
      .join('') +
    '</div>'
  );
}

const diffCache = new Map();

function renderPending(fixes) {
  fixes = fixes || [];
  const container = document.getElementById('pending-files-container');
  const emptyEl = document.getElementById('pending-empty');
  emptyEl.style.display = fixes.length === 0 ? 'block' : 'none';

  const grouped = fixes.reduce((acc, f) => {
    (acc[f.filePath] = acc[f.filePath] || []).push(f);
    return acc;
  }, {});

  // Remove file panels that no longer have fixes
  Array.from(container.querySelectorAll('.file-panel')).forEach((panel) => {
    if (!grouped[panel.dataset.path]) panel.remove();
  });

  Object.entries(grouped).forEach(([filePath, fileFixes]) => {
    let panel = container.querySelector(`[data-path="${CSS.escape(filePath)}"]`);

    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'file-panel';
      panel.dataset.path = filePath;
      panel.innerHTML = `
        <div class="file-header">
          <span class="arrow">▾</span>
          <span class="file-name">${esc(filePath.split(/[\\/]/).pop())}</span>
          <span class="file-count"></span>
          <div class="file-actions">
            <button class="btn apply file-apply-btn" title="Apply all fixes in this file">✓ All</button>
            <button class="btn dismiss file-dismiss-btn" title="Dismiss all fixes in this file">✕ All</button>
          </div>
        </div>
        <div class="file-content"></div>
      `;
      panel
        .querySelector('.file-header')
        .addEventListener('click', () => panel.classList.toggle('collapsed'));
      panel.querySelector('.file-apply-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        vscode.postMessage({ command: 'applyFile', filePath });
      });
      panel.querySelector('.file-dismiss-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        vscode.postMessage({ command: 'dismissFile', filePath });
      });
      container.appendChild(panel);
    }

    panel.querySelector('.file-count').textContent = fileFixes.length;
    const content = panel.querySelector('.file-content');

    // 1. Remove cards that are no longer in the new set
    Array.from(content.querySelectorAll('.fix-card')).forEach((card) => {
      if (!fileFixes.find((f) => f.id === card.dataset.id)) card.remove();
    });

    // 2. Only Add/Update cards that don't exist
    fileFixes.forEach((fix) => {
      let card = content.querySelector(`[data-id="${CSS.escape(fix.id)}"]`);

      if (!card) {
        // Memoize: get diff from cache or calculate once
        const cacheKey = fix.id + fix.before + fix.after;
        if (!diffCache.has(cacheKey)) {
          diffCache.set(cacheKey, makeDiff(fix.before, fix.after));
        }

        card = document.createElement('div');
        card.className = 'fix-card';
        card.dataset.id = fix.id;
        card.innerHTML = `
          <div class="fix-card-header">
            <span class="fix-check">${esc(fix.checkName)}</span>
            <div class="fix-card-actions">
              <button class="icon-btn apply-btn" title="Apply fix">✓</button>
              <button class="icon-btn dismiss-btn" title="Insert NOLINT">✕</button>
              <button class="icon-btn disable-btn" title="Disable check">⊘</button>
            </div>
          </div>
          <span class="fix-loc" data-path="${esc(fix.filePath)}" data-line="${fix.line}">Line ${fix.line}</span>
          ${diffCache.get(cacheKey)}
        `;

        // Attach listeners only once when the card is created
        card
          .querySelector('.apply-btn')
          .addEventListener('click', () => vscode.postMessage({ command: 'applyFix', id: fix.id }));
        card
          .querySelector('.dismiss-btn')
          .addEventListener('click', () =>
            vscode.postMessage({ command: 'dismissFix', id: fix.id }),
          );
        card.querySelector('.disable-btn').addEventListener('click', () =>
          vscode.postMessage({
            command: 'disableCheck',
            checkName: fix.checkName,
            filePath: fix.filePath,
          }),
        );
        card.querySelector('.fix-loc').addEventListener('click', () =>
          vscode.postMessage({
            command: 'openFile',
            filePath: fix.filePath,
            line: parseInt(fix.line),
          }),
        );

        content.appendChild(card);
      }
    });
  });
}

function renderHistory(entries) {
  entries = entries || [];
  const countEl = document.getElementById('history-count');
  if (countEl) countEl.textContent = entries.length;

  const body = document.getElementById('history-body');
  if (!body) return;

  Array.from(body.querySelectorAll('.history-entry')).forEach((el) => el.remove());

  const emptyEl = document.getElementById('history-empty');
  if (emptyEl) emptyEl.style.display = entries.length === 0 ? 'block' : 'none';

  entries.forEach((entry) => {
    const div = document.createElement('div');
    div.className = 'history-entry' + (entry.dismissed ? ' dismissed-entry' : '');
    const undoTitle = entry.dismissed ? 'Re-enable (remove NOLINT)' : 'Undo this fix';
    const canUndo = !entry.dismissed || !!entry.nolintRevert;
    div.innerHTML =
      '<div class="history-header">' +
      '<span class="history-check" title="' +
      esc(entry.checkName) +
      '">' +
      esc(entry.checkName) +
      '</span>' +
      (entry.dismissed ? '<span class="dismissed-badge">dismissed</span>' : '') +
      (canUndo ? '<button class="icon-btn undo-btn" title="' + undoTitle + '">↩</button>' : '') +
      '<span class="history-loc" data-path="' +
      esc(entry.filePath) +
      '" data-line="' +
      entry.line +
      '">' +
      esc(entry.relPath) +
      ':' +
      entry.line +
      '</span>' +
      '</div>' +
      makeDiff(entry.before, entry.after) +
      '<div class="entry-time">' +
      fmtTime(entry.timestamp) +
      '</div>';

    div
      .querySelector('.undo-btn')
      .addEventListener('click', () => vscode.postMessage({ command: 'undoFix', id: entry.id }));
    div.querySelector('.history-loc').addEventListener('click', (e) =>
      vscode.postMessage({
        command: 'openFile',
        filePath: e.target.dataset.path,
        line: parseInt(e.target.dataset.line),
      }),
    );
    body.appendChild(div);
  });
}

function renderChecks(resolved) {
  const list = document.getElementById('checks-list');
  const empty = document.getElementById('checks-empty');
  const countEl = document.getElementById('checks-count');
  const label = document.getElementById('checks-file-label');
  if (!list || !empty || !countEl || !label) return;

  Array.from(
    list.querySelectorAll(
      '.check-row,.check-option,.check-option-row,.check-options-header,.config-header',
    ),
  ).forEach((el) => el.remove());

  const configs = resolved?.configs || [];
  const effectiveChecks = resolved?.effectiveChecks || [];

  if (configs.length === 0 && effectiveChecks.length === 0) {
    empty.style.display = 'block';
    countEl.textContent = '0';
    label.textContent = '';
    return;
  }
  empty.style.display = 'none';

  const enabledCount = effectiveChecks.filter((c) => c.enabled).length;
  countEl.textContent = enabledCount + '/' + effectiveChecks.length;
  if (configs.length > 0) {
    label.textContent = configs.length + ' config' + (configs.length > 1 ? 's' : '');
    label.style.opacity = '0.6';
  }

  // Group effective checks by which config file defined them.
  const bySource = new Map();
  for (const check of effectiveChecks) {
    const arr = bySource.get(check.definedIn) ?? [];
    arr.push(check);
    bySource.set(check.definedIn, arr);
  }

  // Render one section per config (parent → child order for readability).
  for (const cfg of [...configs].reverse()) {
    const sourcePath = cfg.relPath || cfg.filePath;

    // ── Config header with Edit link ────────────────────────────────────────
    // Use relPath for an exact match — avoids the endsWith('.clang-tidy') bug
    // that made every Edit button link to whichever config happened to be first.
    const cfgRow = document.createElement('div');
    cfgRow.className = 'config-header';
    cfgRow.innerHTML =
      '<span>' +
      esc(sourcePath) +
      '</span>' +
      (cfg.filePath
        ? '<span class="open-link" data-path="' + esc(cfg.filePath) + '">Edit ↗</span>'
        : '');
    if (cfg.filePath) {
      cfgRow.querySelector('.open-link').addEventListener('click', (e) => {
        e.stopPropagation();
        vscode.postMessage({ command: 'openConfigFile', filePath: e.target.dataset.path });
      });
    }
    list.appendChild(cfgRow);

    // ── Effective checks defined in this config ──────────────────────────────
    const checksForConfig = bySource.get(sourcePath) || [];
    checksForConfig.forEach((check) => {
      const row = document.createElement('div');
      row.className = 'check-row';
      row.innerHTML =
        '<span class="check-name-cell ' +
        (check.enabled ? 'check-enabled' : 'check-disabled') +
        '">' +
        esc((check.enabled ? '' : '-') + check.name) +
        '</span>';
      list.appendChild(row);

      // Per-check options (for explicitly-named checks like readability-identifier-naming)
      (check.options || []).forEach((o) => {
        const opt = document.createElement('div');
        opt.className = 'check-option';
        opt.innerHTML = '<span class="check-key">' + esc(o.key) + '</span>: ' + esc(o.value);
        list.appendChild(opt);
      });
    });

    // ── Raw CheckOptions from this config file ───────────────────────────────
    // These are always shown regardless of whether the check name appears in
    // the Checks list (many configs use wildcards but set options explicitly).
    const rawOpts = cfg.checkOptions || [];
    if (rawOpts.length > 0) {
      const optHdr = document.createElement('div');
      optHdr.className = 'check-options-header';
      optHdr.textContent = 'Check Options (' + rawOpts.length + ')';
      list.appendChild(optHdr);

      rawOpts.forEach((o) => {
        const row = document.createElement('div');
        row.className = 'check-option-row';
        row.innerHTML =
          '<span class="check-key">' +
          esc(o.key) +
          '</span>' +
          '<span class="check-option-sep">:</span>' +
          '<span class="check-option-val">' +
          esc(o.value) +
          '</span>';
        list.appendChild(row);
      });
    }
  }
}

function applySettings(s) {
  s = s || {};
  const g = (id) => document.getElementById(id);
  if (g('s-fixOnSave')) g('s-fixOnSave').checked = !!s.fixOnSave;
  if (g('s-fixTimeoutMs')) g('s-fixTimeoutMs').value = s.fixTimeoutMs ?? 3000;
  if (g('s-checksFilter')) g('s-checksFilter').value = s.checksFilter ?? '';
  if (g('s-blacklist')) g('s-blacklist').value = s.blacklist ?? '';
}

function wire(id, key, fn) {
  const el = document.getElementById(id);
  if (el)
    el.addEventListener('change', () =>
      vscode.postMessage({ command: 'setSetting', key, value: fn(el) }),
    );
}

window.addEventListener('message', (event) => {
  try {
    const msg = event.data;
    if (msg.command === 'updatePending') renderPending(msg.fixes);
    if (msg.command === 'updateHistory') renderHistory(msg.entries);
    if (msg.command === 'updateChecks') renderChecks(msg.resolved);
    if (msg.command === 'allSettings') applySettings(msg.settings);
    if (msg.command === 'setScanning') {
      const indicator = document.getElementById('scanning-indicator');
      const emptyMsg = document.getElementById('pending-empty');
      if (indicator) indicator.style.display = msg.value ? 'block' : 'none';
      if (msg.value && emptyMsg) emptyMsg.style.display = 'none';
    }
  } catch (err) {
    vscode.postMessage({
      command: 'log',
      text: 'Message Rendering Error: ' + err.message + '\n' + err.stack,
    });
  }
});

vscode.postMessage({ command: 'ready' });
