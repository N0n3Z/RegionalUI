// app.js — Logique principale de l'interface
'use strict';

const API = 'http://localhost:8000';

const state = {
  data:             [],
  variableActive:   'population',
  regionFiltre:     '',
  cellContextuelle: null,
  anomalies:        new Set(),
  drapeaux:         new Set(),
};

async function api(path, options = {}) {
  try {
    const res = await fetch(API + path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }
    return res.json();
  } catch (e) {
    toast(`Erreur API : ${e.message}`, 'error');
    throw e;
  }
}

function apiGet(path)             { return api(path); }
function apiPost(path, body = {}) { return api(path, { method: 'POST', body: JSON.stringify(body) }); }

function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.classList.add('toast-show'), 10);
  setTimeout(() => { el.classList.remove('toast-show'); setTimeout(() => el.remove(), 300); }, 3500);
}

const FORMATS = {
  population:     v => Number(v).toLocaleString('fr-BE'),
  densite:        v => Number(v).toLocaleString('fr-BE', { maximumFractionDigits: 0 }) + ' hab/km²',
  taux_chomage:   v => Number(v).toFixed(1) + ' %',
  revenu_median:  v => Number(v).toLocaleString('fr-BE') + ' €',
  taux_emploi:    v => Number(v).toFixed(1) + ' %',
  superficie_km2: v => Number(v).toLocaleString('fr-BE') + ' km²',
};

function fmt(variable, val) {
  return FORMATS[variable] ? FORMATS[variable](val) : val;
}

let grid;

function buildColumns(variable) {
  return [
    { title: 'NUTS3',          field: 'nuts3',    width: 90,  frozen: true },
    { title: 'Arrondissement', field: 'nom',      minWidth: 200, frozen: true },
    { title: 'Région',         field: 'region',   width: 200 },
    { title: 'Province',       field: 'province', width: 180 },
    {
      title: document.getElementById('variable-select').selectedOptions[0]?.text || variable,
      field: variable,
      hozAlign: 'right',
      width: 160,
      formatter: (cell) => {
        const val  = cell.getValue();
        const nuts = cell.getRow().getData().nuts3;
        let cls = '';
        if (state.drapeaux.has(nuts))  cls = 'cell-flagged';
        if (state.anomalies.has(nuts)) cls = 'cell-anomaly';
        cell.getElement().className += ' ' + cls;
        return fmt(variable, val);
      },
      sorter: 'number',
    },
  ];
}

function initGrid(data) {
  grid = new Tabulator('#data-grid', {
    data,
    layout:              'fitColumns',
    height:              'calc(100vh - 260px)',
    selectable:          true,
    selectableRangeMode: 'click',
    columns:             buildColumns(state.variableActive),
    rowFormatter: (row) => {
      const nuts = row.getData().nuts3;
      if (state.drapeaux.has(nuts))  row.getElement().classList.add('row-flagged');
      if (state.anomalies.has(nuts)) row.getElement().classList.add('row-anomaly');
    },
    rowSelectionChanged: (rows) => updateSelectionStats(rows),
  });

  grid.on('cellContext', (e, cell) => {
    e.preventDefault();
    state.cellContextuelle = cell;
    showContextMenu(e.clientX, e.clientY);
  });

  grid.on('cellClick', (e, cell) => {
    closeContextMenu();
    showDetailPanel(cell.getRow().getData());
  });
}

function refreshGrid() {
  if (!grid) return;
  grid.setColumns(buildColumns(state.variableActive));
  const region = state.regionFiltre;
  if (region) { grid.setFilter('region', '=', region); } else { grid.clearFilter(); }
  grid.redraw(true);
  updateStats();
}

function updateStats() {
  const rows    = grid ? grid.getRows('active') : [];
  const vals    = rows.map(r => r.getData()[state.variableActive]).filter(v => v !== null && !isNaN(v));
  const total   = vals.reduce((a, b) => a + b, 0);
  const moyenne = vals.length ? total / vals.length : 0;
  const min     = Math.min(...vals);
  const max     = Math.max(...vals);
  const minRow  = rows.find(r => r.getData()[state.variableActive] === min)?.getData();
  const maxRow  = rows.find(r => r.getData()[state.variableActive] === max)?.getData();

  setText('stat-total',   '.stat-value', fmt(state.variableActive, Math.round(total)));
  setText('stat-moyenne', '.stat-value', fmt(state.variableActive, moyenne.toFixed(1)));
  setText('stat-min',     '.stat-value', fmt(state.variableActive, min));
  setText('stat-min',     '.stat-sub',   minRow?.nom || '');
  setText('stat-max',     '.stat-value', fmt(state.variableActive, max));
  setText('stat-max',     '.stat-sub',   maxRow?.nom || '');
}

