// Contagem semanal de treinos, sequência (streak) de semanas cumprindo a meta
// e mensagem motivacional. Semanas começam na segunda-feira.

function parse(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fmt(date) {
  return date.toISOString().slice(0, 10);
}

export function weekStartOf(dateStr) {
  const date = parse(dateStr);
  const offset = (date.getUTCDay() + 6) % 7; // segunda = 0
  date.setUTCDate(date.getUTCDate() - offset);
  return fmt(date);
}

export function shiftDays(dateStr, days) {
  const date = parse(dateStr);
  date.setUTCDate(date.getUTCDate() + days);
  return fmt(date);
}

function doneDays(done) {
  return Object.keys(done || {}).filter((d) => done[d] && /^\d{4}-\d{2}-\d{2}$/.test(d));
}

export function countInWeek(done, dateStr) {
  const start = weekStartOf(dateStr);
  const end = shiftDays(start, 6);
  return doneDays(done).filter((d) => d >= start && d <= end).length;
}

export function normalizeTarget(target) {
  const n = Math.round(Number(target));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 7) : 4;
}

// Semanas seguidas com a meta cumprida. A semana atual só soma quando a meta já
// foi batida; enquanto está em andamento, ela não quebra a sequência.
export function weeklyStreak(done, target, today) {
  const goal = normalizeTarget(target);
  let cursor = weekStartOf(today);
  let streak = 0;
  if (countInWeek(done, cursor) >= goal) streak += 1;
  cursor = shiftDays(cursor, -7);
  for (let guard = 0; guard < 600; guard += 1) {
    if (countInWeek(done, cursor) < goal) break;
    streak += 1;
    cursor = shiftDays(cursor, -7);
  }
  return streak;
}

export function weeklyMessage(count, target, streak) {
  const goal = normalizeTarget(target);
  if (count >= goal) {
    const weeks = streak === 1 ? "1 semana" : `${streak} semanas`;
    return `Meta da semana batida: ${count} de ${goal} treinos! Que orgulho. Sua sequência agora é de ${weeks} seguidas.`;
  }
  if (count === 0) return "Essa semana ainda não rolou, mas dá pra recomeçar hoje. Bora!";
  if (count <= 2) return "Você já começou, continue assim!";
  return `Você foi ${count} vezes treinar essa semana, continue assim!`;
}

// Progresso de uma meta numérica (funciona para aumentar ou diminuir um valor).
export function numericGoalProgress(start, current, target) {
  const blank = (v) => v === "" || v === null || v === undefined;
  if (blank(current) || blank(target)) return null;
  const s = blank(start) ? 0 : Number(start), c = Number(current), t = Number(target);
  if (![s, c, t].every(Number.isFinite)) return null;
  if (t === s) return c === t ? 100 : 0;
  const pct = ((c - s) / (t - s)) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}
