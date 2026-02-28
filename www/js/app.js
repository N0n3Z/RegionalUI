/* =============================================================
   RegionalUI — app.js
   Geographic data visualisation and modification interface.
   ============================================================= */

'use strict';

// ============================================================
// State
// ============================================================
const S = {
  variables:    [],
  variable:     null,
  columns:      [],
  yearCol:      null,
  years:        [],
  year:         null,
  data:         [],        // full in-memory dataset (all years)
  operations:   [],
  dirty:        false,
  ctxCell:      null,
  ctxField:     null,
  selectedRows: []
};

let tableInst  = null;   // Tabulator – main editable table
let sharesInst = null;   // Tabulator – shares wide table
let growthInst = null;   // Tabulator – growth wide table

// ============================================================
// API
// ============================================================
const api = {
  async _get(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  async _post(url, body) {
    const r = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body)
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  variables:  ()         => api._get('/api/variables'),
  operations: ()         => api._get('/api/operations'),
  getData:    v          => api._get(`/api/data/${enc(v)}`),
  getHistory: v          => api._get(`/api/data/${enc(v)}/history`),
  applyOp:    (op, body) => api._post(`/api/operations/${enc(op)}`, body),
  save:     (v, data, d) => api._post(`/api/data/${enc(v)}/save`,    { data, description: d }),
  restore:   (v, ts)     => api._post(`/api/data/${enc(v)}/restore`, { timestamp: ts }),
  commit:    (v, data)   => api._post(`/api/data/${enc(v)}/commit`,  { data }),
  shares:    (data, yc)  => api._post('/api/compute/shares', { data, year_col: yc || '' }),
  growth:    (data, yc)  => api._post('/api/compute/growth', { data, year_col: yc || '' })
};

const enc = encodeURIComponent;

// ============================================================
// UI helpers
// ============================================================
const fmtNum = n =>
  (n == null || n === '') ? '' :
  new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 4 }).format(n);

function setStatus(msg, type = 'info') {
  const el = document.getElementById('status-bar');
  el.textContent = msg;
  el.className = 'status-info' + (type !== 'info' ? ` status-${type}` : '');
}

function showLoad(on = true) {
  document.getElementById('loading-overlay').classList.toggle('hidden', !on);
}

function openModal(id)  { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

document.querySelectorAll('.modal-overlay, .dialog-overlay').forEach(el =>
  el.addEventListener('click', e => { if (e.target === el) el.classList.add('hidden'); })
);
document.querySelectorAll('[data-close]').forEach(btn =>
  btn.addEventListener('click', () => closeModal(btn.dataset.close))
);

function setDirty(val) {
  S.dirty = val;
  document.getElementById('dirty-dot').style.display   = val ? 'inline' : 'none';
  const btn = document.getElementById('btn-commit');
  btn.disabled = !val;
  btn.classList.toggle('dirty', val);
}

function setTableInfo(msg) { document.getElementById('table-info').textContent = msg; }
function setSelInfo(msg)  {
  const el = document.getElementById('sel-info');
  el.textContent = msg;
  el.style.display = msg ? 'inline' : 'none';
}

// ============================================================
// Splitters (drag-to-resize panels)
// ============================================================
function initSplitters() {
  makeSplitter(
    document.getElementById('drag-h'),
    document.getElementById('pane-data'),
    null,
    'h',
    document.getElementById('top-row')
  );
  makeSplitter(
    document.getElementById('drag-v'),
    document.getElementById('top-row'),
    null,
    'v',
    document.querySelector('.app-main')
  );
}

function makeSplitter(handle, paneA, _paneB, dir, container) {
  let active = false;

  handle.addEventListener('mousedown', e => {
    active = true;
    handle.classList.add('dragging');
    document.body.style.cursor      = dir === 'h' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect  = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!active) return;
    const rect = container.getBoundingClientRect();
    let pct;
    if (dir === 'h') {
      pct = Math.max(15, Math.min(85, (e.clientX - rect.left) / rect.width  * 100));
    } else {
      pct = Math.max(15, Math.min(80, (e.clientY - rect.top)  / rect.height * 100));
    }
    paneA.style.flex = `0 0 ${pct}%`;
    redrawAll();
  });

  document.addEventListener('mouseup', () => {
    if (!active) return;
    active = false;
    handle.classList.remove('dragging');
    document.body.style.cursor     = '';
    document.body.style.userSelect = '';
    redrawAll();
  });
}

