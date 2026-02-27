/* =============================================================
   RegionalUI — app.js
   Geographic data visualisation and modification interface.
   ============================================================= */

'use strict';

// ============================================================
// State
// ============================================================
const S = {
  variables:    [],       // [{name, file, type}]
  variable:     null,     // current variable name
  columns:      [],       // column names from file
  yearCol:      null,     // name of the year column, or null
  years:        [],       // sorted list of available years
  year:         null,     // currently selected year filter (null = all)
  data:         [],       // full in-memory dataset (all years)
  operations:   [],       // operation definitions from API
  dirty:        false,    // unsaved edits?
  ctxCell:      null,     // row data when context menu was opened
  ctxField:     null,     // field name when context menu was opened
  selectedRows: []        // currently selected rows
};

let tableInst = null;   // Tabulator instance
let barChart  = null;   // Chart.js bar
let pieChart  = null;   // Chart.js pie/doughnut

// ============================================================
// API helpers
// ============================================================
const api = {
  async _get(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status} – ${url}`);
    return r.json();
  },
  async _post(url, body) {
    const r = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body)
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} – ${url}`);
    return r.json();
  },

  variables:  ()             => api._get('/api/variables'),
  operations: ()             => api._get('/api/operations'),
  getData:    (v)            => api._get(`/api/data/${encodeURIComponent(v)}`),
  getHistory: (v)            => api._get(`/api/data/${encodeURIComponent(v)}/history`),
  applyOp:    (op, body)     => api._post(`/api/operations/${encodeURIComponent(op)}`, body),
  save:       (v, data, desc)=> api._post(`/api/data/${encodeURIComponent(v)}/save`,
                                          { data, description: desc }),
  restore:    (v, ts)        => api._post(`/api/data/${encodeURIComponent(v)}/restore`,
                                          { timestamp: ts }),
  commit:     (v, data)      => api._post(`/api/data/${encodeURIComponent(v)}/commit`,
                                          { data })
};

// ============================================================
// UI helpers
// ============================================================
const fmt = (n) =>
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

// Close any modal/dialog by clicking its overlay
document.querySelectorAll('.modal-overlay, .dialog-overlay').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) el.classList.add('hidden'); });
});

// Close buttons decorated with data-close
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});

function setDirty(val) {
  S.dirty = val;
  const dot = document.getElementById('dirty-dot');
  const btn = document.getElementById('btn-commit');
  dot.style.display = val ? 'inline' : 'none';
  btn.disabled      = !val;
  btn.classList.toggle('dirty', val);
}

function setTableInfo(msg) {
  document.getElementById('table-info').textContent = msg;
}

function setSelInfo(msg) {
  const el = document.getElementById('sel-info');
  el.textContent = msg;
  el.style.display = msg ? 'inline' : 'none';
}

// ============================================================
// Variable loading
// ============================================================
async function loadVariableList() {
  try {
    S.variables = await api.variables();
    const sel   = document.getElementById('variable-select');
    sel.innerHTML = '<option value="">— sélectionner —</option>';
    S.variables.forEach(v => {
      const o = document.createElement('option');
      o.value       = v.name;
      o.textContent = v.name + ' (' + v.type.toUpperCase() + ')';
      sel.appendChild(o);
    });
    setStatus(`${S.variables.length} variable(s) disponible(s) dans ./data`);
  } catch {
    setStatus('Impossible de contacter le serveur. Lancez : Rscript start.R', 'error');
  }
}

async function loadOperationsList() {
  try {
    S.operations = await api.operations();
  } catch {
    S.operations = [];
  }
}

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
    buildTable();
    updateCharts();

    setTableInfo(`${S.variable} — ${S.data.length} lignes`);
    setStatus(`Variable "${name}" chargée (${res.total_rows} lignes)`, 'success');
  } catch(e) {
    setStatus('Erreur: ' + e.message, 'error');
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
  sel.innerHTML      = '<option value="">Toutes</option>';
  S.years.forEach(y => {
    const o = document.createElement('option');
    o.value = y; o.textContent = y;
    sel.appendChild(o);
  });

  // Default: last year
  S.year    = S.years[S.years.length - 1];
  sel.value = S.year;
}

