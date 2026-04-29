(() => {
  'use strict';

  const STORAGE_KEY = 'app-correr-sessions-v1';
  const app = document.getElementById('app');

  // ---------- utilidades ----------
  const fmtTime = (ms) => {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  };

  const fmtDate = (ts) => {
    const d = new Date(ts);
    return d.toLocaleString('es-ES', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  const labelOf = (type) => type === 'run' ? 'Corriendo' : 'Andando';

  const cloneTpl = (id) => document.getElementById(id).content.firstElementChild.cloneNode(true);

  const render = (node) => {
    app.innerHTML = '';
    app.appendChild(node);
  };

  // ---------- almacenamiento ----------
  const loadSessions = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  };
  const saveSessions = (list) => localStorage.setItem(STORAGE_KEY, JSON.stringify(list));

  const addSession = (session) => {
    const list = loadSessions();
    list.unshift(session);
    saveSessions(list);
  };

  const deleteSession = (id) => {
    saveSessions(loadSessions().filter(s => s.id !== id));
  };

  const sumByType = (segments, type) =>
    segments.filter(s => s.type === type).reduce((acc, s) => acc + s.duration, 0);

  // ---------- exportar CSV ----------
  const exportCSV = () => {
    const sessions = loadSessions();
    if (!sessions.length) return;
    const rows = [['sesion_id', 'fecha', 'tramo_n', 'tipo', 'duracion_segundos', 'bpm', 'velocidad_kmh']];
    sessions.forEach(s => {
      s.segments.forEach((seg, i) => {
        rows.push([
          s.id,
          new Date(s.startedAt).toISOString(),
          i + 1,
          seg.type === 'run' ? 'corriendo' : 'andando',
          Math.round(seg.duration / 1000),
          seg.bpm ?? '',
          seg.speed ?? '',
        ]);
      });
    });
    const csv = rows.map(r => r.map(v => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `correr-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // ---------- pantalla: inicio ----------
  const renderHome = () => {
    const node = cloneTpl('tpl-home');
    const list = node.querySelector('[data-list]');
    const empty = node.querySelector('[data-empty]');
    const actions = node.querySelector('[data-actions]');
    const sessions = loadSessions();

    if (!sessions.length) {
      empty.hidden = false;
    } else {
      actions.hidden = false;
      sessions.forEach(s => {
        const li = document.createElement('li');
        li.className = 'history-item';
        li.dataset.id = s.id;
        const total = s.segments.reduce((a, x) => a + x.duration, 0);
        const walk = sumByType(s.segments, 'walk');
        const run = sumByType(s.segments, 'run');
        li.innerHTML = `
          <div class="row">
            <span class="date"></span>
            <span class="total"></span>
          </div>
          <div class="meta"></div>
        `;
        li.querySelector('.date').textContent = fmtDate(s.startedAt);
        li.querySelector('.total').textContent = fmtTime(total);
        li.querySelector('.meta').textContent =
          `${s.segments.length} tramos · And. ${fmtTime(walk)} · Corr. ${fmtTime(run)}`;
        li.addEventListener('click', () => renderDetail(s.id));
        list.appendChild(li);
      });
    }

    node.querySelector('[data-action="start"]').addEventListener('click', startWorkout);
    const exportBtn = node.querySelector('[data-action="export"]');
    if (exportBtn) exportBtn.addEventListener('click', exportCSV);
    const clearBtn = node.querySelector('[data-action="clear-all"]');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      if (confirm('¿Borrar todas las sesiones guardadas? Esto no se puede deshacer.')) {
        saveSessions([]);
        renderHome();
      }
    });

    render(node);
  };

  // ---------- pantalla: entrenamiento ----------
  let workoutState = null; // { startedAt, segments, currentType, segmentStart, tickHandle }

  const startWorkout = () => {
    workoutState = {
      startedAt: Date.now(),
      segments: [],
      currentType: 'walk',
      segmentStart: Date.now(),
      tickHandle: null,
    };
    renderWorkout();
  };

  const renderWorkout = () => {
    const node = cloneTpl('tpl-workout');
    const banner = node.querySelector('[data-state-banner]');
    const stateLabel = node.querySelector('[data-state-label]');
    const segTime = node.querySelector('[data-segment-time]');
    const totalTime = node.querySelector('[data-total-time]');
    const mini = node.querySelector('[data-segments-mini]');
    const toggleBtn = node.querySelector('[data-action="toggle"]');
    const finishBtn = node.querySelector('[data-action="finish"]');

    const updateView = () => {
      const now = Date.now();
      const segMs = now - workoutState.segmentStart;
      const finishedSum = workoutState.segments.reduce((a, x) => a + x.duration, 0);
      stateLabel.textContent = labelOf(workoutState.currentType);
      banner.classList.toggle('is-running', workoutState.currentType === 'run');
      segTime.textContent = fmtTime(segMs);
      totalTime.textContent = fmtTime(finishedSum + segMs);
      const next = workoutState.currentType === 'walk' ? 'Corriendo' : 'Andando';
      toggleBtn.textContent = `Cambiar a ${next}`;
      mini.innerHTML = '';
      workoutState.segments.forEach((s, i) => {
        const chip = document.createElement('span');
        chip.className = `chip ${s.type}`;
        chip.textContent = `${i + 1}. ${labelOf(s.type).slice(0,3)} ${fmtTime(s.duration)}`;
        mini.appendChild(chip);
      });
    };

    const tick = () => updateView();
    workoutState.tickHandle = setInterval(tick, 250);
    updateView();

    toggleBtn.addEventListener('click', () => closeSegment(false));
    finishBtn.addEventListener('click', () => closeSegment(true));

    render(node);
  };

  const closeSegment = (isFinish) => {
    if (!workoutState) return;
    const now = Date.now();
    const duration = now - workoutState.segmentStart;
    const type = workoutState.currentType;

    // Si dura menos de 1s, ignoramos para no ensuciar — pero sólo en cambios
    if (!isFinish && duration < 1000) {
      return;
    }

    openSegmentForm({
      type,
      duration,
      isFinish,
    });
  };

  const openSegmentForm = ({ type, duration, isFinish }) => {
    const node = cloneTpl('tpl-segment-form');
    node.querySelector('[data-title]').textContent =
      isFinish ? `Último tramo: ${labelOf(type)}` : `Tramo: ${labelOf(type)}`;
    node.querySelector('[data-sub]').textContent =
      `Duración ${fmtTime(duration)}${isFinish ? ' · Después se guarda la sesión' : ''}`;
    const bpmInput = node.querySelector('[data-field="bpm"]');
    const speedInput = node.querySelector('[data-field="speed"]');

    const finalize = (withData) => {
      const segment = { type, duration };
      if (withData) {
        const bpm = parseInt(bpmInput.value, 10);
        const speed = parseFloat(speedInput.value);
        if (!isNaN(bpm)) segment.bpm = bpm;
        if (!isNaN(speed)) segment.speed = speed;
      }
      workoutState.segments.push(segment);
      node.remove();
      if (isFinish) {
        clearInterval(workoutState.tickHandle);
        renderSummary();
      } else {
        workoutState.currentType = workoutState.currentType === 'walk' ? 'run' : 'walk';
        workoutState.segmentStart = Date.now();
      }
    };

    node.querySelector('[data-action="skip"]').addEventListener('click', () => finalize(false));
    node.querySelector('[data-action="save"]').addEventListener('click', () => finalize(true));

    document.body.appendChild(node);
    setTimeout(() => bpmInput.focus(), 50);
  };

  // ---------- pantalla: resumen ----------
  const renderSummary = () => {
    const node = cloneTpl('tpl-summary');
    const segments = workoutState.segments;
    const startedAt = workoutState.startedAt;
    const total = segments.reduce((a, x) => a + x.duration, 0);
    const walk = sumByType(segments, 'walk');
    const run = sumByType(segments, 'run');

    node.querySelector('[data-date]').textContent = fmtDate(startedAt);
    node.querySelector('[data-total]').textContent = fmtTime(total);
    node.querySelector('[data-walk]').textContent = fmtTime(walk);
    node.querySelector('[data-run]').textContent = fmtTime(run);
    node.querySelector('[data-count]').textContent = String(segments.length);

    const list = node.querySelector('[data-segments]');
    fillSegmentsList(list, segments);

    node.querySelector('[data-action="save"]').addEventListener('click', () => {
      const id = `${startedAt}-${Math.random().toString(36).slice(2,7)}`;
      addSession({ id, startedAt, segments });
      workoutState = null;
      renderHome();
    });
    node.querySelector('[data-action="discard"]').addEventListener('click', () => {
      if (confirm('¿Descartar esta sesión sin guardar?')) {
        workoutState = null;
        renderHome();
      }
    });

    render(node);
  };

  const fillSegmentsList = (list, segments) => {
    segments.forEach(seg => {
      const li = document.createElement('li');
      const meta = [];
      if (seg.bpm != null) meta.push(`${seg.bpm} ppm`);
      if (seg.speed != null) meta.push(`${seg.speed} km/h`);
      li.innerHTML = `
        <div class="seg-main">
          <span class="seg-type ${seg.type}"></span>
          <span class="seg-meta"></span>
        </div>
        <span class="seg-time"></span>
      `;
      li.querySelector('.seg-type').textContent = labelOf(seg.type);
      li.querySelector('.seg-meta').textContent = meta.join(' · ') || '—';
      li.querySelector('.seg-time').textContent = fmtTime(seg.duration);
      list.appendChild(li);
    });
  };

  // ---------- pantalla: detalle ----------
  const renderDetail = (id) => {
    const session = loadSessions().find(s => s.id === id);
    if (!session) { renderHome(); return; }
    const node = cloneTpl('tpl-detail');
    const total = session.segments.reduce((a, x) => a + x.duration, 0);
    const walk = sumByType(session.segments, 'walk');
    const run = sumByType(session.segments, 'run');

    node.querySelector('[data-date]').textContent = fmtDate(session.startedAt);
    node.querySelector('[data-total]').textContent = fmtTime(total);
    node.querySelector('[data-walk]').textContent = fmtTime(walk);
    node.querySelector('[data-run]').textContent = fmtTime(run);
    node.querySelector('[data-count]').textContent = String(session.segments.length);
    fillSegmentsList(node.querySelector('[data-segments]'), session.segments);

    node.querySelector('[data-action="back"]').addEventListener('click', renderHome);
    node.querySelector('[data-action="delete"]').addEventListener('click', () => {
      if (confirm('¿Borrar esta sesión?')) {
        deleteSession(id);
        renderHome();
      }
    });

    render(node);
  };

  // ---------- aviso al cerrar durante entrenamiento ----------
  window.addEventListener('beforeunload', (e) => {
    if (workoutState) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // ---------- service worker (offline) ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  // ---------- arranque ----------
  renderHome();
})();