function updateSelectionStats(rows) {
  setText('stat-selection', '.stat-value', `${rows.length} ligne(s)`);
}

function setText(cardId, selector, val) {
  const el = document.querySelector(`#${cardId} ${selector}`);
  if (el) el.textContent = val;
}

function showDetailPanel(rowData) {
  const panel = document.getElementById('detail-panel');
  panel.classList.remove('hidden');
  document.getElementById('detail-title').textContent = rowData.nom;

  const varNames = {
    population: 'Population', densite: 'Densité', taux_chomage: 'Taux chômage',
    revenu_median: 'Revenu médian', taux_emploi: "Taux d'emploi", superficie_km2: 'Superficie',
  };

  const html = Object.entries(varNames).map(([k, label]) => `
    <div class="detail-row">
      <span class="detail-label">${label}</span>
      <span class="detail-value">${fmt(k, rowData[k])}</span>
    </div>
  `).join('');

  document.getElementById('detail-content').innerHTML = `
    <div class="detail-meta">
      <strong>${rowData.nuts3}</strong> · ${rowData.province} · ${rowData.region}
    </div>
    ${html}
  `;

  const sel = document.getElementById('edit-variable');
  sel.innerHTML = Object.entries(varNames).map(([k, label]) =>
    `<option value="${k}" ${k === state.variableActive ? 'selected' : ''}>${label}</option>`
  ).join('');

  document.getElementById('edit-value').value = rowData[state.variableActive];
  document.getElementById('edit-motif').value = '';
  panel.dataset.nuts3 = rowData.nuts3;
}

document.getElementById('detail-close').addEventListener('click', () => {
  document.getElementById('detail-panel').classList.add('hidden');
});

document.getElementById('btn-apply-edit').addEventListener('click', async () => {
  const nuts3    = document.getElementById('detail-panel').dataset.nuts3;
  const variable = document.getElementById('edit-variable').value;
  const valeur   = document.getElementById('edit-value').value;
  const motif    = document.getElementById('edit-motif').value || 'Correction manuelle';
  if (!nuts3 || valeur === '') return toast('Valeur manquante', 'error');
  try {
    const result = await apiPost(`/corriger?nuts3=${encodeURIComponent(nuts3)}&variable=${encodeURIComponent(variable)}&valeur=${encodeURIComponent(valeur)}&motif=${encodeURIComponent(motif)}`);
    grid.updateData([{ nuts3, [variable]: parseFloat(valeur) }]);
    toast(`✓ ${nuts3} · ${variable} corrigé : ${result.valeur_avant} → ${valeur}`, 'success');
    updateStats();
  } catch (_) {}
});

function showContextMenu(x, y) {
  const menu = document.getElementById('context-menu');
  menu.style.left = `${Math.min(x, window.innerWidth - 220)}px`;
  menu.style.top  = `${Math.min(y, window.innerHeight - 200)}px`;
  menu.classList.remove('hidden');
}

function closeContextMenu() {
  document.getElementById('context-menu').classList.add('hidden');
}

document.addEventListener('click', closeContextMenu);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeContextMenu(); });

document.getElementById('ctx-edit').addEventListener('click', () => {
  if (!state.cellContextuelle) return;
  showDetailPanel(state.cellContextuelle.getRow().getData());
  closeContextMenu();
});

document.getElementById('ctx-history').addEventListener('click', async () => {
  closeContextMenu();
  try {
    const data = await apiGet('/historique');
    showModal('Historique des modifications', buildHistoriqueHTML(data));
  } catch (_) {}
});

document.getElementById('ctx-detect').addEventListener('click', async () => {
  if (!state.cellContextuelle) return;
  closeContextMenu();
  await detecterAnomalies('zscore');
});

document.getElementById('ctx-copy-region').addEventListener('click', async () => {
  if (!state.cellContextuelle) return;
  closeContextMenu();
  const rowData = state.cellContextuelle.getRow().getData();
  const region  = rowData.region;
  const valeur  = rowData[state.variableActive];
  if (!confirm(`Appliquer cette valeur à tous les arrondissements de "${region}" ?`)) return;
  const cibles = state.data.filter(d => d.region === region && d.nuts3 !== rowData.nuts3);
  let nb = 0;
  for (const cible of cibles) {
    try {
      await apiPost(`/corriger?nuts3=${encodeURIComponent(cible.nuts3)}&variable=${encodeURIComponent(state.variableActive)}&valeur=${encodeURIComponent(valeur)}&motif=Propagation+depuis+${encodeURIComponent(rowData.nuts3)}`);
      nb++;
    } catch (_) {}
  }
  await rechargerDonnees();
  toast(`✓ Valeur propagée à ${nb} arrondissement(s) de ${region}`, 'success');
});