function filteredData() {
  if (!S.year || !S.yearCol) return S.data;
  return S.data.filter(r => String(r[S.yearCol]) === String(S.year));
}

// ============================================================
// Table (Tabulator)
// ============================================================
function buildTable() {
  const container = document.getElementById('data-table');

  // Build column definitions
  const cols = S.columns.map(col => {
    const isVal  = col === 'VALUE';
    const isCode = col === 'TERRITORIAL_CODE';
    return {
      title:       col,
      field:       col,
      sorter:      isVal ? 'number' : 'string',
      headerFilter: !isVal,
      editor:       isVal ? 'number' : false,
      editorParams: isVal ? { step: 'any' } : {},
      cssClass:     isVal ? 'value-cell' : (isCode ? 'code-cell' : ''),
      width:        isVal ? 160 : (isCode ? 130 : undefined),
      formatter:    isVal ? (cell) => {
        const v = cell.getValue();
        return (v == null || v === '') ? '' : fmt(v);
      } : undefined
    };
  });

  if (tableInst) { tableInst.destroy(); tableInst = null; }

  tableInst = new Tabulator(container, {
    data:              [],
    columns:           cols,
    height:            '100%',
    layout:            'fitColumns',
    selectable:        true,
    selectableRangeMode: 'click',
    movableColumns:    false,
    placeholder:       'Aucune donnée',

    // Inline edit
    cellEdited(cell) {
      const rowData = cell.getRow().getData();
      const val     = cell.getValue();
      const idx     = findIdx(rowData);
      if (idx >= 0) S.data[idx].VALUE = val;
      setDirty(true);
      updateCharts();
    },

    // Right-click on cell
    cellContext(e, cell) {
      e.preventDefault();
      S.ctxCell      = cell.getData();
      S.ctxField     = cell.getField();
      S.selectedRows = tableInst.getSelectedData();
      showCtxMenu(e.clientX, e.clientY, cell.getField() === 'VALUE');
    },

    // Row selection changed
    rowSelectionChanged(data) {
      S.selectedRows = data;
      const n = data.length;
      setSelInfo(n > 0 ? `${n} ligne(s) sélectionnée(s)` : '');
    }
  });

  refreshTable();
}

function refreshTable() {
  if (!tableInst) return;
  tableInst.setData(filteredData());
}

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
  if (e.target.closest('.tabulator-cell')) return; // handled by Tabulator
  e.preventDefault();
  S.ctxCell  = null;
  S.ctxField = null;
  showCtxMenu(e.clientX, e.clientY, false);
});

// ============================================================
// Charts (Chart.js)
// ============================================================
const PALETTE = [
  '#4361ee','#3a0ca3','#7209b7','#f72585','#4cc9f0',
  '#4895ef','#560bad','#b5179e','#f77f00','#fcbf49',
  '#06d6a0','#118ab2','#073b4c','#d62828','#023e8a',
  '#0077b6','#00b4d8','#90e0ef','#ef233c','#8d99ae'
];

function colors(n) {
  return Array.from({length: n}, (_, i) => PALETTE[i % PALETTE.length]);
}

