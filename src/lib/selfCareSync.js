// Sessões de Procedimentos estéticos vindas do Google Agenda ("Self care").
// Critério: evento de uma agenda cujo nome tem "self care" OU evento com "self care" no título/descrição.

const TAG = /#?\bself[\s_-]*care\b/i;

export function normalizeText(text) {
  return String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function isSelfCareEvent(event) {
  return TAG.test(normalizeText(event?.calName)) || TAG.test(normalizeText(event?.t)) || TAG.test(normalizeText(event?.desc));
}

// Título sem a marcação "self care" e sem separadores sobrando.
export function cleanSelfCareTitle(title) {
  const cleaned = String(title || "")
    .replace(/[[(]\s*#?self[\s_-]*care\s*[\])]/gi, " ")
    .replace(/#?\bself[\s_-]*care\b/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s:|·\-–—]+|[\s:|·\-–—]+$/g, "")
    .trim();
  return cleaned || "Self care";
}

// Nome para comparar: sem acentos, sem "self care" e sem marcações de sessão ("2ª sessão", "sessão 2 de 3", "(2/3)", "#2").
export function matchKey(text) {
  return normalizeText(cleanSelfCareTitle(text))
    .replace(/\(\s*\d+\s*(?:\/|de)\s*\d+\s*\)/g, " ")
    .replace(/\bsess(?:ao|oes)\s*(?:n[ºo.]?\s*)?\d+(?:\s*(?:\/|de)\s*\d+)?/g, " ")
    .replace(/\b\d+\s*(?:a|o|ª|º)?\s*sess(?:ao|oes)\b/g, " ")
    .replace(/\b\d+\s*\/\s*\d+\b/g, " ")
    .replace(/#\d+/g, " ")
    .replace(/\bsess(?:ao|oes)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Só junta nomes iguais depois da limpeza; na dúvida cria separado (dá para mesclar no app).
export function titlesMatch(a, b) {
  const x = matchKey(a);
  const y = matchKey(b);
  return !!x && x === y;
}

// Identificador estável do evento: agenda + UID (+ data, para cada ocorrência de evento repetido).
export function eventKey(event) {
  const raw = String(event.id || "");
  const local = raw.includes(":") && event.calId && raw.startsWith(`${event.calId}:`) ? raw.slice(event.calId.length + 1) : raw;
  const parts = local.split("_");
  const uid = event.uid || parts[0] || local;
  const recurring = event.rec === true || (event.rec === undefined && Number(parts[1]) > 0);
  return `${event.calId || ""}|${uid}${recurring ? `|${String(event.s || "").slice(0, 10)}` : ""}`;
}

export function eventToSession(event) {
  return {
    key: eventKey(event),
    title: event.t || "",
    start: event.s || "",
    end: event.e || "",
    allDay: !!event.ad,
    loc: event.loc || "",
    calName: event.calName || "",
  };
}

// Atualiza os cards: liga cada sessão ao card que já a tem, senão a um card de nome parecido,
// senão cria um card novo. Sessões que sumiram do Google saem. Devolve a mesma lista se nada mudou.
export function syncSelfCareSessions(beauty, events, { newId, today = new Date().toISOString().slice(0, 10) }) {
  // a leitura da agenda só traz eventos dos últimos 30 dias: sessões antigas que saíram dessa janela continuam como feitas
  const keepBefore = (() => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 25); return d.toISOString().slice(0, 10); })();
  const list = Array.isArray(beauty) ? beauty : [];
  const sessions = new Map();
  (events || []).filter(isSelfCareEvent).forEach((event) => {
    const session = eventToSession(event);
    if (!sessions.has(session.key)) sessions.set(session.key, session);
  });

  const holder = new Map();
  list.forEach((card) => (card.gcalSessions || []).forEach((session) => holder.set(session.key, card.id)));
  const assigned = new Map(list.map((card) => [card.id, []]));
  const created = [];
  sessions.forEach((session) => {
    let cardId = holder.get(session.key);
    if (!cardId || !assigned.has(cardId)) {
      const candidates = [...list.filter((card) => !card.archived), ...created];
      cardId = candidates.find((card) => titlesMatch(card.name, session.title))?.id;
    }
    if (!cardId) {
      const card = {
        id: newId(), name: cleanSelfCareTitle(session.title).replace(/\s*[-–:]?\s*\(?\s*\d+\s*(?:ª|º|a|o)?\s*sess[aã]o.*$/i, "").replace(/\s*\(\s*\d+\s*\/\s*\d+\s*\)\s*$/, "").trim() || cleanSelfCareTitle(session.title), procStatus: "quero", cost: "", history: [],
        region: "", degree: "", placeId: "", bodyArea: "", category: "", goal: "", image: "",
        professional: "", clinic: session.loc || "", instagram: "", priority: "alta", plannedSessions: "", nextExpenseDate: "",
        recurring: false, frequencyUnit: "meses", frequencyValue: "", result: "", notes: "", link: "",
        gcalAuto: true, gcalSessions: [], financeRegister: true, financeMode: "total",
      };
      created.push(card);
      assigned.set(card.id, []);
      cardId = card.id;
    }
    assigned.get(cardId).push(session);
  });

  let changed = created.length > 0;
  // número de sessões acompanha a agenda, a menos que tenha sido informado à mão
  const withCount = (card, gcalSessions) => {
    const auto = card.plannedSessionsAuto === true || !(Number(card.plannedSessions) > 0);
    if (!auto || !gcalSessions.length) return { ...card, gcalSessions };
    return { ...card, gcalSessions, plannedSessions: gcalSessions.length, plannedSessionsAuto: true };
  };
  const updated = list.flatMap((card) => {
    const before = card.gcalSessions || [];
    const kept = before.filter((session) => !sessions.has(session.key) && String(session.start || "").slice(0, 10) < keepBefore);
    const next = [...kept, ...(assigned.get(card.id) || [])].sort((a, b) => a.start.localeCompare(b.start));
    if (!before.length && !next.length) return [card];
    // card criado pela agenda, ainda intocado e sem sessões: sai junto com o evento
    if (!next.length && card.gcalAuto && !card.userEdited && !(card.history || []).length) { changed = true; return []; }
    const result = withCount(card, next);
    if (JSON.stringify(result) === JSON.stringify(card)) return [card];
    changed = true;
    return [result];
  });
  if (!changed) return list;
  return [...created.map((card) => withCount(card, assigned.get(card.id))), ...updated];
}