function redrawAll() {
  [tableInst, sharesInst, growthInst].forEach(t => { try { t?.redraw(); } catch {} });
}

// ============================================================
// Variable list
// ============================================================
async function loadVariableList() {
  try {
    S.variables = await api.variables();
    const sel = document.getElementById('variable-select');
    sel.innerHTML = '<option value="">— sélectionner —</option>';
    S.variables.forEach(v => {
      const o = document.createElement('option');
      o.value = v.name;
      o.textContent = `${v.name}  (${v.type.toUpperCase()})`;
      sel.appendChild(o);
    });
    setStatus(`${S.variables.length} variable(s) disponible(s) dans ./data`);
  } catch {
    setStatus('Impossible de contacter le serveur — lancez : Rscript start.R', 'error');
  }
}

async function loadOperationsList() {
  try { S.operations = await api.operations(); }
  catch { S.operations = []; }
}

// ============================================================
// Load a variable
// ============================================================
async function loadVariable(name) {
  if (!name) return;
  showLoad(true);
  try {
    const res = await api.getData(name);
    if (res.error) throw new Error(res.error);

    S.variable = name;
    S.columns  = res.columns || [];
    S.yearCol  = res.year_column || null;
    S.years    = res.years  || [];
    S.data     = res.data   || [];
    setDirty(false);

    updateYearSelector();
    buildMainTable();
    setTableInfo(`${S.variable} — ${S.data.length} lignes`);
    setStatus(`Variable "${name}" chargée (${res.total_rows} lignes)`, 'success');

    await updateAnalysisTables(true);
  } catch (e) {
    setStatus('Erreur : ' + e.message, 'error');
  } finally {
    showLoad(false);
  }
}

// ============================================================
// Year selector
// ============================================================
function updateYearSelector() {
  const ctrl = document.getElementById('year-ctrl');
  const sel  = document.getElementById('year-select');

  if (!S.yearCol || S.years.length === 0) {
    ctrl.style.display = 'none';
    S.year = null;
    return;
  }
  ctrl.style.display = 'flex';
  sel.innerHTML = '<option value="">Toutes</option>';
  S.years.forEach(y => {
    const o = document.createElement('option');
    o.value = y; o.textContent = y;
    sel.appendChild(o);
  });
  S.year    = S.years[S.years.length - 1];
  sel.value = S.year;
}

function filteredData() {
  if (!S.year || !S.yearCol) return S.data;
  return S.data.filter(r => String(r[S.yearCol]) === String(S.year));
}

// ============================================================
// Main editable data table
// ============================================================
function buildMainTable() {
  const container = document.getElementById('data-table');

  const cols = S.columns.map(col => {
    const isVal  = col === 'VALUE';
    const isCode = col === 'TERRITORIAL_CODE';
    return {
      title:        col,
      field:        col,
      sorter:       isVal ? 'number' : 'string',
      headerFilter: !isVal,
      editor:       isVal ? 'number' : false,
      editorParams: isVal ? { step: 'any' } : {},
      cssClass:     isVal ? 'value-cell' : (isCode ? 'code-cell' : ''),
      width:        isVal ? 160 : (isCode ? 130 : undefined),
      resizable:    true,
      formatter:    isVal
        ? cell => {
            const v = cell.getValue();
            return (v == null || v === '') ? '' : fmtNum(v);
          }
        : undefined
    };
  });

  if (tableInst) { tableInst.destroy(); tableInst = null; }

  tableInst = new Tabulator(container, {
    data:               [],
    columns:            cols,
    height:             '100%',
    layout:             'fitColumns',
    selectable:         true,
    selectableRangeMode:'click',
    movableColumns:     false,
    placeholder:        'Aucune donnée',

    cellEdited(cell) {
      const row = cell.getRow().getData();
      const idx = findIdx(row);
      if (idx >= 0) S.data[idx].VALUE = cell.getValue();
      setDirty(true);
      scheduleAnalysis();
    },

    cellContext(e, cell) {
      e.preventDefault();
      S.ctxCell      = cell.getData();
      S.ctxField     = cell.getField();
      S.selectedRows = tableInst.getSelectedData();
      showCtxMenu(e.clientX, e.clientY, cell.getField() === 'VALUE');
    },

    rowSelectionChanged(data) {
      S.selectedRows = data;
      setSelInfo(data.length > 0 ? `${data.length} ligne(s) sélectionnée(s)` : '');
    }
  });

  refreshMainTable();
}