document.getElementById('ctx-flag').addEventListener('click', () => {
  if (!state.cellContextuelle) return;
  const nuts = state.cellContextuelle.getRow().getData().nuts3;
  state.drapeaux.add(nuts);
  grid.redraw(true);
  closeContextMenu();
  toast(`⚠️ ${nuts} marqué comme anomalie`, 'warning');
});

document.getElementById('ctx-unflag').addEventListener('click', () => {
  if (!state.cellContextuelle) return;
  const nuts = state.cellContextuelle.getRow().getData().nuts3;
  state.drapeaux.delete(nuts);
  state.anomalies.delete(nuts);
  grid.redraw(true);
  closeContextMenu();
  toast(`✅ Marquage retiré pour ${nuts}`, 'info');
});

async function detecterAnomalies(regle) {
  try {
    const result = await apiPost(`/regle?regle=${regle}&variable=${state.variableActive}&seuil=2.5`);
    state.anomalies.clear();
    (result.anomalies || []).forEach(nuts => state.anomalies.add(nuts));
    grid.redraw(true);
    const nb = state.anomalies.size;
    toast(`${nb} anomalie(s) détectée(s) pour "${state.variableActive}"`, nb > 0 ? 'warning' : 'info');
    if (nb > 0) {
      const lignes = (result.noms || result.anomalies).map((nom, i) => `
        <tr>
          <td>${result.anomalies[i]}</td>
          <td>${nom}</td>
          <td>${result.zscores ? result.zscores[i] : result.valeurs?.[i] ?? '—'}</td>
        </tr>
      `).join('');
      showModal(`Anomalies détectées (${regle})`, `
        <table class="modal-table">
          <thead><tr><th>NUTS3</th><th>Arrondissement</th><th>${regle === 'zscore' ? 'Z-score' : 'Valeur'}</th></tr></thead>
          <tbody>${lignes}</tbody>
        </table>
      `);
    }
  } catch (_) {}
}

function showModal(title, bodyHTML) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHTML;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

document.getElementById('modal-close').addEventListener('click', () => {
  document.getElementById('modal-overlay').classList.add('hidden');
});

document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay'))
    document.getElementById('modal-overlay').classList.add('hidden');
});

function buildHistoriqueHTML(data) {
  if (data.message) return `<p>${data.message}</p>`;
  const lignes = data.map(h => `
    <tr>
      <td>${h.timestamp}</td><td>${h.nuts3}</td><td>${h.variable}</td>
      <td>${h.valeur_avant}</td><td>${h.valeur_apres}</td><td>${h.motif}</td>
    </tr>
  `).join('');
  return `
    <table class="modal-table">
      <thead><tr><th>Date</th><th>NUTS3</th><th>Variable</th><th>Avant</th><th>Après</th><th>Motif</th></tr></thead>
      <tbody>${lignes}</tbody>
    </table>
  `;
}

document.getElementById('variable-select').addEventListener('change', e => {
  state.variableActive = e.target.value;
  state.anomalies.clear();
  refreshGrid();
});

document.getElementById('region-filter').addEventListener('change', e => {
  state.regionFiltre = e.target.value;
  refreshGrid();
});

document.getElementById('btn-detect').addEventListener('click', () => {
  detecterAnomalies(document.getElementById('regle-select').value);
});

document.getElementById('btn-export').addEventListener('click', () => {
  window.open(API + '/exporter', '_blank');
});

document.getElementById('btn-reset').addEventListener('click', async () => {
  if (!confirm('Réinitialiser toutes les données ? Les corrections seront perdues.')) return;
  try {
    await apiPost('/reinitialiser');
    state.anomalies.clear();
    state.drapeaux.clear();
    await rechargerDonnees();
    toast('Données réinitialisées', 'info');
  } catch (_) {}
});

async function rechargerDonnees() {
  const data = await apiGet('/arrondissements');
  state.data = Array.isArray(data) ? data : [];
  if (grid) { grid.setData(state.data); } else { initGrid(state.data); }
  updateStats();
}

async function verifierAPI() {
  const badge = document.getElementById('api-status');
  try {
    await apiGet('/variables');
    badge.textContent = 'API connectée';
    badge.className   = 'status-badge status-ok';
    return true;
  } catch (_) {
    badge.textContent = 'API non disponible';
    badge.className   = 'status-badge status-error';
    return false;
  }
}

(async () => {
  const ok = await verifierAPI();
  if (ok) await rechargerDonnees();
})();
