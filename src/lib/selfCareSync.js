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

function matchKey(text) {
  return normalizeText(cleanSelfCareTitle(text)).replace(/[^a-z0-9]+/g, " ").trim();
}

export function titlesMatch(a, b) {
  const x = matchKey(a);
  const y = matchKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const shorter = x.length <= y.length ? x : y;
  const longer = x.length <= y.length ? y : x;
  return shorter.length >= 4 && (` ${longer} `).includes(` ${shorter} `);
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
export function syncSelfCareSessions(beauty, events, { newId }) {
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
      const exact = candidates.find((card) => matchKey(card.name) === matchKey(session.title));
      const similar = exact || candidates.find((card) => titlesMatch(card.name, session.title));
      cardId = similar?.id;
    }
    if (!cardId) {
      const card = {
        id: newId(), name: cleanSelfCareTitle(session.title), procStatus: "quero", cost: "", history: [],
        region: "", degree: "", placeId: "", bodyArea: "", category: "", goal: "", image: "",
        professional: "", clinic: session.loc || "", instagram: "", priority: "alta", plannedSessions: "", nextExpenseDate: "",
        recurring: false, frequencyUnit: "meses", frequencyValue: "", result: "", notes: "", link: "",
        gcalAuto: true, gcalSessions: [],
      };
      created.push(card);
      assigned.set(card.id, []);
      cardId = card.id;
    }
    assigned.get(cardId).push(session);
  });

  let changed = created.length > 0;
  const updated = list.flatMap((card) => {
    const next = (assigned.get(card.id) || []).sort((a, b) => a.start.localeCompare(b.start));
    const before = card.gcalSessions || [];
    if (!before.length && !next.length) return [card];
    // card criado pela agenda, ainda intocado e sem sessões: sai junto com o evento
    if (!next.length && card.gcalAuto && !card.userEdited && !(card.history || []).length) { changed = true; return []; }
    if (JSON.stringify(before) === JSON.stringify(next)) return [card];
    changed = true;
    return [{ ...card, gcalSessions: next }];
  });
  if (!changed) return list;
  return [...created.map((card) => ({ ...card, gcalSessions: assigned.get(card.id) })), ...updated];
}