function refreshMainTable() { if (tableInst) tableInst.setData(filteredData()); }

function findIdx(row) {
  return S.data.findIndex(d => {
    if (S.yearCol)
      return d.TERRITORIAL_CODE === row.TERRITORIAL_CODE &&
             String(d[S.yearCol]) === String(row[S.yearCol]);
    return d.TERRITORIAL_CODE === row.TERRITORIAL_CODE;
  });
}

// Right-click in empty table area
document.getElementById('data-table').addEventListener('contextmenu', e => {
  if (e.target.closest('.tabulator-cell')) return;
  e.preventDefault();
  S.ctxCell = null; S.ctxField = null;
  showCtxMenu(e.clientX, e.clientY, false);
});

// ============================================================
// Analysis tables (shares + growth) — computed in R
// ============================================================
let analysisTimer = null;

function scheduleAnalysis() {
  clearTimeout(analysisTimer);
  analysisTimer = setTimeout(() => updateAnalysisTables(true), 700);
}

async function updateAnalysisTables(immediate = false) {
  if (!S.data || S.data.length === 0 || !S.variable) return;
  if (!immediate) { scheduleAnalysis(); return; }

  try {
    const body = { data: S.data, year_col: S.yearCol || '' };
    const [sr, gr] = await Promise.all([api.shares(S.data, S.yearCol), api.growth(S.data, S.yearCol)]);
    buildSharesTable(sr.columns || [], sr.data || []);
    buildGrowthTable(gr.columns || [], gr.data || []);
  } catch (e) {
    console.error('Analysis update failed:', e);
  }
}

/* ── Shares table ── */
function buildSharesTable(columns, data) {
  const container = document.getElementById('shares-table');

  if (!columns.length || !data.length) {
    if (sharesInst) { sharesInst.destroy(); sharesInst = null; }
    container.innerHTML = '<div class="empty-pane">Données insuffisantes</div>';
    return;
  }

  const cols = columns.map(col => {
    const isCode = col === 'TERRITORIAL_CODE';
    const isName = col === 'TERRITORIAL_NAME';
    const isNum  = !isCode && !isName;
    return {
      title:        isCode ? 'Code' : (isName ? 'Territoire' : String(col)),
      field:        col,
      sorter:       isNum ? 'number' : 'string',
      hozAlign:     isNum ? 'right' : 'left',
      width:        isCode ? 90 : (isNum ? 82 : undefined),
      headerFilter: isName,
      resizable:    true,
      cssClass:     isNum ? 'num-cell' : '',
      formatter:    isNum
        ? cell => {
            const v = cell.getValue();
            if (v == null || v === '') return '<span style="color:#ccc">—</span>';
            const el  = cell.getElement();
            const pct = Math.min(+v / 100, 1);
            el.style.background = `rgba(67,97,238,${(pct * 0.72).toFixed(3)})`;
            el.style.color = pct > 0.55 ? '#fff' : 'var(--text)';
            return (+v).toFixed(2) + ' %';
          }
        : undefined
    };
  });

  if (sharesInst) {
    sharesInst.setColumns(cols);
    sharesInst.setData(data);
  } else {
    sharesInst = new Tabulator(container, {
      data, columns: cols, height: '100%', layout: 'fitColumns',
      placeholder: 'Aucune donnée'
    });
  }
}

