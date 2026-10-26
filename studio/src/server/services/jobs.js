import { store } from '../store.js';
import { STATUS, nowIso } from '../util.js';

/** Aufträge & Verlauf: jede ausführende Aktion wird protokolliert. */
export function createJob({ type, title, refType, refId, simulated = false, status = STATUS.RUNNING }) {
  return store().jobs.put({ type, title, refType, refId, simulated, status, steps: [{ at: nowIso(), msg: 'Gestartet' }], result: null, error: null });
}

export function logJob(id, msg) {
  return store().jobs.update(id, (j) => { j.steps.push({ at: nowIso(), msg }); return j; });
}

export function finishJob(id, status, { result = null, error = null, msg } = {}) {
  return store().jobs.update(id, (j) => {
    j.status = status;
    j.result = result;
    j.error = error;
    j.finishedAt = nowIso();
    j.steps.push({ at: nowIso(), msg: msg || status });
    return j;
  });
}

export function listJobs({ refId, limit = 200 } = {}) {
  return store().jobs.list(refId ? (j) => j.refId === refId : null).slice(0, limit);
}

/**
 * Nach Absturz/Neustart: Vorgänge, die noch „Wird ausgeführt“ waren, haben ein unklares Ergebnis.
 * Sie werden NICHT automatisch wiederholt, sondern als „Ergebnis muss geprüft werden“ markiert.
 */
export function recoverInterruptedJobs() {
  const affected = [];
  for (const j of store().jobs.list((x) => x.status === STATUS.RUNNING)) {
    finishJob(j.id, STATUS.CHECK, { error: 'Vorgang wurde unterbrochen (Programm beendet oder Verbindung verloren). Ergebnis bitte prüfen.', msg: 'Unterbrochen – Ergebnis unklar' });
    affected.push(j);
  }
  for (const p of store().products.list((x) => x.publish?.state === 'running')) {
    store().products.update(p.id, (d) => { d.publish.state = 'unknown'; d.status = STATUS.CHECK; return d; });
  }
  for (const w of store().websiteDrafts.list((x) => x.apply?.state === 'running')) {
    store().websiteDrafts.update(w.id, (d) => { d.apply.state = 'unknown'; d.status = STATUS.CHECK; return d; });
  }
  return affected;
}
