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

  const fmtKm = (km) => {
    if (km == null || km === 0) return '—';
    return `${km.toFixed(2)} km`;
  };

  const labelOf = (type) => type === 'run' ? 'Corriendo' : 'Andando';

  const cloneTpl = (id) => document.getElementById(id).content.firstElementChild.cloneNode(true);

  const render = (node) => {
    app.innerHTML = '';
    app.appendChild(node);
  };

  const sumByType = (segments, type) =>
    segments.filter(s => s.type === type).reduce((acc, s) => acc + s.duration, 0);

  const sumKm = (segments) =>
    segments.reduce((acc, s) => acc + (typeof s.km === 'number' ? s.km : 0), 0);

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

  const updateSession = (id, mutator) => {
    const list = loadSessions();
    const idx = list.findIndex(s => s.id === id);
    if (idx === -1) return null;
    mutator(list[idx]);
    saveSessions(list);
    return list[idx];
  };

  const deleteSession = (id) => {
    saveSessions(loadSessions().filter(s => s.id !== id));
  };

  // ---------- exportar CSV ----------
  const exportCSV = () => {
    const sessions = loadSessions();
    if (!sessions.length) return;
    const rows = [['sesion_id', 'fecha', 'tramo_n', 'tipo', 'duracion_segundos', 'bpm', 'velocidad_kmh', 'km']];
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
          seg.km ?? '',
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
    const count = node.querySelector('[data-count]');
    const sessions = loadSessions();

    count.textContent = sessions.length ? `${sessions.length} sesiones` : '';

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
        const km = sumKm(s.segments);
        li.innerHTML = `
          <div class="row">
            <span class="date"></span>
            <span class="total"></span>
          </div>
          <div class="meta">
            <span><span class="dot dot-walk"></span><span class="walk-t"></span></span>
            <span><span class="dot dot-run"></span><span class="run-t"></span></span>
            <span class="seg-count"></span>
            <span class="km-t" hidden></span>
          </div>
        `;
        li.querySelector('.date').textContent = fmtDate(s.startedAt);
        li.querySelector('.total').textContent = fmtTime(total);
        li.querySelector('.walk-t').textContent = fmtTime(walk);
        li.querySelector('.run-t').textContent = fmtTime(run);
        li.querySelector('.seg-count').textContent = `${s.segments.length} tramos`;
        if (km > 0) {
          const kmEl = li.querySelector('.km-t');
          kmEl.textContent = fmtKm(km);
          kmEl.hidden = false;
        }
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
    const stateTotal = node.querySelector('[data-state-total]');
    const segList = node.querySelector('[data-segments]');
    const segEmpty = node.querySelector('[data-empty]');
    const toggleBtn = node.querySelector('[data-action="toggle"]');
    const finishBtn = node.querySelector('[data-action="finish"]');

    const refreshList = () => {
      segList.innerHTML = '';
      if (workoutState.segments.length === 0) {
        segEmpty.hidden = false;
      } else {
        segEmpty.hidden = true;
        workoutState.segments.forEach((seg, i) => {
          segList.appendChild(buildSegmentItem(seg, i, () => {
            openSegmentEditor(seg, () => {
              refreshList();
            });
          }));
        });
      }
    };

    const updateView = () => {
      const now = Date.now();
      const segMs = now - workoutState.segmentStart;
      const finishedSum = workoutState.segments.reduce((a, x) => a + x.duration, 0);
      stateLabel.textContent = labelOf(workoutState.currentType);
      banner.classList.toggle('is-running', workoutState.currentType === 'run');
      segTime.textContent = fmtTime(segMs);
      stateTotal.textContent = `Total ${fmtTime(finishedSum + segMs)}`;
      const next = workoutState.currentType === 'walk' ? 'Corriendo' : 'Andando';
      toggleBtn.textContent = `Cambiar a ${next}`;
    };

    workoutState.tickHandle = setInterval(updateView, 250);
    updateView();
    refreshList();

    toggleBtn.addEventListener('click', () => {
      const now = Date.now();
      const duration = now - workoutState.segmentStart;
      if (duration < 1000) return; // evita cambios accidentales <1s
      workoutState.segments.push({ type: workoutState.currentType, duration });
      workoutState.currentType = workoutState.currentType === 'walk' ? 'run' : 'walk';
      workoutState.segmentStart = Date.now();
      updateView();
      refreshList();
    });

    finishBtn.addEventListener('click', () => {
      const now = Date.now();
      const duration = now - workoutState.segmentStart;
      if (duration >= 1000) {
        workoutState.segments.push({ type: workoutState.currentType, duration });
      }
      clearInterval(workoutState.tickHandle);
      if (workoutState.segments.length === 0) {
        if (confirm('No hay tramos registrados. ¿Cancelar la sesión?')) {
          workoutState = null;
          renderHome();
        } else {
          // reanudar
          workoutState.segmentStart = Date.now();
          renderWorkout();
        }
        return;
      }
      renderSummary();
    });

    render(node);
  };

  // ---------- elemento de un tramo (compartido) ----------
  const buildSegmentItem = (seg, i, onClick) => {
    const li = document.createElement('li');
    li.className = 'seg-item';
    li.innerHTML = `
      <span class="seg-num"></span>
      <div class="seg-main">
        <span class="seg-type"></span>
        <span class="seg-meta"></span>
      </div>
      <span class="seg-time"></span>
    `;
    li.querySelector('.seg-num').textContent = String(i + 1);
    const typeEl = li.querySelector('.seg-type');
    typeEl.textContent = labelOf(seg.type);
    typeEl.classList.add(seg.type);
    li.querySelector('.seg-time').textContent = fmtTime(seg.duration);

    const metaEl = li.querySelector('.seg-meta');
    const meta = [];
    if (typeof seg.bpm === 'number') meta.push(`${seg.bpm} ppm`);
    if (typeof seg.speed === 'number') meta.push(`${seg.speed} km/h`);
    if (typeof seg.km === 'number') meta.push(`${seg.km.toFixed(2)} km`);
    if (meta.length === 0) {
      metaEl.innerHTML = `<span class="placeholder">Toca para añadir datos</span>`;
    } else {
      metaEl.textContent = meta.join(' · ');
    }
    if (onClick) li.addEventListener('click', onClick);
    return li;
  };

  // ---------- editor de tramo (modal) ----------
  const openSegmentEditor = (segment, onSaved) => {
    const node = cloneTpl('tpl-segment-form');
    const titleEl = node.querySelector('[data-title]');
    const pillEl = node.querySelector('[data-pill]');
    const durationEl = node.querySelector('[data-duration]');
    const bpmInput = node.querySelector('[data-field="bpm"]');
    const speedInput = node.querySelector('[data-field="speed"]');
    const kmInput = node.querySelector('[data-field="km"]');

    titleEl.textContent = 'Datos del tramo';
    pillEl.textContent = labelOf(segment.type);
    pillEl.classList.toggle('run', segment.type === 'run');
    durationEl.textContent = fmtTime(segment.duration);

    if (typeof segment.bpm === 'number') bpmInput.value = segment.bpm;
    if (typeof segment.speed === 'number') speedInput.value = segment.speed;
    if (typeof segment.km === 'number') kmInput.value = segment.km;

    const close = () => {
      node.style.animation = 'fade 0.15s ease reverse';
      setTimeout(() => node.remove(), 140);
    };

    node.querySelector('[data-action="close"]').addEventListener('click', close);
    node.querySelector('[data-backdrop]').addEventListener('click', (e) => {
      if (e.target === node) close();
    });

    node.querySelector('[data-action="clear"]').addEventListener('click', () => {
      delete segment.bpm;
      delete segment.speed;
      delete segment.km;
      if (onSaved) onSaved();
      close();
    });

    node.querySelector('[data-action="save"]').addEventListener('click', () => {
      const bpm = parseInt(bpmInput.value, 10);
      const speed = parseFloat(speedInput.value);
      const km = parseFloat(kmInput.value);
      if (!isNaN(bpm)) segment.bpm = bpm; else delete segment.bpm;
      if (!isNaN(speed)) segment.speed = speed; else delete segment.speed;
      if (!isNaN(km)) segment.km = km; else delete segment.km;
      if (onSaved) onSaved();
      close();
    });

    document.body.appendChild(node);
    setTimeout(() => bpmInput.focus(), 80);
  };

  // ---------- pantalla: resumen ----------
  const renderSummary = () => {
    const segments = workoutState.segments;
    const startedAt = workoutState.startedAt;

    const draw = () => {
      const node = cloneTpl('tpl-summary');
      const total = segments.reduce((a, x) => a + x.duration, 0);
      const walk = sumByType(segments, 'walk');
      const run = sumByType(segments, 'run');
      const km = sumKm(segments);

      node.querySelector('[data-date]').textContent = fmtDate(startedAt);
      node.querySelector('[data-total]').textContent = fmtTime(total);
      node.querySelector('[data-walk]').textContent = fmtTime(walk);
      node.querySelector('[data-run]').textContent = fmtTime(run);
      node.querySelector('[data-km]').textContent = fmtKm(km);
      node.querySelector('[data-count]').textContent = `(${segments.length})`;

      const list = node.querySelector('[data-segments]');
      segments.forEach((seg, i) => {
        list.appendChild(buildSegmentItem(seg, i, () => {
          openSegmentEditor(seg, draw);
        }));
      });

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

    draw();
  };

  // ---------- pantalla: detalle ----------
  const renderDetail = (id) => {
    const session = loadSessions().find(s => s.id === id);
    if (!session) { renderHome(); return; }

    const draw = (current) => {
      const node = cloneTpl('tpl-detail');
      const total = current.segments.reduce((a, x) => a + x.duration, 0);
      const walk = sumByType(current.segments, 'walk');
      const run = sumByType(current.segments, 'run');
      const km = sumKm(current.segments);

      node.querySelector('[data-date]').textContent = fmtDate(current.startedAt);
      node.querySelector('[data-total]').textContent = fmtTime(total);
      node.querySelector('[data-walk]').textContent = fmtTime(walk);
      node.querySelector('[data-run]').textContent = fmtTime(run);
      node.querySelector('[data-km]').textContent = fmtKm(km);
      node.querySelector('[data-count]').textContent = `(${current.segments.length})`;

      const list = node.querySelector('[data-segments]');
      current.segments.forEach((seg, i) => {
        list.appendChild(buildSegmentItem(seg, i, () => {
          openSegmentEditor(seg, () => {
            // persistir cambios en localStorage
            const updated = updateSession(id, (s) => {
              s.segments[i] = seg;
            });
            if (updated) draw(updated);
          });
        }));
      });

      node.querySelector('[data-action="back"]').addEventListener('click', renderHome);
      node.querySelector('[data-action="delete"]').addEventListener('click', () => {
        if (confirm('¿Borrar esta sesión?')) {
          deleteSession(id);
          renderHome();
        }
      });

      render(node);
    };

    draw(session);
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