function updateCharts() {
  const rows   = filteredData();
  const sorted = [...rows].sort((a, b) => (b.VALUE || 0) - (a.VALUE || 0));
  const labels = sorted.map(d => d.TERRITORIAL_NAME || d.TERRITORIAL_CODE || '?');
  const values = sorted.map(d => +(d.VALUE) || 0);
  const total  = values.reduce((s, v) => s + v, 0);
  const shares = values.map(v => total > 0 ? +(v / total * 100).toFixed(2) : 0);
  const clrs   = colors(sorted.length);

  const barTitle = (S.variable || '') + (S.year ? ` — ${S.year}` : '');

  if (!barChart) {
    barChart = new Chart(document.getElementById('bar-chart').getContext('2d'), {
      type: 'bar',
      data: { labels, datasets: [{ data: values, backgroundColor: clrs, borderWidth: 0 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: {
          legend: { display: false },
          title:  { display: true, text: barTitle, font: { size: 12 }, color: '#555' },
          tooltip: {
            callbacks: {
              label: ctx => ' ' + fmt(ctx.parsed.x)
            }
          }
        },
        scales: {
          x: { ticks: { callback: v => new Intl.NumberFormat('fr-BE', { notation: 'compact' }).format(v) } },
          y: { ticks: { font: { size: 11 } } }
        }
      }
    });
  } else {
    barChart.data.labels                         = labels;
    barChart.data.datasets[0].data               = values;
    barChart.data.datasets[0].backgroundColor    = clrs;
    barChart.options.plugins.title.text          = barTitle;
    barChart.update('none');
  }

  if (!pieChart) {
    pieChart = new Chart(document.getElementById('pie-chart').getContext('2d'), {
      type: 'doughnut',
      data: { labels, datasets: [{ data: shares, backgroundColor: clrs, borderWidth: 2, borderColor: '#fff' }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 11, font: { size: 11 }, padding: 6 } },
          tooltip: {
            callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed.toFixed(1)} %` }
          }
        }
      }
    });
  } else {
    pieChart.data.labels                      = labels;
    pieChart.data.datasets[0].data            = shares;
    pieChart.data.datasets[0].backgroundColor = clrs;
    pieChart.update('none');
  }
}

// ============================================================
// Context menu
// ============================================================
function showCtxMenu(x, y, isValueCell) {
  const menu = document.getElementById('ctx-menu');
  menu.innerHTML = '';

  const items = [];

  // --- Cell-level ---
  if (isValueCell && S.ctxCell) {
    const name = S.ctxCell.TERRITORIAL_NAME || S.ctxCell.TERRITORIAL_CODE || '';
    items.push({ type: 'header', label: `Cellule : ${name}` });
    items.push({ type: 'action', icon: '✏️', label: 'Modifier la valeur',
                 fn: openEditDialog });
    items.push({ type: 'sep' });
  }

  // --- Selection-level ---
  if (S.selectedRows.length > 1) {
    const selOps = S.operations.filter(o => o.scope &&
      (o.scope.includes('selection') || o.scope.includes('cell')));
    if (selOps.length) {
      items.push({ type: 'header', label: `Sélection (${S.selectedRows.length} lignes)` });
      selOps.forEach(op =>
        items.push({ type: 'action', icon: '▶', label: op.label,
                     fn: () => openOpDialog(op, 'selection') })
      );
      items.push({ type: 'sep' });
    }
  }

  // --- Dataset-level ---
  const dsOps = S.operations.filter(o => o.scope && o.scope.includes('dataset'));
  items.push({ type: 'header', label: 'Toutes les données' + (S.year ? ` (${S.year})` : '') });
  dsOps.forEach(op =>
    items.push({ type: 'action', icon: '◆', label: op.label,
                 fn: () => openOpDialog(op, 'dataset') })
  );

  // Render
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
      el.innerHTML = `<span style="font-size:12px;width:16px">${item.icon||''}</span>
                      <span>${item.label}</span>`;
      el.addEventListener('click', () => { hideCtxMenu(); item.fn(); });
    }
    menu.appendChild(el);
  });

  // Position
  menu.style.display = 'block';
  const mw = 240, mh = menu.scrollHeight;
  const lx = x + mw > window.innerWidth  ? x - mw : x;
  const ly = y + mh > window.innerHeight ? y - mh : y;
  menu.style.left = lx + 'px';
  menu.style.top  = ly + 'px';
}

function hideCtxMenu() {
  document.getElementById('ctx-menu').style.display = 'none';
}

document.addEventListener('click', e => {
  if (!e.target.closest('#ctx-menu')) hideCtxMenu();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    hideCtxMenu();
    ['edit-dialog','op-modal','save-modal','hist-modal'].forEach(closeModal);
  }
});

// ============================================================
// Edit dialog (direct cell value edit)
// ============================================================
function openEditDialog() {
  if (!S.ctxCell) return;
  const name = S.ctxCell.TERRITORIAL_NAME || S.ctxCell.TERRITORIAL_CODE || '';
  document.getElementById('edit-dialog-title').textContent = `Modifier : ${name}`;
  const inp = document.getElementById('edit-value-input');
  inp.value = S.ctxCell.VALUE ?? '';
  inp.classList.remove('error');
  openModal('edit-dialog');
  inp.focus();
  inp.select();
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
    refreshTable();
    updateCharts();
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
  if (scope === 'selection' && S.selectedRows.length > 0) {
    scopeText = `Sélection : ${S.selectedRows.length} territoire(s)`;
  }
  if (S.year) scopeText += ` — année ${S.year}`;
  document.getElementById('op-scope-info').textContent = scopeText;

  const form = document.getElementById('op-form');
  form.innerHTML = '';
  (op.params || []).forEach(p => {
    const grp = document.createElement('div');
    grp.className = 'form-group';

    const lbl = document.createElement('label');
    lbl.htmlFor     = `p_${p.id}`;
    lbl.textContent = p.label + (p.required ? ' *' : '');

    const inp = document.createElement('input');
    inp.id          = `p_${p.id}`;
    inp.name        = p.id;
    inp.type        = (p.type === 'integer') ? 'number' : 'number';
    inp.step        = (p.type === 'integer') ? '1' : 'any';
    inp.required    = !!p.required;
    inp.placeholder = p.label;
    if (p.default != null) inp.value = p.default;

    grp.append(lbl, inp);
    form.appendChild(grp);
  });

  // Store context
  form.dataset.opId  = op.id;
  form.dataset.scope = scope;

  openModal('op-modal');
  form.querySelector('input')?.focus();
}

async function executeOp() {
  const form  = document.getElementById('op-form');
  const opId  = form.dataset.opId;
  const scope = form.dataset.scope;

  // Collect params
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
    refreshTable();
    updateCharts();
    setStatus(`Opération "${opId}" appliquée`, 'success');
  } catch(e) {
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
    if (!res.success) throw new Error(res.error || 'Erreur inconnue');
    setStatus(`Snapshot créé : ${res.timestamp}`, 'success');
  } catch(e) {
    setStatus('Erreur : ' + e.message, 'error');
  } finally {
    showLoad(false);
  }
}

document.getElementById('btn-save-confirm').addEventListener('click', executeSave);
document.getElementById('save-desc').addEventListener('keydown', e => {
  if (e.key === 'Enter') executeSave();
});

// ============================================================
// History (snapshots)
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
              h.total != null ? fmt(h.total) : 'N/A'}</div>
          </div>
          <button class="btn btn-danger btn-restore" style="flex-shrink:0">Restaurer</button>
        `;
        el.querySelector('.btn-restore').addEventListener('click', async () => {
          closeModal('hist-modal');
          await restoreSnapshot(h.timestamp);
        });
        list.appendChild(el);
      });
    }
    openModal('hist-modal');
  } catch(e) {
    setStatus('Erreur : ' + e.message, 'error');
  } finally {
    showLoad(false);
  }
}

async function restoreSnapshot(ts) {
  showLoad(true);
  try {
    const res = await api.restore(S.variable, ts);
    if (!res.success) throw new Error(res.error || 'Erreur inconnue');
    S.data = res.data;
    setDirty(false);
    refreshTable();
    updateCharts();
    setStatus(`Données restaurées depuis : ${ts}`, 'success');
  } catch(e) {
    setStatus('Erreur : ' + e.message, 'error');
  } finally {
    showLoad(false);
  }
}

// ============================================================
// Commit (save in-memory data to disk)
// ============================================================
async function commitData() {
  if (!S.dirty || !S.variable) return;
  showLoad(true);
  try {
    const res = await api.commit(S.variable, S.data);
    if (!res.success) throw new Error(res.error || 'Erreur inconnue');
    setDirty(false);
    setStatus('Données enregistrées sur le disque.', 'success');
  } catch(e) {
    setStatus('Erreur : ' + e.message, 'error');
  } finally {
    showLoad(false);
  }
}

// ============================================================
// Event wiring
// ============================================================
document.getElementById('variable-select').addEventListener('change', e => {
  loadVariable(e.target.value);
});

document.getElementById('year-select').addEventListener('change', e => {
  S.year = e.target.value || null;
  refreshTable();
  updateCharts();
});

document.getElementById('btn-save').addEventListener('click',    openSaveDialog);
document.getElementById('btn-history').addEventListener('click', openHistory);
document.getElementById('btn-commit').addEventListener('click',  commitData);

// ============================================================
// Init
// ============================================================
async function init() {
  setStatus('Connexion au serveur R…');
  await Promise.all([loadVariableList(), loadOperationsList()]);
}

document.addEventListener('DOMContentLoaded', init);