/* ── Growth table ── */
function buildGrowthTable(columns, data) {
  const container = document.getElementById('growth-table');

  if (!columns.length || !data.length) {
    if (growthInst) { growthInst.destroy(); growthInst = null; }
    container.innerHTML = '<div class="empty-pane">Pas de données temporelles disponibles</div>';
    return;
  }

  const cols = columns.map(col => {
    const isCode = col === 'TERRITORIAL_CODE';
    const isName = col === 'TERRITORIAL_NAME';
    const isNum  = !isCode && !isName;
    return {
      title:        isCode ? 'Code' : (isName ? 'Territoire' : col),
      field:        col,
      sorter:       isNum ? 'number' : 'string',
      hozAlign:     isNum ? 'right' : 'left',
      width:        isCode ? 90 : (isNum ? 112 : undefined),
      headerFilter: isName,
      resizable:    true,
      cssClass:     isNum ? 'num-cell' : '',
      formatter:    isNum
        ? cell => {
            const v = cell.getValue();
            if (v == null || v === '' || isNaN(+v))
              return '<span style="color:#ccc">—</span>';
            const el  = cell.getElement();
            const abs = Math.abs(+v);
            const k   = Math.min(abs / 10, 0.72);  // saturate at 10 %
            if (+v > 0) {
              el.style.background = `rgba(39,174,96,${k.toFixed(3)})`;
              el.style.color = k > 0.45 ? '#fff' : 'var(--text)';
              return '+' + (+v).toFixed(2) + ' %';
            } else if (+v < 0) {
              el.style.background = `rgba(231,76,60,${k.toFixed(3)})`;
              el.style.color = k > 0.45 ? '#fff' : 'var(--text)';
              return (+v).toFixed(2) + ' %';
            }
            return '0.00 %';
          }
        : undefined
    };
  });

  if (growthInst) {
    growthInst.setColumns(cols);
    growthInst.setData(data);
  } else {
    growthInst = new Tabulator(container, {
      data, columns: cols, height: '100%', layout: 'fitColumns',
      placeholder: 'Aucune donnée temporelle'
    });
  }
}

// ============================================================
// Context menu
// ============================================================
function showCtxMenu(x, y, isValueCell) {
  const menu = document.getElementById('ctx-menu');
  menu.innerHTML = '';
  const items = [];

  if (isValueCell && S.ctxCell) {
    const name = S.ctxCell.TERRITORIAL_NAME || S.ctxCell.TERRITORIAL_CODE || '';
    items.push({ type: 'header', label: `Cellule : ${name}` });
    items.push({ type: 'action', icon: '✏️', label: 'Modifier la valeur', fn: openEditDialog });
    items.push({ type: 'sep' });
  }

  if (S.selectedRows.length > 1) {
    const selOps = S.operations.filter(o =>
      o.scope && (o.scope.includes('selection') || o.scope.includes('cell'))
    );
    if (selOps.length) {
      items.push({ type: 'header', label: `Sélection (${S.selectedRows.length} lignes)` });
      selOps.forEach(op =>
        items.push({ type: 'action', icon: '▶', label: op.label,
                     fn: () => openOpDialog(op, 'selection') })
      );
      items.push({ type: 'sep' });
    }
  }

  const dsOps = S.operations.filter(o => o.scope && o.scope.includes('dataset'));
  items.push({ type: 'header', label: 'Toutes les données' + (S.year ? ` (${S.year})` : '') });
  dsOps.forEach(op =>
    items.push({ type: 'action', icon: '◆', label: op.label,
                 fn: () => openOpDialog(op, 'dataset') })
  );

  items.forEach(item => {
    let el;
    if (item.type === 'header') {
      el = document.createElement('div');
      el.className = 'ctx-header';
      el.textContent = item.label;
    } else if (item.type === 'sep') {
      el = document.createElement('div');
      el.className = 'ctx-sep';
    } else {
      el = document.createElement('div');
      el.className = 'ctx-item';
      el.innerHTML = `<span style="font-size:12px;width:16px">${item.icon || ''}</span>
                      <span>${item.label}</span>`;
      el.addEventListener('click', () => { hideCtxMenu(); item.fn(); });
    }
    menu.appendChild(el);
  });

  menu.style.display = 'block';
  const mw = 240, mh = menu.scrollHeight;
  menu.style.left = (x + mw > window.innerWidth  ? x - mw : x) + 'px';
  menu.style.top  = (y + mh > window.innerHeight ? y - mh : y) + 'px';
}

function hideCtxMenu() { document.getElementById('ctx-menu').style.display = 'none'; }

document.addEventListener('click', e => { if (!e.target.closest('#ctx-menu')) hideCtxMenu(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    hideCtxMenu();
    ['edit-dialog', 'op-modal', 'save-modal', 'hist-modal'].forEach(closeModal);
  }
});

// ============================================================
// Edit dialog
// ============================================================
function openEditDialog() {
  if (!S.ctxCell) return;
  const name = S.ctxCell.TERRITORIAL_NAME || S.ctxCell.TERRITORIAL_CODE || '';
  document.getElementById('edit-dialog-title').textContent = `Modifier : ${name}`;
  const inp = document.getElementById('edit-value-input');
  inp.value = S.ctxCell.VALUE ?? '';
  inp.classList.remove('error');
  openModal('edit-dialog');
  inp.focus(); inp.select();
}

function confirmEdit() {
  const inp = document.getElementById('edit-value-input');
  const val = parseFloat(inp.value);
  if (isNaN(val)) { inp.classList.add('error'); return; }

  const code = S.ctxCell.TERRITORIAL_CODE;
  const yr   = S.yearCol ? S.ctxCell[S.yearCol] : null;
  const idx  = S.data.findIndex(d => {
    if (yr) return d.TERRITORIAL_CODE === code && String(d[S.yearCol]) === String(yr);
    return d.TERRITORIAL_CODE === code;
  });
  if (idx >= 0) {
    S.data[idx].VALUE = val;
    setDirty(true);
    refreshMainTable();
    scheduleAnalysis();
    setStatus(`Valeur modifiée pour ${code}`, 'success');
  }
  closeModal('edit-dialog');
}

document.getElementById('btn-edit-confirm').addEventListener('click', confirmEdit);
document.getElementById('btn-edit-cancel').addEventListener('click',  () => closeModal('edit-dialog'));
document.getElementById('edit-value-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') confirmEdit();
});

// ============================================================
// Operation dialog
// ============================================================
function openOpDialog(op, scope) {
  document.getElementById('op-modal-title').textContent = op.label;
  document.getElementById('op-modal-desc').textContent  = op.description;

  let scopeText = 'Toutes les données';
  if (scope === 'selection' && S.selectedRows.length > 0)
    scopeText = `Sélection : ${S.selectedRows.length} territoire(s)`;
  if (S.year) scopeText += ` — année ${S.year}`;
  document.getElementById('op-scope-info').textContent = scopeText;

  const form = document.getElementById('op-form');
  form.innerHTML = '';
  (op.params || []).forEach(p => {
    const grp = document.createElement('div');
    grp.className = 'form-group';
    const lbl = document.createElement('label');
    lbl.htmlFor = `p_${p.id}`;
    lbl.textContent = p.label + (p.required ? ' *' : '');
    const inp = document.createElement('input');
    inp.id          = `p_${p.id}`;
    inp.name        = p.id;
    inp.type        = 'number';
    inp.step        = p.type === 'integer' ? '1' : 'any';
    inp.required    = !!p.required;
    inp.placeholder = p.label;
    if (p.default != null) inp.value = p.default;
    grp.append(lbl, inp);
    form.appendChild(grp);
  });
  form.dataset.opId  = op.id;
  form.dataset.scope = scope;
  openModal('op-modal');
  form.querySelector('input')?.focus();
}

async function executeOp() {
  const form  = document.getElementById('op-form');
  const opId  = form.dataset.opId;
  const scope = form.dataset.scope;
  const params = {};
  for (const inp of form.querySelectorAll('input[name]')) {
    if (inp.required && inp.value === '') {
      inp.focus();
      setStatus(`Paramètre requis : ${inp.placeholder}`, 'warning');
      return;
    }
    if (inp.value !== '') params[inp.name] = inp.value;
  }

  closeModal('op-modal');
  showLoad(true);
  try {
    const body = {
      variable:  S.variable,
      params,
      year:      S.year || null,
      selection: scope === 'selection'
        ? S.selectedRows.map(r => r.TERRITORIAL_CODE)
        : null
    };
    const res = await api.applyOp(opId, body);
    if (!res.success) throw new Error(res.error || 'Erreur inconnue');

    S.data = res.data;
    setDirty(true);
    refreshMainTable();
    await updateAnalysisTables(true);
    setStatus(`Opération "${opId}" appliquée`, 'success');
  } catch (e) {
    setStatus('Erreur : ' + e.message, 'error');
  } finally {
    showLoad(false);
  }
}

document.getElementById('btn-op-execute').addEventListener('click', executeOp);

// ============================================================
// Save (snapshot)
// ============================================================
async function openSaveDialog() {
  if (!S.variable) { setStatus('Aucune variable sélectionnée', 'warning'); return; }
  document.getElementById('save-desc').value = '';
  openModal('save-modal');
  document.getElementById('save-desc').focus();
}

async function executeSave() {
  const desc = document.getElementById('save-desc').value.trim();
  closeModal('save-modal');
  showLoad(true);
  try {
    const res = await api.save(S.variable, S.data, desc);
    if (!res.success) throw new Error(res.error);
    setStatus(`Snapshot créé : ${res.timestamp}`, 'success');
  } catch (e) {
    setStatus('Erreur : ' + e.message, 'error');
  } finally { showLoad(false); }
}

document.getElementById('btn-save-confirm').addEventListener('click', executeSave);
document.getElementById('save-desc').addEventListener('keydown', e => {
  if (e.key === 'Enter') executeSave();
});

// ============================================================
// History
// ============================================================
async function openHistory() {
  if (!S.variable) { setStatus('Aucune variable sélectionnée', 'warning'); return; }
  showLoad(true);
  try {
    const history = await api.getHistory(S.variable);
    const list    = document.getElementById('hist-list');
    list.innerHTML = '';
    if (!history.length) {
      list.innerHTML = '<div class="hist-empty">Aucun snapshot disponible.</div>';
    } else {
      history.forEach(h => {
        const el = document.createElement('div');
        el.className = 'hist-item';
        el.innerHTML = `
          <div class="hist-info">
            <div class="hist-dt">${h.datetime || h.timestamp}</div>
            <div class="hist-desc">${h.description || '<em style="color:#bbb">sans description</em>'}</div>
            <div class="hist-meta">${h.rows ?? '?'} lignes · total = ${
              h.total != null ? fmtNum(h.total) : 'N/A'}</div>
          </div>
          <button class="btn btn-danger btn-restore" style="flex-shrink:0">Restaurer</button>`;
        el.querySelector('.btn-restore').addEventListener('click', async () => {
          closeModal('hist-modal');
          await restoreSnapshot(h.timestamp);
        });
        list.appendChild(el);
      });
    }
    openModal('hist-modal');
  } catch (e) {
    setStatus('Erreur : ' + e.message, 'error');
  } finally { showLoad(false); }
}

async function restoreSnapshot(ts) {
  showLoad(true);
  try {
    const res = await api.restore(S.variable, ts);
    if (!res.success) throw new Error(res.error);
    S.data = res.data;
    setDirty(false);
    refreshMainTable();
    await updateAnalysisTables(true);
    setStatus(`Données restaurées depuis : ${ts}`, 'success');
  } catch (e) {
    setStatus('Erreur : ' + e.message, 'error');
  } finally { showLoad(false); }
}

// ============================================================
// Commit (save in-memory data to disk)
// ============================================================
async function commitData() {
  if (!S.dirty || !S.variable) return;
  showLoad(true);
  try {
    const res = await api.commit(S.variable, S.data);
    if (!res.success) throw new Error(res.error);
    setDirty(false);
    setStatus('Données enregistrées sur le disque.', 'success');
  } catch (e) {
    setStatus('Erreur : ' + e.message, 'error');
  } finally { showLoad(false); }
}

// ============================================================
// Event wiring
// ============================================================
document.getElementById('variable-select').addEventListener('change', e => loadVariable(e.target.value));
document.getElementById('year-select').addEventListener('change', e => {
  S.year = e.target.value || null;
  refreshMainTable();
});
document.getElementById('btn-save').addEventListener('click',    openSaveDialog);
document.getElementById('btn-history').addEventListener('click', openHistory);
document.getElementById('btn-commit').addEventListener('click',  commitData);

// ============================================================
// Init
// ============================================================
async function init() {
  setStatus('Connexion au serveur R…');
  initSplitters();
  await Promise.all([loadVariableList(), loadOperationsList()]);
}

document.addEventListener('DOMContentLoaded', init);
