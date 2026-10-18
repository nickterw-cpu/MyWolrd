import React, { useEffect, useState, useMemo, useCallback, useRef, createContext, useContext } from "react";
import { reloadUserData, storageDelete, storageGet, storageSet } from "./src/lib/userData.js";
import { getSupabase } from "./src/lib/supabase.js";
import { localDateStr } from "./src/lib/localDate.js";
import { shareOrDownloadFile } from "./src/lib/shareFile.js";
import { allocationValue, summarizeFinanceMonth } from "./src/lib/financePlan.js";
import { notify } from "./src/components/ToastHost.jsx";
import {
  Home, CalendarDays, Target, Repeat, Wallet, NotebookPen, Link2, Settings as SettingsIcon,
  Plus, Trash2, Pencil, X, Check, Search, Download, Upload, Sparkles, Flame, ChevronLeft, ChevronRight,
  GraduationCap, Briefcase, Sparkle, Image as ImageIcon, BookHeart, SearchCheck, Compass,
  HardDrive, Mail, FileText, BookOpen, ShoppingBag, ShoppingCart, Heart, Bot, Palette, ListChecks
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

/* ---------------------------------------------------------------------- */
/* STORAGE                                                                 */
/* ---------------------------------------------------------------------- */

const KEYS = {
  tasks: "central:tasks",
  goals: "central:goals",
  habits: "central:habits",
  finance: "central:finance",
  notes: "central:notes",
  areas: "central:areas",
  apps: "central:apps",
  settings: "central:settings",
  study: "central:study",
  career: "central:career",
  routines: "central:routines",
  beauty: "central:beauty",
  vision: "central:vision",
  journal: "central:journal",
  shopping: "central:shopping",
  house: "central:house",
  hobbies: "central:hobbies",
  personaldev: "central:personaldev",
  selfcare: "central:selfcare",
  accounts: "central:accounts",
  cards: "central:cards",
  pages: "central:pages",
  places: "central:places",
  investments: "central:investments",
  studyareas: "central:studyareas",
  gcal: "central:gcal",
};

const uid = () => Math.random().toString(36).slice(2, 10);
const todayStr = () => localDateStr();
const fmtBRL = (n) =>
  (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDateShort = (d) => {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${day}/${m}`;
};

/* ---------------------------------------------------------------------- */
/* BASE: cores de progresso, autosave, confirmações                       */
/* ---------------------------------------------------------------------- */

// Cor proporcional ao percentual: quanto menor, mais vermelho; perto de 50%, amarelo; perto de 100%, verde.
function progressColor(pct) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  if (p >= 100) return "#3E9A5A";
  if (p >= 90) return "#74BA5C";
  if (p >= 70) return "#B4BC32";
  if (p >= 50) return "#E3B22E";
  if (p >= 30) return "#D9532F";
  return "#C8453A";
}

function upsertById(list, data, extraNew) {
  const exists = list.some((x) => x.id === data.id);
  return exists
    ? list.map((x) => (x.id === data.id ? { ...x, ...data } : x))
    : [{ ...data, ...(extraNew || {}) }, ...list];
}

const READY_KEYS = ["name", "title", "criterio", "subject", "content", "desc", "item", "text", "gratitude"];
function isFormReady(form) {
  if (form && form.id) return true;
  return READY_KEYS.some((k) => typeof form[k] === "string" && form[k].trim() !== "");
}

// Salva sozinho, pouco depois de qualquer alteração (e ao fechar a janela).
function useAutoSave(form, onSave, finalize, forcedId, isReady = isFormReady) {
  const [status, setStatus] = useState("");
  const latest = useRef({ form, onSave, finalize, isReady });
  latest.current = { form, onSave, finalize, isReady };
  const timer = useRef(null);
  const dirty = useRef(false);
  const mounted = useRef(true);
  const first = useRef(true);
  const newId = useRef(forcedId || uid());

  const flush = () => {
    clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current) return;
    const { form: f, onSave: save, finalize: fin, isReady: ready } = latest.current;
    if (!ready(f)) { if (mounted.current) setStatus(""); return; }
    dirty.current = false;
    const data = fin ? fin(f) : f;
    if (!data) { if (mounted.current) setStatus(""); return; }
    save(data.id ? data : { ...data, id: newId.current });
    if (mounted.current) setStatus("salvo");
  };

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    dirty.current = true;
    setStatus("salvando");
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 450);
  }, [form]);

  useEffect(() => () => { mounted.current = false; flush(); }, []);
  return status;
}

function AutoSaveFooter({ status, onClose }) {
  return (
    <div className="cr-row" style={{ justifyContent: "space-between", marginTop: 14, alignItems: "center" }}>
      <span className="cr-sub" style={{ margin: 0, fontSize: 12 }}>
        {status === "salvando" ? "Salvando…" : status === "salvo" ? "✓ Salvo automaticamente" : "As alterações são salvas sozinhas"}
      </span>
      <button className="cr-btn primary" onClick={onClose}>Concluir</button>
    </div>
  );
}

function ConfirmModal({ title, message, confirmLabel, onConfirm, onCancel }) {
  return (
    <Modal size="small" title={title || "Tem certeza?"} onClose={onCancel}>
      <p style={{ fontSize: 14, lineHeight: 1.5, marginTop: 0 }}>{message}</p>
      <div className="cr-row" style={{ justifyContent: "flex-end", gap: 8 }}>
        <button className="cr-btn" onClick={onCancel}>Cancelar</button>
        <button className="cr-btn primary" style={{ background: "#A1493C" }} onClick={onConfirm}>{confirmLabel || "Excluir"}</button>
      </div>
    </Modal>
  );
}

// Ao concluir uma tarefa recorrente, já cria a próxima ocorrência.
function nextRecurringDate(dateStr, repeat) {
  if (!dateStr) return "";
  if (repeat === "diaria") return addDays(dateStr, 1);
  if (repeat === "semanal") return addDays(dateStr, 7);
  if (repeat === "quinzenal") return addDays(dateStr, 14);
  if (repeat === "mensal") return addMonths(dateStr, 1);
  return "";
}

function toggleTaskDone(tasks, id) {
  const target = tasks.find((x) => x.id === id);
  if (!target) return tasks;
  const nowDone = !target.done;
  const nextStatus = defaultTaskStatus(nowDone);
  let next = tasks.map((x) => (x.id === id ? {
    ...x,
    done: nowDone,
    status: nextStatus.id,
    doneAt: nowDone ? todayStr() : "",
  } : x));
  if (nowDone && target.repeat && target.repeat !== "nenhuma" && !target.nextCreated && target.dueDate) {
    const nextDate = nextRecurringDate(target.dueDate, target.repeat);
    if (nextDate) {
      next = next.map((x) => (x.id === id ? { ...x, nextCreated: true } : x));
      next = [{
        ...target, id: uid(), dueDate: nextDate, done: false, status: defaultTaskStatus(false).id,
        doneAt: "", nextCreated: false,
      }, ...next];
    }
  }
  return next;
}


async function verifyStorageWrite(content) {
  try {
    const testKey = "central:vision-write-test";
    const written = await storageSet(testKey, content);
    if (!written) throw new Error("Falha ao gravar no Supabase");
    const readBack = await storageGet(testKey, null);
    if (readBack !== content) throw new Error("Falha ao confirmar a gravação");
    await storageDelete(testKey);
    return true;
  } catch (e) {
    console.error("Falha ao verificar gravação no Supabase", e);
    return false;
  }
}

/* ---------------------------------------------------------------------- */
/* LISTAS EDITÁVEIS (status, categorias, tipos): criar, renomear, excluir, reordenar */
/* ---------------------------------------------------------------------- */

const LIST_REGISTRY = {
  goalStatus: {
    label: "Status das metas", closedFlag: true, flagLabel: "encerra a meta", usedBy: [["goals", "status"]],
    defaults: [
      { id: "planejada", name: "Não iniciada" }, { id: "em andamento", name: "Em andamento" }, { id: "pausada", name: "Pausada" },
      { id: "concluida", name: "Concluída", closed: true }, { id: "cancelada", name: "Cancelada", closed: true },
    ],
  },
  procStatus: {
    label: "Status dos procedimentos", usedBy: [["beauty", "procStatus"]],
    legacy: { vou: "Vou fazer", avaliacao: "Comentei / estou avaliando" },
    defaults: [
      { id: "quero", name: "Quero fazer" }, { id: "comecei", name: "Comecei" }, { id: "jafiz", name: "Já fiz" },
      { id: "novamente", name: "Quero fazer novamente" }, { id: "pausado", name: "Pausado" },
      { id: "nunca", name: "Nunca mais vou fazer" }, { id: "talvez", name: "Talvez mais para frente" },
    ],
  },
  procRegion: {
    label: "Área dos procedimentos", usedBy: [["beauty", "region"]],
    defaults: [{ id: "Facial", name: "Facial" }, { id: "Corporal", name: "Corporal" }],
  },
  procDegree: {
    label: "Tipo de procedimento", usedBy: [["beauty", "degree"]],
    defaults: [{ id: "Invasivo", name: "Invasivo" }, { id: "Minimamente invasivo", name: "Minimamente invasivo" }, { id: "Não invasivo", name: "Não invasivo" }],
  },
  selfcareStatus: {
    label: "Status do Self-care", usedBy: [["selfcare", "status"]],
    defaults: [
      { id: "cuidando", name: "Cuidando" }, { id: "planejado", name: "Planejado" }, { id: "concluido", name: "Concluído" },
      { id: "pausado", name: "Pausado" }, { id: "comecar", name: "Quero começar" },
    ],
  },
  hobbyCategory: {
    label: "Categorias de hobbies", usedBy: [["hobbies", "category"]],
    defaults: ["Corpo", "Mente", "Criatividade", "Social", "Aprendizado"].map((n) => ({ id: n, name: n })),
  },
  hobbyStatus: {
    label: "Status dos hobbies", usedBy: [["hobbies", "status"]],
    defaults: [{ id: "quero experimentar", name: "Quero experimentar" }, { id: "praticando", name: "Praticando" }, { id: "pausado", name: "Pausado" }],
  },
  careerType: {
    label: "Tipos de item de carreira", usedBy: [["career", "type"]],
    defaults: [
      { id: "candidatura", name: "Candidatura" }, { id: "reuniao", name: "Reunião" }, { id: "curso", name: "Curso" },
      { id: "conquista", name: "Conquista" }, { id: "networking", name: "Networking" }, { id: "documento", name: "Documento (Drive)" },
    ],
  },
  careerStatus: {
    label: "Status de carreira", usedBy: [["career", "status"]],
    defaults: [{ id: "em andamento", name: "Em andamento" }, { id: "aguardando retorno", name: "Aguardando retorno" }, { id: "concluido", name: "Concluído" }],
  },
  courseStatus: {
    label: "Status dos cursos", closedFlag: true, flagLabel: "conclui o curso", usedBy: [["study", "status"]],
    defaults: [
      { id: "para estudar", name: "Para estudar" }, { id: "estudando", name: "Estudando" },
      { id: "pausado", name: "Pausado" }, { id: "concluido", name: "Concluído", closed: true },
    ],
  },
  priority: {
    label: "Prioridades", colorFlag: true, usedBy: [["tasks", "priority"], ["shopping", "priority"]],
    defaults: [{ id: "alta", name: "Alta", color: "#C8453A" }, { id: "media", name: "Média", color: "#E3B22E" }, { id: "baixa", name: "Baixa", color: "#F2B27C" }],
  },
  taskStatus: {
    label: "Status das tarefas", closedFlag: true, flagLabel: "conclui a tarefa", usedBy: [["tasks", "status"]],
    defaults: [
      { id: "pendente", name: "Pendente" },
      { id: "em andamento", name: "Em andamento" },
      { id: "concluida", name: "Concluída", closed: true },
    ],
  },
  routineCategory: {
    label: "Categorias das rotinas (cores do calendário)", colorFlag: true,
    defaults: [
      { id: "treino", name: "Treino", color: "#6B1426" }, { id: "trabalho", name: "Trabalho", color: "#3A342C" },
      { id: "estudos", name: "Estudos", color: "#5E7C88" }, { id: "autocuidado", name: "Autocuidado", color: "#B07A6A" },
      { id: "casa", name: "Casa", color: "#8C7A57" }, { id: "pessoal", name: "Pessoal", color: "#7B6A94" },
      { id: "outros", name: "Outros", color: "#8C8177" },
    ],
  },
  habitFrequency: {
    label: "Frequência dos hábitos", usedBy: [["habits", "frequency"]],
    defaults: [{ id: "diario", name: "Diário" }, { id: "semanal", name: "Semanal" }, { id: "mensal", name: "Mensal" }],
  },
  wishCategory: { label: "Categorias da Wishlist", kind: "strings", settingsKey: "wishCategories", usedBy: [["shopping", "category"]],
    defaults: ["Casa", "Roupas", "Beleza", "Tecnologia", "Outros"].map((n) => ({ id: n, name: n })) },
  visionCategory: { label: "Categorias do Vision Board", kind: "strings", settingsKey: "visionCategories", usedBy: [["vision", "category"]],
    defaults: ["pessoal", "carreira", "saúde", "viagens"].map((n) => ({ id: n, name: n })) },
  selfcareCategory: { label: "Categorias do Self-care", kind: "strings", settingsKey: "selfcareCategories", usedBy: [["selfcare", "category"]],
    defaults: ["relaxamento", "análise", "rotina"].map((n) => ({ id: n, name: n })) },
  procCategory: { label: "Categorias de procedimentos", kind: "strings", settingsKey: "procCategories", usedBy: [["beauty", "category"]],
    defaults: ["Procedimento", "Tratamento Estético"].map((n) => ({ id: n, name: n })) },
  procBodyArea: { label: "Partes do corpo e rosto", kind: "strings", settingsKey: "procBodyAreas", usedBy: [["beauty", "bodyArea"]],
    defaults: ["olhos", "rosto", "glúteos", "abdômen"].map((n) => ({ id: n, name: n })) },
  hobbyFrequency: { label: "Frequência dos hobbies", kind: "strings", settingsKey: "hobbyFrequencies", usedBy: [["hobbies", "frequency"]],
    defaults: ["diária", "semanal", "mensal"].map((n) => ({ id: n, name: n })) },
  hobbyLevel: { label: "Nível dos hobbies", kind: "strings", settingsKey: "hobbyLevels", usedBy: [["hobbies", "level"]],
    defaults: ["iniciante", "intermediário", "avançado"].map((n) => ({ id: n, name: n })) },
  wheelPilar: { label: "Pilares da Roda da Vida", kind: "strings", settingsKey: "wheelPilares", usedBy: [["personaldev", "pilar"]],
    defaults: ["Qualidade de vida", "Profissional", "Pessoal", "Relacionamentos"].map((n) => ({ id: n, name: n })) },
  wheelSetor: { label: "Setores da Roda da Vida", kind: "strings", settingsKey: "wheelSetores", usedBy: [["personaldev", "setor"]],
    defaults: [] },
  accountType: { label: "Tipos de conta", kind: "strings", settingsKey: "accountTypes", usedBy: [["accounts", "type"]],
    defaults: ["conta bancária", "carteira", "outra"].map((n) => ({ id: n, name: n })) },
  financeStatus: { label: "Status dos lançamentos", usedBy: [["finance", "status"]],
    defaults: [{ id: "pago", name: "Pago" }, { id: "pendente", name: "Pendente" }, { id: "agendado", name: "Agendado" }, { id: "cancelado", name: "Cancelado" }] },
  wishStatus: { label: "Status dos desejos da Wishlist", closedFlag: true, flagLabel: "já comprado", usedBy: [["shopping", "status", (it) => inferShoppingKind(it) === "desejo"]],
    defaults: [{ id: "desejado", name: "Desejado" }, { id: "comprado", name: "Comprado", closed: true }] },
  productStatus: { label: "Status dos produtos de rotina", closedFlag: true, flagLabel: "precisa recomprar", usedBy: [["shopping", "status", (it) => inferShoppingKind(it) === "rotina"]],
    defaults: [{ id: "ainda tem", name: "Ainda tem" }, { id: "acabou", name: "Acabou", closed: true }, { id: "quero recomprar", name: "Quero recomprar", closed: true }, { id: "comprado", name: "Comprado" }] },
  workoutStatus: {
    label: "Status dos exercícios",
    defaults: [{ id: "planejado", name: "Planejado" }, { id: "feito", name: "Feito" }, { id: "parcial", name: "Parcial" }, { id: "pulado", name: "Pulado" }],
  },
  financeCategories: {
    label: "Categorias de finanças", kind: "strings", settingsKey: "financeCategories", usedBy: [["finance", "category"]],
    defaults: ["Alimentação", "Transporte", "Beleza", "Estudos", "Lazer", "Moradia", "Saúde", "Assinaturas", "Outros"].map((n) => ({ id: n, name: n })),
  },
  paymentMethods: {
    label: "Formas de pagamento", kind: "strings", settingsKey: "paymentMethods", usedBy: [["finance", "paymentMethod"]],
    defaults: ["Débito", "Crédito", "Pix", "Dinheiro", "Transferência", "Boleto", "Outro"].map((n) => ({ id: n, name: n })),
  },
};

const DEFAULT_PRICE_BANDS = [
  { id: "b1", name: "Até R$ 150", max: 150 },
  { id: "b2", name: "R$ 151 a 400", max: 400 },
  { id: "b3", name: "R$ 401 a 800", max: 800 },
  { id: "b4", name: "R$ 801 a 1.500", max: 1500 },
  { id: "b5", name: "Acima de R$ 1.500", max: null },
];

// "Estado ativo" das listas: atualizado pelo App a cada renderização
let ACTIVE_SETTINGS = {};
function setActiveSettings(s) { ACTIVE_SETTINGS = s || {}; }
function prettifyId(v) { const t = String(v || "").replace(/_/g, " "); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ""; }
function getList(key) {
  const reg = LIST_REGISTRY[key];
  if (!reg) return [];
  if (reg.kind === "strings") {
    const arr = ACTIVE_SETTINGS[reg.settingsKey];
    return Array.isArray(arr) ? arr.map((n) => ({ id: n, name: n })) : reg.defaults;
  }
  const l = ACTIVE_SETTINGS.lists && ACTIVE_SETTINGS.lists[key];
  return Array.isArray(l) ? l : reg.defaults;
}
function listName(key, id) {
  const it = getList(key).find((i) => i.id === id);
  if (it) return it.name;
  const reg = LIST_REGISTRY[key];
  return (reg && reg.legacy && reg.legacy[id]) || prettifyId(id);
}
function isClosedItem(key, id) {
  const it = getList(key).find((i) => i.id === id);
  return !!(it && it.closed);
}
function defaultTaskStatus(done = false) {
  const statuses = getList("taskStatus");
  return statuses.find((status) => !!status.closed === done) || statuses[0] || { id: "" };
}
function taskStatusId(task) {
  const statuses = getList("taskStatus");
  if (task.status && statuses.some((status) => status.id === task.status)) return task.status;
  return defaultTaskStatus(!!task.done).id;
}
function getPriceBands() { return Array.isArray(ACTIVE_SETTINGS.priceBands) ? ACTIVE_SETTINGS.priceBands : DEFAULT_PRICE_BANDS; }

// Valores que já existem nos dados mas não estão na lista entram na lista (nada some da tela)
function reconcileLists(settings, collections) {
  const saved = { ...(settings.lists || {}) };
  let next = settings;
  let changed = false;
  Object.keys(LIST_REGISTRY).forEach((key) => {
    const reg = LIST_REGISTRY[key];
    if (!reg.usedBy) return;
    const isStrings = reg.kind === "strings";
    const current = isStrings ? (Array.isArray(settings[reg.settingsKey]) ? settings[reg.settingsKey].map((n) => ({ id: n, name: n })) : reg.defaults)
      : (Array.isArray(saved[key]) ? saved[key] : reg.defaults);
    const known = new Set(current.map((i) => i.id));
    const extra = [];
    reg.usedBy.forEach(([coll, field, pred]) => {
      (collections[coll] || []).forEach((it) => {
        if (pred && !pred(it)) return;
        const v = it[field];
        if (typeof v === "string" && v.trim() && !known.has(v)) {
          known.add(v);
          extra.push({ id: v, name: isStrings ? v : ((reg.legacy && reg.legacy[v]) || prettifyId(v)) });
        }
      });
    });
    if (extra.length) {
      changed = true;
      if (isStrings) next = { ...next, [reg.settingsKey]: [...current, ...extra].map((i) => i.name) };
      else saved[key] = [...current, ...extra];
    }
  });
  if (!changed) return settings;
  return { ...next, lists: saved };
}

const ListsContext = createContext({ openManager: () => {}, openAreas: () => {}, openPrices: () => {} });

function ManagedSelect({ listKey, value, onChange, emptyLabel, className }) {
  const ctx = useContext(ListsContext);
  const list = getList(listKey);
  const known = list.some((i) => i.id === value);
  return (
    <div className="cr-row" style={{ gap: 6, flexWrap: "nowrap" }}>
      <select className={className || "cr-select"} value={value || ""}
        onChange={(e) => { if (e.target.value === "__new__") { ctx.openManager(listKey); return; } onChange(e.target.value); }}>
        {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
        {!known && value ? <option value={value}>{listName(listKey, value)}</option> : null}
        {list.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        <option value="__new__">+ Adicionar ou editar opções…</option>
      </select>
      <button type="button" className="cr-btn" style={{ padding: "6px 10px", fontSize: 12, whiteSpace: "nowrap" }}
        title="Gerenciar opções (criar, renomear, excluir, reordenar)" onClick={() => ctx.openManager(listKey)}>
        <SettingsIcon size={13} /> Gerenciar
      </button>
    </div>
  );
}

// Filtros organizados em grupos (Status, Área, Tipo, Preço, Local…), que podem ser combinados
function FilterGroups({ groups, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen || "");
  const active = groups.filter((g) => g.value && g.value !== "todos");
  const current = groups.find((g) => g.key === open);
  return (
    <div style={{ margin: "14px 0" }}>
      <div className="cr-row" style={{ flexWrap: "wrap", gap: 6 }}>
        {groups.map((g) => {
          const isActive = g.value && g.value !== "todos";
          const sel = g.options.find((o) => o.value === g.value);
          return (
            <button key={g.key} className={`cr-tabbtn ${open === g.key ? "active" : ""}`}
              style={isActive && open !== g.key ? { borderColor: "var(--clay)", color: "var(--clay)", fontWeight: 600 } : undefined}
              onClick={() => setOpen(open === g.key ? "" : g.key)}>
              {g.label}{isActive && sel ? `: ${sel.label}` : ""} {open === g.key ? "▴" : "▾"}
            </button>
          );
        })}
        {active.length > 0 && (
          <button className="cr-btn ghost" onClick={() => groups.forEach((g) => g.onChange("todos"))}>Todos (limpar filtros)</button>
        )}
      </div>
      {current && (
        <div className="cr-card" style={{ marginTop: 8, padding: 12 }}>
          <div className="cr-row" style={{ flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            {[{ value: "todos", label: "Todos", count: null }, ...current.options].map((o) => (
              <button key={o.value} className={`cr-tabbtn ${(current.value || "todos") === o.value ? "active" : ""}`}
                onClick={() => current.onChange(o.value)}>
                {o.label}{o.count !== undefined && o.count !== null ? ` (${o.count})` : ""}
              </button>
            ))}
            {current.onManage && (
              <button className="cr-btn ghost" onClick={current.onManage} title="Criar, renomear, excluir e reordenar estas opções">
                <SettingsIcon size={13} /> Gerenciar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Títulos de categoria: preto + vinho (texto preto, linha vinho com um trecho preto)
const TITLE_WINE = "#6B1426";
const TITLE_INK = "#1B1717";
function SectionTitle({ title, count, right }) {
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", borderBottom: `3px solid ${TITLE_WINE}`, paddingBottom: 9, margin: "34px 0 16px" }}>
      <h2 className="cr-serif" style={{ margin: 0, fontSize: 30, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", color: TITLE_INK }}>{title}</h2>
      {count !== undefined && count !== null && <span style={{ margin: 0, fontSize: 13, fontWeight: 600, color: TITLE_WINE }}>{count}</span>}
      {right && <div style={{ marginLeft: "auto" }}>{right}</div>}
      <span style={{ position: "absolute", left: 0, bottom: -3, width: 72, height: 3, background: TITLE_INK }} />
    </div>
  );
}

function moveItem(arr, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const copy = [...arr];
  [copy[i], copy[j]] = [copy[j], copy[i]];
  return copy;
}

// Janela para gerenciar qualquer lista (renomear, criar, excluir, reordenar)
function ListManagerModal({ listKey, items, setItems, usageCount, onDeleteItem, onRename, onClose }) {
  const reg = LIST_REGISTRY[listKey];
  const [confirmDel, setConfirmDel] = useState(null);
  const isStrings = reg.kind === "strings";
  const [rows, setRows] = useState(() => items.map((i) => ({ ...i, orig: i.id })));
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const propsRef = useRef({});
  propsRef.current = { setItems, onRename, usageCount, onDeleteItem };

  const commit = (next) => {
    setRows(next);
    rowsRef.current = next;
    propsRef.current.setItems(next.map(({ orig, ...rest }) => (isStrings ? { id: rest.name, name: rest.name } : rest)));
  };
  // listas cujo valor é o próprio nome (categorias de finanças): o rename vai para os lançamentos ao sair do campo
  const commitName = (idx) => {
    const r = rowsRef.current[idx];
    if (!r) return;
    if (isStrings && r.orig !== r.name) {
      if (propsRef.current.onRename && r.orig) propsRef.current.onRename(r.orig, r.name);
      commit(rowsRef.current.map((x, i) => (i === idx ? { ...x, orig: x.name } : x)));
    }
  };
  useEffect(() => () => { rowsRef.current.forEach((_, i) => commitName(i)); }, []);

  const inputRefs = useRef([]);
  const addRow = () => commit([...rows, { id: isStrings ? "Nova opção" : uid(), name: "Nova opção", orig: isStrings ? null : undefined, ...(reg.colorFlag ? { color: "#8C8177" } : {}) }]);
  const del = (idx) => {
    const r = rows[idx];
    const used = propsRef.current.usageCount ? propsRef.current.usageCount(r.orig) : 0;
    if (used > 0) setConfirmDel({ idx, used, name: r.name });
    else doDelete(idx);
  };
  const doDelete = (idx) => {
    const r = rows[idx];
    if (propsRef.current.onDeleteItem) propsRef.current.onDeleteItem(r.orig);
    commit(rows.filter((_, i) => i !== idx));
    setConfirmDel(null);
  };

  return (
    <Modal size="small" title={reg.label} onClose={onClose}>
      <div className="cr-row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <p className="cr-sub" style={{ margin: 0 }}>↑ ↓ mover · lápis renomear · lixeira excluir · salvo automaticamente</p>
        <button className="cr-btn primary" onClick={addRow}><Plus size={13} /> Adicionar nova opção</button>
      </div>
      {rows.length === 0 && <p className="cr-empty">Nenhuma opção. Clique em "Adicionar nova opção".</p>}
      {rows.map((r, i) => (
        <div className="cr-row" key={r.id + "-" + i} style={{ marginBottom: 6, flexWrap: "nowrap" }}>
          <button className="cr-btn ghost" style={{ padding: "4px 6px" }} disabled={i === 0} onClick={() => commit(moveItem(rows, i, -1))}>↑</button>
          <button className="cr-btn ghost" style={{ padding: "4px 6px" }} disabled={i === rows.length - 1} onClick={() => commit(moveItem(rows, i, 1))}>↓</button>
          <button className="cr-btn ghost" style={{ padding: "4px 6px" }} title="Renomear" onClick={() => inputRefs.current[i] && inputRefs.current[i].focus()}><Pencil size={13} /></button>
          {reg.colorFlag && (
            <input type="color" title="Cor" value={r.color || itemColor(listKey, r.id)} onChange={(e) => commit(rows.map((x, k) => (k === i ? { ...x, color: e.target.value } : x)))}
              style={{ width: 34, height: 34, border: "none", background: "none", padding: 0, flexShrink: 0 }} />
          )}
          <input className="cr-input" value={r.name} ref={(el) => { inputRefs.current[i] = el; }}
            onChange={(e) => { const next = rows.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)); isStrings ? setRows(next) : commit(next); }}
            onBlur={() => commitName(i)} />
          {reg.closedFlag && (
            <label className="cr-chip" style={{ cursor: "pointer", whiteSpace: "nowrap" }} title="Marque se este status significa que o item terminou">
              <input type="checkbox" checked={!!r.closed} onChange={() => commit(rows.map((x, k) => (k === i ? { ...x, closed: !x.closed } : x)))} style={{ marginRight: 4 }} />
              {reg.flagLabel || "encerra"}
            </label>
          )}
          <button className="cr-btn ghost danger" onClick={() => del(i)}><Trash2 size={13} /></button>
        </div>
      ))}
      <button className="cr-btn" onClick={addRow}><Plus size={13} /> Adicionar nova opção</button>
      <div className="cr-row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
        <button className="cr-btn primary" onClick={onClose}>Concluir</button>
      </div>
      {confirmDel && (
        <ConfirmModal title="Excluir opção" confirmLabel="Excluir"
          message={`"${confirmDel.name}" está sendo usada em ${confirmDel.used} item(ns). Eles continuam salvos, só ficam sem essa classificação.`}
          onConfirm={() => doDelete(confirmDel.idx)} onCancel={() => setConfirmDel(null)} />
      )}
    </Modal>
  );
}

function PriceBandsManager({ bands, setBands, onClose }) {
  return (
    <Modal size="small" title="Faixas de preço" onClose={onClose}>
      <div className="cr-row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <p className="cr-sub" style={{ margin: 0 }}>Cada faixa vai até o valor indicado (a última pode ficar em branco: "acima de"). Salvo automaticamente.</p>
        <button className="cr-btn primary" onClick={() => setBands([...bands, { id: uid(), name: "Nova faixa", max: 0 }])}><Plus size={13} /> Adicionar nova faixa</button>
      </div>
      {bands.map((b, i) => (
        <div className="cr-row" key={b.id} style={{ marginBottom: 6, flexWrap: "nowrap" }}>
          <button className="cr-btn ghost" style={{ padding: "4px 6px" }} disabled={i === 0} onClick={() => setBands(moveItem(bands, i, -1))}>↑</button>
          <button className="cr-btn ghost" style={{ padding: "4px 6px" }} disabled={i === bands.length - 1} onClick={() => setBands(moveItem(bands, i, 1))}>↓</button>
          <input className="cr-input" value={b.name} onChange={(e) => setBands(bands.map((x) => x.id === b.id ? { ...x, name: e.target.value } : x))} />
          <input type="number" className="cr-input" style={{ maxWidth: 110 }} placeholder="até R$" value={b.max === null || b.max === undefined ? "" : b.max}
            onChange={(e) => setBands(bands.map((x) => x.id === b.id ? { ...x, max: e.target.value === "" ? null : Number(e.target.value) } : x))} />
          <button className="cr-btn ghost danger" onClick={() => setBands(bands.filter((x) => x.id !== b.id))}><Trash2 size={13} /></button>
        </div>
      ))}
      <button className="cr-btn" onClick={() => setBands([...bands, { id: uid(), name: "Nova faixa", max: 0 }])}><Plus size={13} /> Adicionar nova faixa</button>
      <div className="cr-row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
        <button className="cr-btn primary" onClick={onClose}>Concluir</button>
      </div>
    </Modal>
  );
}

function AreaManagerModal({ areas, setAreas, usageCount, onClose }) {
  const [confirmDel, setConfirmDel] = useState(null);
  return (
    <Modal size="small" title="Áreas da vida" onClose={onClose}>
      <div className="cr-row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <p className="cr-sub" style={{ margin: 0 }}>↑ ↓ mover · nome editável · cor · lixeira excluir · salvo automaticamente</p>
        <button className="cr-btn primary" onClick={() => setAreas([...areas, { id: uid(), name: "Nova área", color: "#C9A57E" }])}><Plus size={13} /> Adicionar nova área</button>
      </div>
      {areas.map((a, i) => (
        <div className="cr-row" key={a.id} style={{ marginBottom: 6, flexWrap: "nowrap" }}>
          <button className="cr-btn ghost" style={{ padding: "4px 6px" }} disabled={i === 0} onClick={() => setAreas(moveItem(areas, i, -1))}>↑</button>
          <button className="cr-btn ghost" style={{ padding: "4px 6px" }} disabled={i === areas.length - 1} onClick={() => setAreas(moveItem(areas, i, 1))}>↓</button>
          <input type="color" value={a.color || "#C9A57E"} onChange={(e) => setAreas(areas.map((x) => x.id === a.id ? { ...x, color: e.target.value } : x))} style={{ width: 34, height: 34, border: "none", background: "none", padding: 0 }} />
          <input className="cr-input" value={a.name} onChange={(e) => setAreas(areas.map((x) => x.id === a.id ? { ...x, name: e.target.value } : x))} />
          <button className="cr-btn ghost danger" onClick={() => { const n = usageCount(a.id); n > 0 ? setConfirmDel({ a, n }) : setAreas(areas.filter((x) => x.id !== a.id)); }}><Trash2 size={13} /></button>
        </div>
      ))}
      <button className="cr-btn" onClick={() => setAreas([...areas, { id: uid(), name: "Nova área", color: "#C9A57E" }])}><Plus size={13} /> Adicionar nova área</button>
      <div className="cr-row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
        <button className="cr-btn primary" onClick={onClose}>Concluir</button>
      </div>
      {confirmDel && (
        <ConfirmModal title="Excluir área" message={`"${confirmDel.a.name}" está em ${confirmDel.n} item(ns). Eles continuam salvos, só ficam sem essa área.`}
          onConfirm={() => { setAreas(areas.filter((x) => x.id !== confirmDel.a.id)); setConfirmDel(null); }} onCancel={() => setConfirmDel(null)} />
      )}
    </Modal>
  );
}


// Abre um link externo com um plano B: se o navegador/ambiente bloquear a
// abertura em nova aba (comum em previews restritos), copia o link e avisa,
// em vez de o clique simplesmente não fazer nada.
function openExternalLink(url) {
  if (!url) { notify("Esse item ainda não tem um link cadastrado."); return; }
  let win = null;
  try {
    win = window.open(url, "_blank", "noopener,noreferrer");
  } catch (e) {
    win = null;
  }
  if (!win || win.closed || typeof win.closed === "undefined") {
    const done = () => notify("Não consegui abrir automaticamente. O link foi copiado; cole-o em uma nova aba.");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(() => {
        notify("Não consegui abrir nem copiar automaticamente. Copie o link manualmente.");
      });
    } else {
      notify("Não consegui abrir automaticamente. Copie o link manualmente.");
    }
  }
}

/* ---------------------------------------------------------------------- */
/* DEFAULTS (dados de demonstração — claramente marcados e removíveis)    */
/* ---------------------------------------------------------------------- */

const DEFAULT_AREAS = [];
const DEFAULT_TASKS = [];
const DEFAULT_GOALS = [];
const DEFAULT_HABITS = [];
const DEFAULT_FINANCE = [];
const DEFAULT_NOTES = [];
const DEFAULT_APPS = [];
const DEFAULT_STUDY = [];
const DEFAULT_CAREER = [];
const DEFAULT_ROUTINES = [];
const DEFAULT_BEAUTY = [];
const DEFAULT_VISION = [];
const DEFAULT_JOURNAL = [];
const DEFAULT_SHOPPING = [];
const DEFAULT_HOUSE = [];

const DEFAULT_HOBBIES = [];
const DEFAULT_PERSONALDEV = [];

const DEFAULT_SELFCARE = [];

const DEFAULT_ACCOUNTS = [];
const DEFAULT_CARDS = [];

const DEFAULT_WIDGETS = [
  { id: "panorama", label: "Panorama geral (panda)", visible: true },
  { id: "stats", label: "Indicadores rápidos", visible: true },
  { id: "focus", label: "Foco de hoje", visible: true },
  { id: "overdue", label: "Atrasadas", visible: true },
  { id: "weekCalendar", label: "Cronograma semanal (calendário)", visible: true },
  { id: "upcoming", label: "Próximos prazos", visible: true },
  { id: "goals", label: "Metas ativas", visible: true },
  { id: "agenda", label: "Agenda / Google Calendar", visible: true },
  { id: "financeCategory", label: "Gastos por categoria", visible: true },
  { id: "wheelOfLife", label: "Roda da Vida", visible: true },
  { id: "financeChart", label: "Gráfico de Finanças", visible: true },
  { id: "habits", label: "Hábitos de hoje", visible: false },
  { id: "distribution", label: "Distribuição por área", visible: false },
];

// Garante que widgets novos criados em atualizações futuras apareçam também
// para quem já tinha uma lista de widgets salva antes deles existirem.
function reconcileWidgets(saved) {
  const list = saved && saved.length ? saved : DEFAULT_WIDGETS;
  const savedIds = new Set(list.map((w) => w.id));
  const missing = DEFAULT_WIDGETS.filter((w) => !savedIds.has(w.id));
  return missing.length ? [...list, ...missing] : list;
}

const DEFAULT_INVESTMENT_CATEGORIES = [
  { id: "geral", name: "Investimentos gerais" },
  { id: "casa", name: "Investimento para minha casa" },
  { id: "apartamento", name: "Investimento para meu apartamento" },
  { id: "reserva", name: "Reserva para o futuro" },
  { id: "pessoais", name: "Investimentos pessoais" },
];

// Número da versão que aparece no rodapé do menu (para saber se o arquivo aberto é o mais recente)
const APP_BUILD = "versão 11";

const DEFAULT_SETTINGS = {
  name: "",
  greeting: "Bem-vinda de volta",
  quote: "Pequenos passos todos os dias constroem grandes mudanças.",
  theme: { clay: "#7A1712", rose: "#591208", sage: "#6E534A" },
  dashboardWidgets: DEFAULT_WIDGETS,
  paymentMethods: ["Débito", "Crédito", "Pix", "Dinheiro", "Transferência", "Boleto", "Outro"],
  financeCategories: ["Alimentação", "Transporte", "Beleza", "Estudos", "Lazer", "Moradia", "Saúde", "Assinaturas", "Outros"],
  financePlan: { grossSalary: "", extraIncome: "", deductions: "", netSalary: "", payday: "5", allocations: [] },
  wheelChartType: "radar",
  investmentCategories: DEFAULT_INVESTMENT_CATEGORIES,
  pageNames: {},
};

const STRUCTURE_MIGRATION_FLAG_KEY = "central:structure-migration-v1";
const PROC_WISHLIST_MIGRATION_FLAG_KEY = "central:proc-wishlist-migration-v1";
const PERSONALDEV_MIGRATION_FLAG_KEY = "central:personaldev-migration-v1";
const DASHBOARD_LAYOUT_V2_FLAG_KEY = "central:dashboard-layout-v2";

const BEAUTY_OBJECTIVES_MIGRATION_FLAG_KEY = "central:beauty-objectives-migration-v1";
const BEAUTY_PRODUCTS_MIGRATION_FLAG_KEY = "central:beauty-products-migration-v1";
const BEAUTY_HISTORY_FORMAT_FLAG_KEY = "central:beauty-history-format-v1";
const NOTES_PAGE_REMOVED_FLAG_KEY = "central:notes-page-removed-v1";

// Move as metas da "Roda da Vida" (autoavaliação) de Metas para a nova aba Desenvolvimento Pessoal
function migrateWheelOfLifeToPersonalDev(goals, personaldev) {
  const remaining = [];
  const moved = [];
  const existingCriterios = new Set(personaldev.map((p) => p.criterio));
  const re = /Autoavaliação \(Roda da Vida\) — (.+) \/ (.+): nota (\d+)\/10/;
  goals.forEach((g) => {
    const match = (g.note || "").match(re);
    if (match) {
      // não duplica se esse critério já está em Desenvolvimento Pessoal
      // (evita sobrescrever notas/edições que a usuária já fez lá)
      if (!existingCriterios.has(g.name)) {
        moved.push({
          id: uid(), criterio: g.name, pilar: match[1].trim(), setor: match[2].trim(),
          score: Number(match[3]), notes: "", link: g.link || "",
        });
      }
    } else {
      remaining.push(g);
    }
  });
  return { goals: remaining, personaldev: [...moved, ...personaldev] };
}

// Move Hobbies / Análise facial-corporal / Atividades relaxantes out of Notas
// into their own modules (Hobbies e Self-Care), sem duplicar e sem perder dados.
function runStructureMigration(notes, hobbies, selfcare) {
  const selfcareTitles = [
    "Análise facial — plano organizado",
    "Análise corporal — plano organizado",
    "Atividades relaxantes (self care)",
  ];
  const remainingNotes = [];
  const newHobbies = [];
  const newSelfcare = [];

  notes.forEach((n) => {
    if (n.title && n.title.startsWith("Ideias de hobbies —")) {
      const category = n.title.replace("Ideias de hobbies —", "").trim();
      const legendMatch = n.content.match(/\(\*[^)]*\)\s*$/);
      const legend = legendMatch ? legendMatch[0] : "";
      const listText = legend ? n.content.slice(0, n.content.length - legend.length) : n.content;
      listText.split(",").map((s) => s.trim()).filter(Boolean).forEach((entry) => {
        const doing = entry.endsWith("*");
        const name = entry.replace(/\*$/, "").trim();
        if (!name) return;
        newHobbies.push({
          id: uid(), name, category, description: "", goal: "", frequency: "", level: "",
          status: doing ? "praticando" : "quero experimentar", progress: doing ? 20 : 0,
          timeSpent: 0, materials: "", cost: 0, link: "", notes: "",
        });
      });
    } else if (selfcareTitles.includes(n.title)) {
      newSelfcare.push({ id: uid(), title: n.title, content: n.content, category: n.area === "saude" ? "corpo" : "bem-estar" });
    } else {
      remainingNotes.push(n);
    }
  });

  return {
    notes: remainingNotes,
    hobbies: [...newHobbies, ...hobbies],
    selfcare: [...newSelfcare, ...selfcare],
  };
}

/* ---------------------------------------------------------------------- */
/* STYLE                                                                   */
/* ---------------------------------------------------------------------- */

const GlobalStyle = () => (
  <style>{`
    .central-root {
      --bg: #F0ECE1;
      --card: #FBF8F2;
      --ink: #211D1A;
      --ink-soft: #8C8177;
      --line: #E2D8C9;
      --rose: #591208;
      --sage: #6E534A;
      --clay: #7A1712;
      font-family: 'Manrope Variable', sans-serif;
      color: var(--ink);
      background: var(--bg);
      height: 100dvh;
      overflow: hidden;
      display: flex;
      width: 100%;
    }
    .central-root * { box-sizing: border-box; }
    .cr-serif { font-family: 'Fraunces Variable', serif; }
    .cr-sidebar {
      width: 220px; flex-shrink: 0; background: var(--card);
      border-right: 1px solid var(--line); padding: 24px 14px;
      display: flex; flex-direction: column; gap: 4px;
      height: 100dvh; overflow-y: auto;
    }
    .cr-navrow { display: flex; align-items: center; gap: 2px; }
    .cr-navrow .cr-navitem { flex: 1; min-width: 0; }
    .cr-navtools { display: flex; gap: 4px; margin: 0 0 8px; }
    .cr-brand { font-size: 20px; padding: 0 10px 20px; letter-spacing: 0.2px; }
    .cr-navitem {
      display: flex; align-items: center; gap: 10px; padding: 10px 12px;
      border-radius: 10px; cursor: pointer; color: var(--ink-soft); font-size: 14.5px;
      border: none; background: transparent; text-align: left; width: 100%;
      transition: background 0.15s, color 0.15s;
    }
    .cr-navitem:hover { background: #F3EDE4; color: var(--ink); }
    .cr-navitem.active { background: #F0DAD3; color: var(--ink); font-weight: 600; }
    .cr-main { flex: 1; min-width: 0; padding: 28px 36px 60px; max-width: 1180px; height: 100dvh; overflow-y: auto; }
    .cr-h1 { font-size: 26px; margin: 0 0 4px; }
    .cr-sub { color: var(--ink-soft); font-size: 14px; margin: 0 0 24px; }
    .cr-card {
      background: var(--card); border: 1px solid var(--line); border-radius: 16px;
      padding: 18px 20px; min-width: 0;
    }
    .cr-grid { display: grid; gap: 16px; }
    .cr-grid > * { min-width: 0; }
    .cr-grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .cr-grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .cr-grid-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .cr-row { display: flex; align-items: center; gap: 10px; }
    .cr-btn {
      display: inline-flex; align-items: center; gap: 6px; border-radius: 10px;
      padding: 8px 14px; font-size: 13.5px; font-weight: 600; cursor: pointer;
      border: 1px solid var(--line); background: var(--card); color: var(--ink);
    }
    .cr-btn.primary { background: var(--ink); color: #fff; border-color: var(--ink); }
    .cr-btn.ghost { border-color: transparent; background: transparent; padding: 6px 8px; }
    .cr-btn.danger { color: #a1493c; }
    .cr-btn:hover { opacity: 0.85; }
    .cr-input, .cr-select, .cr-textarea {
      border: 1px solid var(--line); border-radius: 9px; padding: 8px 10px;
      font-size: 13.5px; font-family: inherit; background: #fff; color: var(--ink); width: 100%;
    }
    .cr-textarea { min-height: 70px; resize: vertical; }
    .cr-label { font-size: 12px; color: var(--ink-soft); margin-bottom: 4px; display: block; }
    .cr-chip {
      display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px;
      padding: 3px 9px; border-radius: 100px; background: #F1E4DE; color: var(--ink-soft);
    }
    .cr-progress-track { height: 8px; border-radius: 8px; background: #E6DCCF; overflow: hidden; }
    .cr-progress-fill { height: 100%; border-radius: 8px; background: var(--clay); }
    .cr-list-row {
      display: flex; align-items: center; gap: 12px; padding: 10px 4px;
      min-width: 0; border-bottom: 1px solid var(--line);
    }
    .cr-list-title { min-width: 0; flex: 1; }
    .cr-list-row > span { overflow-wrap: anywhere; }
    .cr-list-row:last-child { border-bottom: none; }
    .cr-checkbox {
      width: 19px; height: 19px; border-radius: 6px; border: 1.5px solid #C9BEAE;
      display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0;
      background: #fff;
    }
    .cr-checkbox.checked { background: var(--sage); border-color: var(--sage); color: #fff; }
    .cr-modal-backdrop {
      position: fixed; inset: 0; background: rgba(58,52,44,0.35); display: flex;
      align-items: center; justify-content: center; z-index: 50; padding: 20px;
    }
    .cr-fullpage { position: fixed; top: 0; right: 0; bottom: 0; left: 220px; background: var(--bg); z-index: 60; overflow-y: auto; }
    .cr-fullpage-head { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 16px; padding: 16px 36px; background: var(--bg); border-bottom: 1px solid var(--line); }
    .cr-fullpage-body { max-width: 980px; margin: 0 auto; padding: 24px 36px 80px; }
    .cr-fullpage-body .cr-input, .cr-fullpage-body .cr-select, .cr-fullpage-body .cr-textarea { font-size: 14.5px; }
    .cr-fullpage-body .cr-textarea { min-height: 120px; }
    .cr-modal {
      background: #fff; border-radius: 18px; padding: 22px; width: 100%; max-width: 440px;
      max-height: 85dvh; overflow-y: auto;
    }
    .cr-field { margin-bottom: 12px; }
    .cr-empty { color: var(--ink-soft); font-size: 13.5px; padding: 20px 4px; text-align: center; }
    .cr-tabbar { display: flex; gap: 6px; margin-bottom: 18px; flex-wrap: wrap; }
    .cr-tabbtn {
      border: 1px solid var(--line); background: #fff; border-radius: 100px; padding: 6px 14px;
      font-size: 13px; cursor: pointer; color: var(--ink-soft);
    }
    .cr-tabbtn.active { background: var(--ink); color: #fff; border-color: var(--ink); }
    .cr-heat { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
    .cr-heat-cell { aspect-ratio: 1; border-radius: 4px; background: #EFE8DE; }
    .cr-mobile-nav, .cr-mobile-drawer-backdrop { display: none; }
    @media (min-width: 861px) and (max-width: 1100px) {
      .cr-main { padding-right: 24px; padding-left: 24px; }
      .cr-grid-3, .cr-grid-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 860px) {
      .central-root { flex-direction: column; height: 100dvh; min-height: 100dvh; overflow: hidden; }
      .cr-sidebar { display: none; }
      .cr-fullpage { left: 0; }
      .cr-fullpage { padding-bottom: env(safe-area-inset-bottom); }
      .cr-fullpage-head { flex-wrap: wrap; padding: calc(12px + env(safe-area-inset-top)) 16px 12px; }
      .cr-fullpage-body { padding: 16px 16px calc(80px + env(safe-area-inset-bottom)); }
      .cr-main { width: 100%; max-width: none; min-height: 0; height: auto; overflow-y: auto; padding: calc(18px + env(safe-area-inset-top)) 16px calc(92px + env(safe-area-inset-bottom)); }
      .cr-grid-2, .cr-grid-3, .cr-grid-4 { grid-template-columns: minmax(0, 1fr); }
      .cr-row { flex-wrap: wrap; }
      .cr-row > .cr-field { flex: 1 1 220px !important; min-width: 0; }
      .cr-list-row { flex-wrap: wrap; gap: 8px; }
      .cr-list-row > * { min-width: 0; }
      .cr-list-title { flex: 1 1 calc(100% - 32px) !important; }
      .cr-calendar-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
      .cr-calendar-grid { min-width: 600px; }
      .cr-modal-backdrop { padding: 8px; }
      .cr-modal { max-height: calc(100dvh - 16px); padding: 18px; }
      .cr-mobile-nav {
        position: fixed; z-index: 40; right: 0; bottom: 0; left: 0;
        display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 2px;
        padding: 5px 8px calc(5px + env(safe-area-inset-bottom));
        border-top: 1px solid var(--line); background: var(--card);
      }
      .cr-mobile-tab {
        display: flex; min-width: 0; min-height: 48px; flex-direction: column;
        align-items: center; justify-content: center; gap: 2px; padding: 3px 2px;
        border: 0; border-radius: 9px; background: transparent; color: var(--ink-soft);
        font: inherit; font-size: 10px; cursor: pointer;
      }
      .cr-mobile-tab.active { background: #F0DAD3; color: var(--ink); font-weight: 700; }
      .cr-mobile-drawer-backdrop {
        position: fixed; z-index: 45; inset: 0; display: flex; align-items: flex-end;
        background: rgb(33 29 26 / 38%);
      }
      .cr-mobile-drawer {
        width: 100%; max-height: 85dvh; overflow-y: auto; padding: 12px 16px calc(16px + env(safe-area-inset-bottom));
        border-radius: 18px 18px 0 0; background: var(--card); box-shadow: 0 -8px 32px rgb(33 29 26 / 12%);
      }
      .cr-mobile-drawer .cr-navrow { display: flex; }
      .cr-mobile-drawer .cr-navitem { width: auto; flex: 1; min-height: 44px; }
      .cr-mobile-drawer-actions { display: flex; gap: 8px; margin-bottom: 10px; }
      .cr-mobile-drawer-actions .cr-btn { flex: 1; justify-content: center; min-height: 44px; }
      .central-root button { min-height: 44px; }
      .central-root .cr-input, .central-root .cr-select, .central-root .cr-textarea,
      .central-root input, .central-root select, .central-root textarea { min-height: 44px; font-size: 16px; }
      .central-root .cr-textarea { min-height: 90px; }
    }
  `}</style>
);

/* ---------------------------------------------------------------------- */
/* SMALL SHARED UI                                                         */
/* ---------------------------------------------------------------------- */

function Modal({ title, onClose, children, size }) {
  if (size === "small") {
    return (
      <div className="cr-modal-backdrop" style={{ zIndex: 70 }} onClick={onClose}>
        <div className="cr-modal" onClick={(e) => e.stopPropagation()}>
          <div className="cr-row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
            <h3 className="cr-serif" style={{ margin: 0, fontSize: 18 }}>{title}</h3>
            <button className="cr-btn ghost" onClick={onClose}><X size={16} /></button>
          </div>
          {children}
        </div>
      </div>
    );
  }
  // edição, criação e detalhes abrem em página inteira
  return (
    <div className="cr-fullpage">
      <div className="cr-fullpage-head">
        <button className="cr-btn" onClick={onClose}><ChevronLeft size={15} /> Voltar</button>
        <h1 className="cr-h1 cr-serif" style={{ margin: 0, fontSize: 24 }}>{title}</h1>
      </div>
      <div className="cr-fullpage-body">{children}</div>
    </div>
  );
}

function ImagePickerField({ label, value, onChange, maxMB = 1.5 }) {
  const [error, setError] = useState("");
  const handleFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.type && !file.type.startsWith("image/")) { setError("Escolha um arquivo de imagem."); return; }
    if (file.size > maxMB * 1024 * 1024) { setError(`Imagem grande demais (máx. ${maxMB}MB).`); return; }
    setError("");
    const reader = new FileReader();
    reader.onload = () => onChange(reader.result);
    reader.onerror = () => setError("Não consegui ler esse arquivo. Tente outra imagem.");
    reader.readAsDataURL(file);
  };
  return (
    <div className="cr-field">
      <label className="cr-label">{label || "Imagem"}</label>
      {value && (
        <div style={{ position: "relative", marginBottom: 8 }}>
          <img src={value} alt="" style={{ width: "100%", maxHeight: 150, objectFit: "cover", borderRadius: 10 }} />
          <button type="button" className="cr-btn ghost danger" style={{ position: "absolute", top: 6, right: 6, background: "#fff" }}
            onClick={() => onChange("")}><Trash2 size={13} /> Remover</button>
        </div>
      )}
      <div className="cr-row">
        <input type="file" accept="image/*" className="cr-input" onChange={handleFile} />
      </div>
      <input className="cr-input" style={{ marginTop: 6 }} placeholder="ou link de imagem (URL)"
        value={value && value.startsWith("data:") ? "" : (value || "")}
        onChange={(e) => onChange(e.target.value)} />
      {error && <p className="cr-sub" style={{ color: "#A1493C", margin: "4px 0 0" }}>{error}</p>}
    </div>
  );
}

function AreaBadge({ area, areas }) {
  const a = areas.find((x) => x.id === area);
  if (!a) return null;
  return (
    <span className="cr-chip">
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: a.color || "#B0A594", display: "inline-block", marginRight: 5 }} />
      {a.name}
    </span>
  );
}

function AreaSelect({ value, onChange, areas }) {
  const ctx = useContext(ListsContext);
  return (
    <div className="cr-row" style={{ gap: 6, flexWrap: "nowrap" }}>
      <select className="cr-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <button type="button" className="cr-btn" style={{ padding: "6px 10px", fontSize: 12, whiteSpace: "nowrap" }} title="Gerenciar áreas (criar, renomear, excluir, reordenar)" onClick={() => ctx.openAreas()}><SettingsIcon size={13} /> Gerenciar</button>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* DASHBOARD                                                               */
/* ---------------------------------------------------------------------- */

const GREETING_MESSAGES = {
  morning: [
    { g: "Bom dia, diva", emoji: "✨", sub: "Hoje é um novo dia para chegar mais perto da sua melhor versão. Vamos com tudo! 🤍" },
    { g: "Bom dia, diva", emoji: "🌷", sub: "Que seu dia seja leve, produtivo e cheio de coisas boas." },
    { g: "Bom dia", emoji: "☀️", sub: "Um pequeno passo hoje ainda é um passo em direção à vida que você quer construir." },
    { g: "Bom dia, linda", emoji: "✨", sub: "Hoje também conta. Faça o seu melhor e aproveite o caminho. 🤍" },
    { g: "Bom dia, diva", emoji: "🤍", sub: "Você é capaz de coisas incríveis — comece o dia lembrando disso." },
  ],
  afternoon: [
    { g: "Boa tarde, diva", emoji: "🌸", sub: "Continue firme — metade do dia já foi, e você está indo bem. 🤍" },
    { g: "Boa tarde", emoji: "☀️", sub: "Respire, ajuste o que precisar e siga com leveza até o fim do dia." },
    { g: "Boa tarde, linda", emoji: "✨", sub: "Um lembrete gentil: você já fez mais hoje do que imagina." },
  ],
  evening: [
    { g: "Boa noite, diva", emoji: "🌙", sub: "Hora de desacelerar. Você fez o seu melhor hoje. 🤍" },
    { g: "Boa noite", emoji: "✨", sub: "Feche o dia com gratidão pelo que foi conquistado, por menor que pareça." },
    { g: "Boa noite, linda", emoji: "🌷", sub: "Descanse — amanhã é um novo capítulo." },
  ],
};

function dayOfYear(d) {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - start) / 86400000);
}

function pickGreeting(now) {
  const hour = now.getHours();
  const bucket = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const list = GREETING_MESSAGES[bucket];
  const idx = dayOfYear(now) % list.length;
  return list[idx];
}

function DonutChart({ data, size = 200, thickness = 32 }) {
  const [hover, setHover] = useState(null);
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const radius = size / 2;
  const innerRadius = radius - thickness;
  const toXY = (angle, r) => [radius + r * Math.cos(angle), radius + r * Math.sin(angle)];
  let cumulative = 0;
  const slices = data.map((d) => {
    const startAngle = (cumulative / total) * 2 * Math.PI - Math.PI / 2;
    cumulative += d.value;
    const endAngle = (cumulative / total) * 2 * Math.PI - Math.PI / 2;
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    const [x1, y1] = toXY(startAngle, radius);
    const [x2, y2] = toXY(endAngle, radius);
    const [x3, y3] = toXY(endAngle, innerRadius);
    const [x4, y4] = toXY(startAngle, innerRadius);
    const path = `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${x4} ${y4} Z`;
    return { path, color: d.color, label: d.label, value: d.value, pct: Math.round((d.value / total) * 100) };
  });
  return (
    <div className="cr-row" style={{ alignItems: "center", gap: 24, flexWrap: "wrap" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {slices.map((s, i) => (
          <path key={i} d={s.path} fill={s.color} stroke="#fff" strokeWidth={2}
            opacity={hover === null || hover === i ? 1 : 0.35} style={{ cursor: "pointer", transition: "opacity 0.15s" }}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => setHover(hover === i ? null : i)} />
        ))}
        <text x={radius} y={radius - 4} textAnchor="middle" className="cr-serif" style={{ fontSize: 22, fill: "var(--ink)" }}>
          {hover !== null ? `${slices[hover].pct}%` : total}
        </text>
        <text x={radius} y={radius + 16} textAnchor="middle" style={{ fontSize: 11, fill: "var(--ink-soft)" }}>
          {hover !== null ? slices[hover].label : "total"}
        </text>
      </svg>
      <div>
        {slices.map((s, i) => (
          <div key={i} className="cr-row" style={{ gap: 8, marginBottom: 6, cursor: "pointer", opacity: hover === null || hover === i ? 1 : 0.5 }}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, display: "inline-block" }} />
            <span style={{ fontSize: 13 }}>{s.label}</span>
            <span className="cr-sub" style={{ margin: 0 }}>{s.value} ({s.pct}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Dashboard({ tasks, goals, habits, finance, notes, areas, settings, personaldev, setTasks, setHabits, setSettings, goTo }) {
  const today = todayStr();
  const now = new Date();
  const hour = now.getHours();
  const greeting = pickGreeting(now);
  const dataFmt = now.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

  const tasksToday = tasks.filter((tk) => tk.dueDate === today);
  const doneToday = tasksToday.filter((tk) => tk.done).length;

  const habitsDoneToday = habits.filter((h) => h.log[today]).length;

  const activeGoals = goals.filter((g) => !isClosedItem("goalStatus", g.status));
  const avgProgress = activeGoals.length
    ? Math.round(activeGoals.reduce((s, g) => s + Number(g.progress || 0), 0) / activeGoals.length)
    : 0;

  const thisMonth = today.slice(0, 7);
  const monthTx = finance.filter((f) => f.date.slice(0, 7) === thisMonth);
  const income = monthTx.filter((f) => f.type === "entrada").reduce((s, f) => s + Number(f.amount), 0);
  const expense = monthTx
    .filter((f) => f.type === "saida" && !["reserve", "investment"].includes(f.expenseClass))
    .reduce((s, f) => s + Number(f.amount), 0);
  const balance = income - expense;

  const upcoming = tasks
    .filter((tk) => !tk.done && tk.dueDate >= today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 5);

  const overdue = tasks
    .filter((tk) => !tk.done && tk.dueDate && tk.dueDate < today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const [quickTitle, setQuickTitle] = useState("");
  const addQuick = () => {
    if (!quickTitle.trim()) return;
    setTasks([{ id: uid(), title: quickTitle.trim(), area: areas[0]?.id, priority: "media", dueDate: today, done: false }, ...tasks]);
    setQuickTitle("");
  };

  const toggleHabit = (h) => {
    const log = { ...h.log };
    if (log[today]) delete log[today]; else log[today] = true;
    setHabits(habits.map((x) => (x.id === h.id ? { ...x, log } : x)));
  };

  const widgets = (settings.dashboardWidgets && settings.dashboardWidgets.length ? settings.dashboardWidgets : DEFAULT_WIDGETS)
    .filter((w) => w.visible);

  const renderWidget = (id) => {
    switch (id) {
      case "panorama": {
        const om = overallMood(tasks, goals, habits, finance);
        return (
          <div className="cr-card" key="panorama" style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
            <PandaMood mood={om.mood} />
            <div style={{ flex: 1, minWidth: 180 }}>
              <p className="cr-label" style={{ marginBottom: 4 }}>Panorama geral</p>
              <p className="cr-serif" style={{ fontSize: 16, margin: "0 0 8px" }}>{om.message}</p>
              <div className="cr-row" style={{ flexWrap: "wrap", gap: 6 }}>
                {om.breakdown.map((b) => (
                  <span key={b.label} className="cr-chip">{b.label}: {b.status}</span>
                ))}
              </div>
            </div>
          </div>
        );
      }
      case "stats":
        return (
          <div className="cr-grid cr-grid-4" key="stats" style={{ margin: "20px 0" }}>
            <div className="cr-card">
              <p className="cr-label">Tarefas hoje</p>
              <p className="cr-serif" style={{ fontSize: 26, margin: "2px 0" }}>{doneToday}/{tasksToday.length}</p>
              <p className="cr-sub" style={{ margin: 0 }}>concluídas</p>
            </div>
            <div className="cr-card">
              <p className="cr-label">Hábitos hoje</p>
              <p className="cr-serif" style={{ fontSize: 26, margin: "2px 0" }}>{habitsDoneToday}/{habits.length}</p>
              <p className="cr-sub" style={{ margin: 0 }}>em dia</p>
            </div>
            <div className="cr-card">
              <p className="cr-label">Progresso médio das metas</p>
              <p className="cr-serif" style={{ fontSize: 26, margin: "2px 0" }}>{avgProgress}%</p>
              <div className="cr-progress-track" style={{ marginTop: 6 }}>
                <div className="cr-progress-fill" style={{ width: `${avgProgress}%`, background: progressColor(avgProgress) }} />
              </div>
            </div>
            <div className="cr-card">
              <p className="cr-label">Saldo do mês</p>
              <p className="cr-serif" style={{ fontSize: 22, margin: "2px 0", color: balance >= 0 ? "#5C7A56" : "#A1493C" }}>{fmtBRL(balance)}</p>
              <p className="cr-sub" style={{ margin: 0 }}>{fmtBRL(income)} entradas · {fmtBRL(expense)} saídas</p>
            </div>
          </div>
        );
      case "focus":
        return (
          <div className="cr-card" key="focus" style={{ marginBottom: 16 }}>
            <div className="cr-row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
              <h3 className="cr-serif" style={{ margin: 0, fontSize: 16 }}>Foco de hoje</h3>
              <button className="cr-btn ghost" onClick={() => goTo("tasks")}>ver tudo</button>
            </div>
            <div className="cr-row" style={{ marginBottom: 12 }}>
              <input className="cr-input" placeholder="Adicionar tarefa rápida…" value={quickTitle}
                onChange={(e) => setQuickTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addQuick()} />
              <button className="cr-btn primary" onClick={addQuick}><Plus size={14} /></button>
            </div>
            {tasksToday.length === 0 && <p className="cr-empty">Nenhuma tarefa para hoje ainda.</p>}
            {tasksToday.slice(0, 6).map((tk) => (
              <div className="cr-list-row cr-task-row" key={tk.id}>
                <div className={`cr-checkbox ${tk.done ? "checked" : ""}`}
                  onClick={() => setTasks(toggleTaskDone(tasks, tk.id))}>
                  {tk.done && <Check size={13} />}
                </div>
                <span className="cr-list-title" style={{ flex: 1, textDecoration: tk.done ? "line-through" : "none", color: tk.done ? "var(--ink-soft)" : "var(--ink)" }}>{tk.title}</span>
                <AreaBadge area={tk.area} areas={areas} />
              </div>
            ))}
          </div>
        );
      case "habits":
        return (
          <div className="cr-card" key="habits" style={{ marginBottom: 16 }}>
            <div className="cr-row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
              <h3 className="cr-serif" style={{ margin: 0, fontSize: 16 }}>Hábitos de hoje</h3>
              <button className="cr-btn ghost" onClick={() => goTo("habits")}>ver tudo</button>
            </div>
            {habits.length === 0 && <p className="cr-empty">Nenhum hábito cadastrado ainda.</p>}
            {habits.map((h) => (
              <div className="cr-list-row" key={h.id}>
                <div className={`cr-checkbox ${h.log[today] ? "checked" : ""}`} onClick={() => toggleHabit(h)}>
                  {h.log[today] && <Check size={13} />}
                </div>
                <span className="cr-list-title" style={{ flex: 1 }}>{h.name}</span>
                <AreaBadge area={h.area} areas={areas} />
              </div>
            ))}
          </div>
        );
      case "upcoming":
        return (
          <div className="cr-card" key="upcoming" style={{ marginBottom: 16 }}>
            <h3 className="cr-serif" style={{ margin: "0 0 10px", fontSize: 16 }}>Próximos prazos</h3>
            {upcoming.length === 0 && <p className="cr-empty">Nada agendado por perto.</p>}
            {upcoming.map((tk) => (
              <div className="cr-list-row" key={tk.id}>
                <span className="cr-chip">{fmtDateShort(tk.dueDate)}</span>
                <span className="cr-list-title" style={{ flex: 1 }}>{tk.title}</span>
                <AreaBadge area={tk.area} areas={areas} />
              </div>
            ))}
          </div>
        );
      case "overdue":
        if (overdue.length === 0) return null;
        return (
          <div className="cr-card" key="overdue" style={{ marginBottom: 16, borderColor: "#E3B5AB" }}>
            <h3 className="cr-serif" style={{ margin: "0 0 10px", fontSize: 16, color: "#A1493C" }}>Atrasadas</h3>
            {overdue.map((tk) => (
              <div className="cr-list-row" key={tk.id}>
                <span className="cr-chip" style={{ background: "#F6DEDA", color: "#A1493C" }}>{fmtDateShort(tk.dueDate)}</span>
                <span className="cr-list-title" style={{ flex: 1 }}>{tk.title}</span>
                <AreaBadge area={tk.area} areas={areas} />
              </div>
            ))}
          </div>
        );
      case "agenda":
        return (
          <div className="cr-card" key="agenda" style={{ marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 96 }}>
            <button className="cr-btn primary" style={{ fontSize: 14, padding: "10px 20px" }} onClick={() => openExternalLink("https://calendar.google.com")}>
              <CalendarDays size={16} /> Abrir Google Calendar
            </button>
          </div>
        );
      case "distribution": {
        const distData = areas
          .map((a) => ({ label: a.name, color: a.color || "#B0A594", value: tasks.filter((tk) => tk.area === a.id && !tk.done).length }))
          .filter((d) => d.value > 0);
        return (
          <div className="cr-card" key="distribution" style={{ marginBottom: 16 }}>
            <h3 className="cr-serif" style={{ margin: "0 0 12px", fontSize: 16 }}>Tarefas pendentes por área</h3>
            {distData.length === 0
              ? <p className="cr-empty">Nenhuma tarefa pendente para distribuir ainda.</p>
              : <DonutChart data={distData} />}
          </div>
        );
      }
      case "weekCalendar": {
        const weekStart = startOfWeek(todayStr());
        const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
        return (
          <div className="cr-card" key="weekCalendar" style={{ marginBottom: 16 }}>
            <div className="cr-row" style={{ justifyContent: "space-between" }}>
              <h3 className="cr-serif" style={{ margin: "0 0 12px", fontSize: 16 }}>Cronograma semanal</h3>
              <button className="cr-btn ghost" onClick={() => goTo("tasks")}>ver planejamento</button>
            </div>
            <div className="cr-calendar-scroll">
            <div className="cr-grid cr-calendar-grid" style={{ gridTemplateColumns: "repeat(7, 1fr)", gap: 8 }}>
              {days.map((d) => {
                const dayTasks = tasks.filter((tk) => tk.dueDate === d);
                const isToday = d === todayStr();
                return (
                  <div key={d} style={{
                    padding: 8, borderRadius: 10, minHeight: 90,
                    background: isToday ? "#FBF0E4" : "#FBF8F4", border: "1px solid var(--line)",
                  }}>
                    <p className="cr-sub" style={{ margin: 0, textTransform: "capitalize", fontSize: 10.5 }}>{fmtWeekday(d)}</p>
                    <p className="cr-serif" style={{ margin: "2px 0 6px", fontSize: 13 }}>{d.slice(8, 10)}</p>
                    {dayTasks.slice(0, 3).map((tk) => (
                      <div key={tk.id} style={{
                        fontSize: 10.5, padding: "2px 5px", borderRadius: 5, marginBottom: 2,
                        background: tk.done ? "#EFE8DE" : "#F3EDE4", textDecoration: tk.done ? "line-through" : "none",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>{tk.time ? `${tk.time} ` : ""}{tk.title}</div>
                    ))}
                    {dayTasks.length > 3 && <p className="cr-sub" style={{ margin: 0, fontSize: 10 }}>+{dayTasks.length - 3}</p>}
                  </div>
                );
              })}
            </div>
            </div>
          </div>
        );
      }
      case "financeCategory": {
        const catData = expenseCategoryData(finance, todayStr().slice(0, 7));
        return (
          <div className="cr-card" key="financeCategory" style={{ marginBottom: 16 }}>
            <div className="cr-row" style={{ justifyContent: "space-between" }}>
              <h3 className="cr-serif" style={{ margin: "0 0 12px", fontSize: 16 }}>Gastos por categoria — este mês</h3>
              <button className="cr-btn ghost" onClick={() => goTo("finance")}>ver detalhes</button>
            </div>
            {catData.length === 0
              ? <p className="cr-empty">Nenhum gasto registrado este mês ainda.</p>
              : <DonutChart data={catData} />}
          </div>
        );
      }
      case "wheelOfLife": {
        const wheelData = wheelDataBySetor(personaldev || []);
        const chartType = settings.wheelChartType || "radar";
        return (
          <div className="cr-card" key="wheelOfLife" style={{ marginBottom: 16 }}>
            <div className="cr-row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <h3 className="cr-serif" style={{ margin: "0 0 12px", fontSize: 16 }}>Roda da Vida</h3>
              <div className="cr-row" style={{ gap: 8 }}>
                <ChartTypeToggle value={chartType} onChange={(t) => setSettings({ ...settings, wheelChartType: t })} />
                <button className="cr-btn ghost" onClick={() => goTo("personaldev")}>ver detalhes</button>
              </div>
            </div>
            {wheelData.length === 0
              ? <p className="cr-empty">Nenhum critério cadastrado ainda em Desenvolvimento Pessoal.</p>
              : <WheelOfLifeChart data={wheelData} type={chartType} size={300} />}
          </div>
        );
      }
      case "financeChart": {
        const byMonthDash = (() => {
          const map = {};
          finance.forEach((f) => {
            const m = f.date.slice(0, 7);
            map[m] = map[m] || { month: monthLabel(m), _m: m, entrada: 0, saida: 0 };
            map[m][f.type === "entrada" ? "entrada" : "saida"] += Number(f.amount);
          });
          return Object.values(map).sort((a, b) => a._m.localeCompare(b._m)).slice(-6);
        })();
        return (
          <div className="cr-card" key="financeChart" style={{ marginBottom: 16 }}>
            <div className="cr-row" style={{ justifyContent: "space-between" }}>
              <h3 className="cr-serif" style={{ margin: "0 0 12px", fontSize: 16 }}>Finanças — últimos meses</h3>
              <button className="cr-btn ghost" onClick={() => goTo("finance")}>ver detalhes</button>
            </div>
            {byMonthDash.length === 0
              ? <p className="cr-empty">Nenhum lançamento financeiro ainda.</p>
              : <MiniBarChartFinance data={byMonthDash} height={220} />}
          </div>
        );
      }
      case "goals":
        return (
          <div className="cr-card" key="goals" style={{ marginBottom: 16 }}>
            <h3 className="cr-serif" style={{ margin: "0 0 10px", fontSize: 16 }}>Metas ativas</h3>
            {activeGoals.length === 0 && <p className="cr-empty">Nenhuma meta ativa.</p>}
            {activeGoals.slice(0, 4).map((g) => (
              <div key={g.id} style={{ marginBottom: 10 }}>
                <div className="cr-row" style={{ justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13.5 }}>{g.name}</span>
                  <span className="cr-sub" style={{ margin: 0 }}>{g.progress}%</span>
                </div>
                <div className="cr-progress-track"><div className="cr-progress-fill" style={{ width: `${g.progress}%`, background: progressColor(g.progress) }} /></div>
              </div>
            ))}
          </div>
        );
      default:
        return null;
    }
  };

  // pair non-stats widgets two-by-two for a tidier layout
  const nonStats = widgets.filter((w) => w.id !== "stats" && w.id !== "panorama");
  return (
    <div>
      <p className="cr-sub" style={{ marginBottom: 2, textTransform: "capitalize" }}>{dataFmt}</p>
      <h1 className="cr-h1 cr-serif">{greeting.g}{settings.name ? `, ${settings.name}` : ""}! {greeting.emoji}</h1>
      <p className="cr-sub" style={{ fontStyle: "italic" }}>{greeting.sub}</p>
      {settings.quote && <p className="cr-sub" style={{ fontStyle: "italic", opacity: 0.8 }}>{settings.quote}</p>}

      {widgets.some((w) => w.id === "panorama") && renderWidget("panorama")}

      {widgets.some((w) => w.id === "stats") && renderWidget("stats")}

      {nonStats.map((w) => (
        <div key={w.id} style={{ marginBottom: 26 }}>{renderWidget(w.id)}</div>
      ))}

      <p className="cr-sub" style={{ marginTop: 18 }}>
        {notes.length} nota(s) guardadas · <button className="cr-btn ghost" style={{ padding: 0, textDecoration: "underline" }} onClick={() => goTo("notes")}>abrir notas</button>
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* TASKS / PLANEJAMENTO                                                    */
/* ---------------------------------------------------------------------- */

function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return localDateStr(d);
}

function startOfWeek(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const day = (d.getDay() + 6) % 7; // segunda = 0
  d.setDate(d.getDate() - day);
  return localDateStr(d);
}

function fmtWeekday(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
}

function TasksView({ tasks, setTasks, areas, embedded }) {
  const [filterArea, setFilterArea] = useState("todas");
  const [filterStatus, setFilterStatus] = useState("todas");
  const ctx = useContext(ListsContext);
  const [editing, setEditing] = useState(null); // task object or "new"
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState("lista");
  const [anchorDate, setAnchorDate] = useState(todayStr());
  const [showDone, setShowDone] = useState(false);
  const doneCount = tasks.filter((t) => t.done).length;
  const selectedStatus = getList("taskStatus").find((status) => status.id === filterStatus);
  const showDoneNow = showDone || !!selectedStatus?.closed;
  const visibleTasks = tasks.filter((t) => showDoneNow || !t.done);

  const filtered = tasks.filter((tk) => {
    if (!showDoneNow && tk.done) return false;
    if (filterArea !== "todas" && tk.area !== filterArea) return false;
    if (filterStatus === "atrasadas" && (tk.done || !tk.dueDate || tk.dueDate >= todayStr())) return false;
    if (filterStatus !== "todas" && filterStatus !== "atrasadas" && taskStatusId(tk) !== filterStatus) return false;
    if (query && !tk.title.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  }).sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""));

  const save = (data) => { setTasks(upsertById(tasks, data)); };
  const remove = (id) => setTasks(tasks.filter((x) => x.id !== id));
  const toggleDone = (tk) => setTasks(toggleTaskDone(tasks, tk.id));

  const tasksFor = (date) => visibleTasks.filter((tk) => tk.dueDate === date);

  return (
    <div>
      <div className="cr-row" style={{ justifyContent: embedded ? "flex-end" : "space-between", marginBottom: 6, marginTop: embedded ? 12 : 0 }}>
        {!embedded && <div>
          <h1 className="cr-h1 cr-serif">Planejamento</h1>
          <p className="cr-sub">Tarefas, prazos e prioridades, tudo em um só lugar.</p>
        </div>}
        <button className="cr-btn primary" onClick={() => setEditing("new")}><Plus size={14} /> Nova tarefa</button>
      </div>

      <div className="cr-tabbar" style={{ marginTop: 10 }}>
        <button className={`cr-tabbtn ${viewMode === "lista" ? "active" : ""}`} onClick={() => setViewMode("lista")}>Lista</button>
        <button className={`cr-tabbtn ${viewMode === "dia" ? "active" : ""}`} onClick={() => setViewMode("dia")}>Dia</button>
        <button className={`cr-tabbtn ${viewMode === "semana" ? "active" : ""}`} onClick={() => setViewMode("semana")}>Semana</button>
        <button className={`cr-tabbtn ${viewMode === "mes" ? "active" : ""}`} onClick={() => setViewMode("mes")}>Mês</button>
        {doneCount > 0 && (
          <button className="cr-btn ghost" style={{ marginLeft: "auto" }} onClick={() => setShowDone(!showDone)}>
            {showDone ? "Ocultar concluídas" : `Ver concluídas (${doneCount})`}
          </button>
        )}
      </div>

      {viewMode === "lista" && (
        <div>
          <div className="cr-row" style={{ margin: "14px 0", flexWrap: "wrap" }}>
            <input className="cr-input" style={{ maxWidth: 220 }} placeholder="Buscar tarefa…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <select className="cr-select" style={{ maxWidth: 180 }} value={filterArea} onChange={(e) => setFilterArea(e.target.value)}>
              <option value="todas">Todas as áreas</option>
              {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button className="cr-btn" title="Gerenciar áreas" onClick={() => ctx.openAreas()}><SettingsIcon size={13} /> Gerenciar áreas</button>
            <select className="cr-select" style={{ maxWidth: 160 }} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="todas">Todos os status</option>
              {getList("taskStatus").map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}
              <option value="atrasadas">Atrasadas</option>
            </select>
            <button className="cr-btn" title="Gerenciar status" onClick={() => ctx.openManager("taskStatus")}><SettingsIcon size={13} /> Gerenciar status</button>
          </div>
          <div className="cr-card">
            {filtered.length === 0 && <p className="cr-empty">Nenhuma tarefa encontrada.</p>}
            {filtered.map((tk) => {
              const isOverdue = !tk.done && tk.dueDate && tk.dueDate < todayStr();
              return (
              <div className="cr-list-row cr-task-row" key={tk.id}>
                <div className={`cr-checkbox ${tk.done ? "checked" : ""}`} onClick={() => toggleDone(tk)}>
                  {tk.done && <Check size={13} />}
                </div>
                <span className="cr-list-title" style={{ flex: 1, textDecoration: tk.done ? "line-through" : "none", color: tk.done ? "var(--ink-soft)" : "var(--ink)" }}>{tk.title}</span>
                {tk.repeat && tk.repeat !== "nenhuma" && <span className="cr-chip">↻ {tk.repeat}</span>}
                {tk.dueDate && <span className="cr-chip" style={isOverdue ? { background: "#F6DEDA", color: "#A1493C" } : undefined}>{isOverdue ? "atrasada · " : ""}{fmtDateShort(tk.dueDate)}{tk.time ? ` ${tk.time}` : ""}</span>}
                <span className="cr-chip">{listName("taskStatus", taskStatusId(tk))}</span>
                <PriorityChip id={tk.priority} />
                <AreaBadge area={tk.area} areas={areas} />
                {tk.link && <button className="cr-btn ghost" style={{ padding: "4px 8px" }} onClick={() => openExternalLink(tk.link)}><Link2 size={12} /></button>}
                <button className="cr-btn ghost" onClick={() => setEditing(tk)}><Pencil size={14} /></button>
                <button className="cr-btn ghost danger" onClick={() => remove(tk.id)}><Trash2 size={14} /></button>
              </div>
              );
            })}
          </div>
        </div>
      )}

      {viewMode === "dia" && (() => {
        const dayTasks = tasksFor(anchorDate);
        return (
          <div>
            <div className="cr-row" style={{ margin: "14px 0", alignItems: "center" }}>
              <button className="cr-btn ghost" onClick={() => setAnchorDate(addDays(anchorDate, -1))}>←</button>
              <span className="cr-serif" style={{ fontSize: 16, textTransform: "capitalize" }}>
                {new Date(anchorDate + "T00:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
              </span>
              <button className="cr-btn ghost" onClick={() => setAnchorDate(addDays(anchorDate, 1))}>→</button>
              {anchorDate !== todayStr() && <button className="cr-btn ghost" onClick={() => setAnchorDate(todayStr())}>hoje</button>}
            </div>
            <div className="cr-card">
              {dayTasks.length === 0 && <p className="cr-empty">Nada planejado para esse dia.</p>}
              {dayTasks.map((tk) => (
                <div className="cr-list-row cr-task-row" key={tk.id}>
                  <div className={`cr-checkbox ${tk.done ? "checked" : ""}`} onClick={() => toggleDone(tk)}>{tk.done && <Check size={13} />}</div>
                  {tk.time && <span className="cr-chip">{tk.time}</span>}
                  <span className="cr-list-title" style={{ flex: 1, textDecoration: tk.done ? "line-through" : "none" }}>{tk.title}</span>
                  <PriorityChip id={tk.priority} />
                  <AreaBadge area={tk.area} areas={areas} />
                  {tk.link && <button className="cr-btn ghost" style={{ padding: "4px 8px" }} onClick={() => openExternalLink(tk.link)}><Link2 size={12} /></button>}
                  <button className="cr-btn ghost" onClick={() => setEditing(tk)}><Pencil size={14} /></button>
                  <button className="cr-btn ghost danger" onClick={() => remove(tk.id)}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {viewMode === "semana" && (() => {
        const weekStart = startOfWeek(anchorDate);
        const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
        return (
          <div>
            <div className="cr-row" style={{ margin: "14px 0", alignItems: "center" }}>
              <button className="cr-btn ghost" onClick={() => setAnchorDate(addDays(anchorDate, -7))}>←</button>
              <span className="cr-serif" style={{ fontSize: 15 }}>{fmtDateShort(weekStart)} – {fmtDateShort(addDays(weekStart, 6))}</span>
              <button className="cr-btn ghost" onClick={() => setAnchorDate(addDays(anchorDate, 7))}>→</button>
              <button className="cr-btn ghost" onClick={() => setAnchorDate(todayStr())}>hoje</button>
            </div>
            <div className="cr-calendar-scroll">
            <div className="cr-grid cr-calendar-grid" style={{ gridTemplateColumns: "repeat(7, 1fr)", gap: 8 }}>
              {days.map((d) => {
                const dayTasks = tasksFor(d);
                const isToday = d === todayStr();
                return (
                  <div key={d} className="cr-card" style={{ padding: 10, minHeight: 140, background: isToday ? "#FBF0E4" : undefined }}>
                    <p className="cr-sub" style={{ margin: 0, textTransform: "capitalize" }}>{fmtWeekday(d)}</p>
                    <p className="cr-serif" style={{ margin: "2px 0 8px", fontSize: 14 }}>{d.slice(8, 10)}</p>
                    {dayTasks.map((tk) => (
                      <div key={tk.id} onClick={() => setEditing(tk)} style={{
                        fontSize: 11.5, padding: "3px 6px", borderRadius: 6, marginBottom: 3, cursor: "pointer",
                        background: tk.done ? "#EFE8DE" : "#F3EDE4", textDecoration: tk.done ? "line-through" : "none",
                      }}>{tk.time ? `${tk.time} ` : ""}{tk.title}</div>
                    ))}
                  </div>
                );
              })}
            </div>
            </div>
          </div>
        );
      })()}

      {viewMode === "mes" && (() => {
        const [y, m] = anchorDate.slice(0, 7).split("-").map(Number);
        const firstOfMonth = `${y}-${String(m).padStart(2, "0")}-01`;
        const gridStart = startOfWeek(firstOfMonth);
        const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
        const monthName = new Date(firstOfMonth + "T00:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
        return (
          <div>
            <div className="cr-row" style={{ margin: "14px 0", alignItems: "center" }}>
              <button className="cr-btn ghost" onClick={() => setAnchorDate(addDays(firstOfMonth, -1))}>←</button>
              <span className="cr-serif" style={{ fontSize: 15, textTransform: "capitalize" }}>{monthName}</span>
              <button className="cr-btn ghost" onClick={() => setAnchorDate(addDays(firstOfMonth, 32))}>→</button>
            </div>
            <div className="cr-calendar-scroll">
            <div className="cr-grid cr-calendar-grid" style={{ gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
              {["seg", "ter", "qua", "qui", "sex", "sáb", "dom"].map((d) => (
                <p key={d} className="cr-sub" style={{ margin: 0, textAlign: "center", textTransform: "capitalize" }}>{d}</p>
              ))}
              {cells.map((d) => {
                const inMonth = d.slice(0, 7) === anchorDate.slice(0, 7);
                const count = tasksFor(d).length;
                const isToday = d === todayStr();
                return (
                  <div key={d}
                    onClick={() => { setAnchorDate(d); setViewMode("dia"); }}
                    style={{
                      cursor: "pointer", borderRadius: 8, padding: "6px 4px", minHeight: 46, textAlign: "center",
                      opacity: inMonth ? 1 : 0.35, background: isToday ? "#FBF0E4" : "#fff", border: "1px solid var(--line)",
                    }}>
                    <div style={{ fontSize: 12.5 }}>{Number(d.slice(8, 10))}</div>
                    {count > 0 && <div style={{ fontSize: 10, color: "var(--clay)", marginTop: 2 }}>{count} tarefa{count > 1 ? "s" : ""}</div>}
                  </div>
                );
              })}
            </div>
            </div>
          </div>
        );
      })()}

      {editing && (
        <TaskModal task={editing === "new" ? null : editing} areas={areas} onSave={save} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function TaskModal({ task, areas, onSave, onClose }) {
  const [form, setForm] = useState(task
    ? { ...task, status: taskStatusId(task) }
    : { title: "", area: areas[0]?.id, priority: "media", dueDate: todayStr(), time: "", link: "", done: false, status: defaultTaskStatus(false).id });
  const autoStatus = useAutoSave(form, onSave, undefined);
  return (
    <Modal title={task ? "Editar tarefa" : "Nova tarefa"} onClose={onClose}>
      <div className="cr-field"><label className="cr-label">Título</label>
        <input className="cr-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
      <div className="cr-field"><label className="cr-label">Área</label>
        <AreaSelect value={form.area} onChange={(v) => setForm({ ...form, area: v })} areas={areas} /></div>
      <div className="cr-row">
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Data</label>
          <input type="date" className="cr-input" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></div>
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Horário (opcional)</label>
          <input type="time" className="cr-input" value={form.time || ""} onChange={(e) => setForm({ ...form, time: e.target.value })} /></div>
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Prioridade</label>
          <ManagedSelect listKey="priority" value={form.priority} onChange={(v) => setForm({ ...form, priority: v })} /></div>
      </div>
      <div className="cr-field"><label className="cr-label">Status</label>
        <ManagedSelect listKey="taskStatus" value={form.status} onChange={(v) => {
          const done = isClosedItem("taskStatus", v);
          setForm({ ...form, status: v, done, doneAt: done ? (form.doneAt || todayStr()) : "" });
        }} /></div>
      <div className="cr-field"><label className="cr-label">Repetir</label>
        <select className="cr-select" value={form.repeat || "nenhuma"} onChange={(e) => setForm({ ...form, repeat: e.target.value })}>
          <option value="nenhuma">Não repete</option><option value="diaria">Todo dia</option><option value="semanal">Toda semana</option>
          <option value="quinzenal">A cada 15 dias</option><option value="mensal">Todo mês</option>
        </select>
        {form.repeat && form.repeat !== "nenhuma" && <p className="cr-sub" style={{ marginTop: 4 }}>Ao concluir, a próxima já é criada sozinha.</p>}
      </div>
      <div className="cr-field"><label className="cr-label">Link (reunião, evento…)</label>
        <input className="cr-input" value={form.link || ""} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="https://…" /></div>
      <AutoSaveFooter status={autoStatus} onClose={onClose} />
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/* GOALS / METAS                                                          */
/* ---------------------------------------------------------------------- */

function GoalsView({ goals, setGoals, areas }) {
  const ctx = useContext(ListsContext);
  const [editing, setEditing] = useState(null);
  const [filterStatus, setFilterStatus] = useState("todos");
  const [filterArea, setFilterArea] = useState("todas");
  const [viewAll, setViewAll] = useState(false);
  const save = (data) => { setGoals(upsertById(goals, data)); };
  const remove = (id) => setGoals(goals.filter((x) => x.id !== id));

  const filtered = goals.filter((g) => {
    if (filterStatus !== "todos" && g.status !== filterStatus) return false;
    if (filterArea !== "todas" && g.area !== filterArea) return false;
    return true;
  });

  const active = filtered.filter((g) => !isClosedItem("goalStatus", g.status));
  const finished = filtered.filter((g) => isClosedItem("goalStatus", g.status));

  const byArea = (list) => {
    const map = {};
    list.forEach((g) => {
      const key = g.area || "outros";
      map[key] = map[key] || [];
      map[key].push(g);
    });
    return areas
      .map((a) => ({ area: a, items: map[a.id] || [] }))
      .filter((grp) => grp.items.length > 0);
  };

  return (
    <div>
      <div className="cr-row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1 className="cr-h1 cr-serif">Metas</h1>
          <p className="cr-sub">Objetivos de curto, médio e longo prazo.</p>
        </div>
        <button className="cr-btn primary" onClick={() => setEditing("new")}><Plus size={14} /> Nova meta</button>
      </div>
      {(() => {
        const gm = goalsMood(goals);
        return (
          <div className="cr-card" style={{ margin: "14px 0", display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
            <PandaMood mood={gm.mood} />
            <div>
              <p className="cr-label" style={{ marginBottom: 4 }}>Como estão suas metas</p>
              <p className="cr-serif" style={{ fontSize: 15, margin: 0 }}>{gm.message}</p>
            </div>
          </div>
        );
      })()}
      <div className="cr-row" style={{ margin: "14px 0", flexWrap: "wrap" }}>
        <select className="cr-select" style={{ maxWidth: 190 }} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="todos">Todos os status</option>
          {getList("goalStatus").map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
        </select>
        <button className="cr-btn" title="Gerenciar opções (criar, renomear, excluir, reordenar)" onClick={() => ctx.openManager("goalStatus")}><SettingsIcon size={13} /> Gerenciar status</button>
        <select className="cr-select" style={{ maxWidth: 190 }} value={filterArea} onChange={(e) => setFilterArea(e.target.value)}>
          <option value="todas">Todas as categorias</option>
          {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <button className="cr-btn" title="Gerenciar opções (criar, renomear, excluir, reordenar)" onClick={() => ctx.openAreas()}><SettingsIcon size={13} /> Gerenciar categorias</button>
        <button className="cr-btn ghost" onClick={() => setViewAll(!viewAll)}>{viewAll ? "Ver por categoria" : "Visualizar todos"}</button>
      </div>

      {filtered.length === 0 && <p className="cr-empty">Nenhuma meta encontrada com esse filtro.</p>}

      {viewAll ? (
        <div className="cr-grid cr-grid-2">
          {filtered.map((g) => <GoalCard key={g.id} g={g} areas={areas} onEdit={() => setEditing(g)} onRemove={() => remove(g.id)} />)}
        </div>
      ) : (
        <div>
          {byArea(active).map(({ area, items }) => (
            <div key={area.id} style={{ marginBottom: 22 }}>
              <SectionTitle title={area.name} count={`${items.length} ${items.length === 1 ? "meta" : "metas"}`} />
              <div className="cr-grid cr-grid-2">
                {items.map((g) => <GoalCard key={g.id} g={g} areas={areas} onEdit={() => setEditing(g)} onRemove={() => remove(g.id)} />)}
              </div>
            </div>
          ))}
          {finished.length > 0 && (
            <div style={{ marginTop: 28, paddingTop: 18, borderTop: "1px solid var(--line)" }}>
              <SectionTitle title="Concluídas / canceladas" count={`${finished.length}`} />
              <div className="cr-grid cr-grid-2">
                {finished.map((g) => <GoalCard key={g.id} g={g} areas={areas} onEdit={() => setEditing(g)} onRemove={() => remove(g.id)} dimmed />)}
              </div>
            </div>
          )}
        </div>
      )}

      {editing && <GoalModal goal={editing === "new" ? null : editing} areas={areas} onSave={save} onClose={() => setEditing(null)} />}
    </div>
  );
}

function GoalCard({ g, areas, onEdit, onRemove, dimmed }) {
  return (
    <div className="cr-card" style={dimmed ? { opacity: 0.75 } : undefined}>
      {g.image ? (
        <img src={g.image} alt="" style={{ width: "100%", height: 110, objectFit: "cover", borderRadius: 10, marginBottom: 8 }} />
      ) : (
        <button onClick={onEdit} style={{
          width: "100%", height: 76, borderRadius: 10, marginBottom: 8, border: "1.5px dashed var(--line)",
          background: "#FBF8F4", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 3, cursor: "pointer", color: "var(--ink-soft)",
        }}>
          <ImageIcon size={16} />
          <span style={{ fontSize: 11 }}>Adicionar imagem</span>
        </button>
      )}
      <div className="cr-row" style={{ justifyContent: "space-between" }}>
        <h3 className="cr-serif" style={{ margin: 0, fontSize: 16 }}>{g.name}</h3>
        <div className="cr-row" style={{ gap: 4 }}>
          <button className="cr-btn ghost" onClick={onEdit}><Pencil size={14} /></button>
          <button className="cr-btn ghost danger" onClick={onRemove}><Trash2 size={14} /></button>
        </div>
      </div>
      <div className="cr-row" style={{ margin: "8px 0" }}>
        <AreaBadge area={g.area} areas={areas} />
        <span className="cr-chip">{listName("goalStatus", g.status)}</span>
        {g.deadline && <span className="cr-chip">até {fmtDateShort(g.deadline)}</span>}
      </div>
      <div className="cr-progress-track"><div className="cr-progress-fill" style={{ width: `${g.progress}%`, background: progressColor(g.progress) }} /></div>
      <p className="cr-sub" style={{ marginTop: 6 }}>{g.progress}% concluído</p>
      {g.note && <p style={{ fontSize: 13.5, marginTop: 6 }}>{g.note}</p>}
      {g.link && <button className="cr-btn ghost" style={{ marginTop: 6, padding: "4px 8px" }} onClick={() => openExternalLink(g.link)}><Link2 size={12} /> Abrir link</button>}
    </div>
  );
}

function GoalModal({ goal, areas, onSave, onClose }) {
  const [form, setForm] = useState(goal || { name: "", area: areas[0]?.id, deadline: "", progress: 0, status: "em andamento", note: "", link: "", image: "" });
  const autoStatus = useAutoSave(form, onSave, undefined);
  return (
    <Modal title={goal ? "Editar meta" : "Nova meta"} onClose={onClose}>
      <div className="cr-field"><label className="cr-label">Nome</label>
        <input className="cr-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
      <ImagePickerField label="Imagem de capa" value={form.image} onChange={(v) => setForm({ ...form, image: v })} />
      <div className="cr-field"><label className="cr-label">Área</label>
        <AreaSelect value={form.area} onChange={(v) => setForm({ ...form, area: v })} areas={areas} /></div>
      <div className="cr-row">
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Prazo</label>
          <input type="date" className="cr-input" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></div>
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Status</label>
          <ManagedSelect listKey="goalStatus" value={form.status} onChange={(v) => setForm({ ...form, status: v })} /></div>
      </div>
      <div className="cr-field"><label className="cr-label">Progresso: {form.progress}%</label>
        <input type="range" min="0" max="100" value={form.progress} onChange={(e) => setForm({ ...form, progress: Number(e.target.value) })} style={{ width: "100%" }} /></div>
      <div className="cr-field"><label className="cr-label">Link (opcional)</label>
        <input className="cr-input" value={form.link || ""} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="https://…" /></div>
      <div className="cr-field"><label className="cr-label">Notas / motivo</label>
        <textarea className="cr-textarea" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
      <AutoSaveFooter status={autoStatus} onClose={onClose} />
    </Modal>
  );
}
function last7Days() {
  const arr = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    arr.push(localDateStr(d));
  }
  return arr;
}

function streakFor(habit) {
  let streak = 0;
  let d = new Date();
  while (true) {
    const key = localDateStr(d);
    if (habit.log[key]) { streak++; d.setDate(d.getDate() - 1); }
    else break;
  }
  return streak;
}

function HabitsView({ habits, setHabits, areas }) {
  const [editing, setEditing] = useState(null);
  const days = last7Days();
  const save = (data) => { setHabits(upsertById(habits, data, { log: {} })); };
  const remove = (id) => setHabits(habits.filter((x) => x.id !== id));
  const toggle = (h, day) => {
    const log = { ...h.log };
    if (log[day]) delete log[day]; else log[day] = true;
    setHabits(habits.map((x) => x.id === h.id ? { ...x, log } : x));
  };

  return (
    <div>
      <div className="cr-row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1 className="cr-h1 cr-serif">Hábitos</h1>
          <p className="cr-sub">Consistência dos últimos 7 dias.</p>
        </div>
        <button className="cr-btn primary" onClick={() => setEditing("new")}><Plus size={14} /> Novo hábito</button>
      </div>

      <div className="cr-card" style={{ marginTop: 16 }}>
        <div className="cr-row" style={{ paddingLeft: 172, marginBottom: 8 }}>
          {days.map((d) => <span key={d} className="cr-sub" style={{ width: 30, textAlign: "center", margin: 0 }}>{d.slice(8, 10)}</span>)}
        </div>
        {habits.length === 0 && <p className="cr-empty">Nenhum hábito cadastrado ainda.</p>}
        {habits.map((h) => (
          <div className="cr-list-row" key={h.id}>
            <div style={{ width: 150, flexShrink: 0 }}>
              <div style={{ fontSize: 13.5 }}>{h.name}</div>
              <div className="cr-row" style={{ gap: 4 }}><AreaBadge area={h.area} areas={areas} /></div>
            </div>
            <div className="cr-row" style={{ gap: 0 }}>
              {days.map((d) => (
                <div key={d} onClick={() => toggle(h, d)}
                  className={`cr-checkbox ${h.log[d] ? "checked" : ""}`}
                  style={{ width: 26, height: 26, margin: "0 2px" }}>
                  {h.log[d] && <Check size={12} />}
                </div>
              ))}
            </div>
            <span className="cr-chip" style={{ marginLeft: 8 }}><Flame size={12} style={{ marginRight: 3 }} />{streakFor(h)}</span>
            <button className="cr-btn ghost" onClick={() => setEditing(h)}><Pencil size={14} /></button>
            <button className="cr-btn ghost danger" onClick={() => remove(h.id)}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
      {editing && <HabitModal habit={editing === "new" ? null : editing} areas={areas} onSave={save} onClose={() => setEditing(null)} />}
    </div>
  );
}

function HabitModal({ habit, areas, onSave, onClose }) {
  const [form, setForm] = useState(habit || { name: "", area: areas[0]?.id, frequency: "diario" });
  const autoStatus = useAutoSave(form, onSave, undefined);
  return (
    <Modal title={habit ? "Editar hábito" : "Novo hábito"} onClose={onClose}>
      <div className="cr-field"><label className="cr-label">Nome</label>
        <input className="cr-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
      <div className="cr-field"><label className="cr-label">Área</label>
        <AreaSelect value={form.area} onChange={(v) => setForm({ ...form, area: v })} areas={areas} /></div>
      <div className="cr-field"><label className="cr-label">Frequência</label>
        <ManagedSelect listKey="habitFrequency" value={form.frequency} onChange={(v) => setForm({ ...form, frequency: v })} /></div>
      <AutoSaveFooter status={autoStatus} onClose={onClose} />
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/* FINANCE — sistema financeiro inteligente                                */
/* ---------------------------------------------------------------------- */

function addMonths(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const base = new Date(y, m - 1 + n, 1);
  const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  base.setDate(Math.min(d, lastDay));
  return localDateStr(base);
}

function effectiveStatus(tx) {
  const today = todayStr();
  if ((tx.status === "agendado" || tx.status === "pendente") && tx.date < today) return "atrasado";
  return tx.status || "pago";
}

function monthLabel(m) {
  const [y, mo] = m.split("-");
  const names = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return `${names[Number(mo) - 1]}/${y.slice(2)}`;
}

const CATEGORY_PALETTE = ["#C9A57E", "#D9A79A", "#97A587", "#A99BC0", "#9DB4BE", "#D6A98C", "#B7A6C9", "#E0AFA6"];
const EXPENSE_CLASS_LABEL = {
  fixed: "Fixo",
  variable: "Variável",
  recurring: "Recorrente",
  one_time: "Pontual",
  procedure: "Procedimento",
  hobby: "Hobby / lazer",
  reserve: "Transferência para reserva",
  investment: "Investimento",
};

function expenseCategoryData(finance, month) {
  const monthTx = finance.filter((f) => f.date?.slice(0, 7) === month && f.status !== "cancelado");
  const catMap = {};
  monthTx.filter((f) =>
    f.type === "saida"
    && (!f.status || f.status === "pago")
    && !["reserve", "investment"].includes(f.expenseClass)
  ).forEach((f) => {
    const cat = f.category || "Outros";
    catMap[cat] = (catMap[cat] || 0) + Number(f.amount);
  });
  return Object.entries(catMap)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value], i) => ({ label, value, color: CATEGORY_PALETTE[i % CATEGORY_PALETTE.length] }));
}

function generateInstallments(base, count) {
  const total = Number(base.amount) || 0;
  const per = Math.round((total / count) * 100) / 100;
  const groupId = uid();
  const list = [];
  let allocated = 0;
  for (let i = 0; i < count; i++) {
    const amt = i === count - 1 ? Math.round((total - allocated) * 100) / 100 : per;
    allocated += amt;
    list.push({
      ...base, id: uid(), amount: amt, date: addMonths(base.date, i),
      installmentGroup: { id: groupId, index: i + 1, total: count, totalAmount: total },
      status: i === 0 ? (base.date <= todayStr() ? "pago" : "agendado") : "agendado",
    });
  }
  return list;
}

function generateRecurringOccurrences(base, monthsAhead) {
  const recurringId = uid();
  const list = [{ ...base, id: uid(), recurringId, status: base.date <= todayStr() ? "pago" : "agendado" }];
  for (let i = 1; i <= monthsAhead; i++) {
    list.push({ ...base, id: uid(), date: addMonths(base.date, i), recurringId, status: "agendado" });
  }
  return list;
}

const STATUS_LABEL = new Proxy({}, { get: (_, st) => (st === "atrasado" ? "Atrasado" : listName("financeStatus", st)) });

function PandaMood({ mood, size = 110 }) {
  const mouthPath = mood === "happy" ? "M 38 72 Q 55 86 72 72" : mood === "sad" ? "M 38 80 Q 55 66 72 80" : "M 40 74 L 70 74";
  const eyeOffsetY = mood === "sad" ? 2 : mood === "happy" ? -1 : 0;
  const patchRotL = mood === "sad" ? -8 : mood === "happy" ? 8 : 0;
  const patchRotR = mood === "sad" ? 8 : mood === "happy" ? -8 : 0;
  return (
    <svg width={size} height={size} viewBox="0 0 110 110">
      <circle cx="22" cy="20" r="14" fill="#2E2A25" />
      <circle cx="88" cy="20" r="14" fill="#2E2A25" />
      <circle cx="55" cy="55" r="42" fill="#FBF7F2" stroke="#E9E1D6" strokeWidth="2" />
      <ellipse cx="38" cy="52" rx="13" ry="16" fill="#2E2A25" transform={`rotate(${patchRotL} 38 52)`} />
      <ellipse cx="72" cy="52" rx="13" ry="16" fill="#2E2A25" transform={`rotate(${patchRotR} 72 52)`} />
      <circle cx="38" cy={52 + eyeOffsetY} r="4.5" fill="#fff" />
      <circle cx="72" cy={52 + eyeOffsetY} r="4.5" fill="#fff" />
      <circle cx="38" cy={53 + eyeOffsetY} r="2.2" fill="#2E2A25" />
      <circle cx="72" cy={53 + eyeOffsetY} r="2.2" fill="#2E2A25" />
      <ellipse cx="55" cy="64" rx="4" ry="3" fill="#2E2A25" />
      <path d={mouthPath} stroke="#2E2A25" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      {mood === "happy" && (
        <>
          <circle cx="24" cy="66" r="5.5" fill="#E3B5AB" opacity="0.55" />
          <circle cx="86" cy="66" r="5.5" fill="#E3B5AB" opacity="0.55" />
        </>
      )}
    </svg>
  );
}

function financeMood(income, expense) {
  if (income <= 0 && expense <= 0) return { mood: "neutral", message: "Sem lançamentos neste mês ainda." };
  if (income <= 0) return { mood: "sad", message: "Só saiu dinheiro esse mês, nada entrou ainda." };
  const ratio = expense / income;
  if (ratio <= 0.7) return { mood: "happy", message: "Você está economizando bem esse mês!" };
  if (ratio <= 1) return { mood: "neutral", message: "Seus gastos estão quase batendo com a renda." };
  return { mood: "sad", message: "Você está gastando mais do que ganhou esse mês." };
}

function goalsMood(goals) {
  const active = goals.filter((g) => !isClosedItem("goalStatus", g.status));
  if (active.length === 0) return { mood: "neutral", message: "Nenhuma meta ativa no momento." };
  const avg = active.reduce((s, g) => s + Number(g.progress || 0), 0) / active.length;
  if (avg >= 60) return { mood: "happy", message: "Suas metas estão indo muito bem!" };
  if (avg >= 30) return { mood: "neutral", message: "Progresso moderado nas suas metas." };
  return { mood: "sad", message: "Suas metas ativas precisam de mais atenção." };
}

function overallMood(tasks, goals, habits, finance) {
  const today = todayStr();
  const thisMonth = today.slice(0, 7);

  const monthTx = finance.filter((f) => f.date.slice(0, 7) === thisMonth && f.status !== "cancelado");
  const income = monthTx.filter((f) => f.type === "entrada" && (!f.status || f.status === "pago")).reduce((s, f) => s + Number(f.amount), 0);
  const expense = monthTx
    .filter((f) => f.type === "saida" && (!f.status || f.status === "pago") && !["reserve", "investment"].includes(f.expenseClass))
    .reduce((s, f) => s + Number(f.amount), 0);
  let financeScore = 60, financeLabel = "sem dados";
  if (income > 0 || expense > 0) {
    const ratio = income > 0 ? expense / income : 2;
    financeScore = ratio <= 0.7 ? 90 : ratio <= 1 ? 60 : 25;
    financeLabel = financeScore >= 90 ? "ótimo" : financeScore >= 60 ? "equilibrado" : "atenção";
  }

  const activeGoals = goals.filter((g) => !isClosedItem("goalStatus", g.status));
  let goalsScore = 60, goalsLabel = "sem dados";
  if (activeGoals.length > 0) {
    goalsScore = activeGoals.reduce((s, g) => s + Number(g.progress || 0), 0) / activeGoals.length;
    goalsLabel = goalsScore >= 60 ? "ótimo" : goalsScore >= 30 ? "ok" : "atenção";
  }

  let habitsScore = 60, habitsLabel = "sem dados";
  if (habits.length > 0) {
    const done = habits.filter((h) => h.log[today]).length;
    habitsScore = (done / habits.length) * 100;
    habitsLabel = habitsScore >= 70 ? "ótimo" : habitsScore >= 40 ? "ok" : "atenção";
  }

  const tasksToday = tasks.filter((t) => t.dueDate === today);
  const overdueCount = tasks.filter((t) => !t.done && t.dueDate && t.dueDate < today).length;
  let tasksScore = 60, tasksLabel = "sem dados";
  if (tasksToday.length > 0 || overdueCount > 0) {
    const base = tasksToday.length ? (tasksToday.filter((t) => t.done).length / tasksToday.length) * 100 : 60;
    tasksScore = Math.max(0, base - overdueCount * 10);
    tasksLabel = tasksScore >= 70 ? "ótimo" : tasksScore >= 40 ? "ok" : "atenção";
  }

  const overall = (financeScore + goalsScore + habitsScore + tasksScore) / 4;
  const mood = overall >= 65 ? "happy" : overall >= 40 ? "neutral" : "sad";
  const message = mood === "happy" ? "Seu panorama geral está ótimo hoje!"
    : mood === "neutral" ? "Dia equilibrado — dá pra melhorar em algumas áreas."
    : "Hoje está mais puxado — respire e ajuste o que der.";

  return {
    mood, message,
    breakdown: [
      { label: "Finanças", status: financeLabel },
      { label: "Metas", status: goalsLabel },
      { label: "Hábitos", status: habitsLabel },
      { label: "Tarefas", status: tasksLabel },
    ],
  };
}

function FinanceView({ finance, setFinance, accounts, setAccounts, cards, setCards, settings, setSettings, investments, setInvestments }) {
  const ctx = useContext(ListsContext);
  const [editing, setEditing] = useState(null);
  const [tab, setTab] = useState("visao");
  const [filterStatus, setFilterStatus] = useState("todos");
  const [monthOffset, setMonthOffset] = useState(0);
  const [invoiceCard, setInvoiceCard] = useState(cards[0]?.id || "");

  const save = (data) => {
    const { installmentsCount, recurringEnabled, recurringMonths, ...base } = data;
    if (base.type === "saida") {
      base.plannedAmount = Number(base.plannedAmount) || Number(base.amount) || 0;
    } else {
      delete base.plannedAmount;
    }
    return setFinance(upsertById(finance, base));
  };
  // parcelamento e recorrência geram vários lançamentos de uma vez, então têm um botão próprio
  const generate = (data) => {
    const { installmentsCount, recurringEnabled, recurringMonths, id, ...base } = data;
    const rest = finance.filter((x) => x.id !== id);
    if (base.paymentMethod === "Crédito" && Number(installmentsCount) > 1) setFinance([...generateInstallments(base, Number(installmentsCount)), ...rest]);
    else setFinance([...generateRecurringOccurrences(base, Number(recurringMonths) || 12), ...rest]);
    setEditing(null);
  };
  const discardDraft = (id) => { if (finance.some((x) => x.id === id)) setFinance(finance.filter((x) => x.id !== id)); };
  const remove = (id) => setFinance(finance.filter((x) => x.id !== id));

  const selectedMonth = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + monthOffset);
    return localDateStr(d).slice(0, 7);
  }, [monthOffset]);

  const monthTx = finance.filter((f) => f.date?.slice(0, 7) === selectedMonth && f.status !== "cancelado");
  const planSummary = useMemo(
    () => summarizeFinanceMonth(finance, settings.financePlan, selectedMonth),
    [finance, settings.financePlan, selectedMonth],
  );
  const income = planSummary.receivedIncome;
  const expense = planSummary.spent;
  const balance = income - expense;
  const invoiceTotal = monthTx.filter((f) => f.paymentMethod === "Crédito").reduce((s, f) => s + Number(f.amount || 0), 0);
  const futureInstallments = finance.filter((f) => f.installmentGroup && f.date.slice(0, 7) > selectedMonth).reduce((s, f) => s + Number(f.amount), 0);

  const byMonth = useMemo(() => {
    const map = {};
    finance.forEach((f) => {
      if (typeof f.date !== "string") return;
      if (f.status === "cancelado" || (f.status && f.status !== "pago")
        || (f.type === "saida" && ["reserve", "investment"].includes(f.expenseClass))) return;
      const m = f.date.slice(0, 7);
      map[m] = map[m] || { month: monthLabel(m), _m: m, entrada: 0, saida: 0 };
      map[m][f.type === "entrada" ? "entrada" : "saida"] += Number(f.amount);
    });
    return Object.values(map).sort((a, b) => a._m.localeCompare(b._m)).slice(-6);
  }, [finance]);

  const filteredTx = finance
    .filter((f) => filterStatus === "todos" || effectiveStatus(f) === filterStatus)
    .slice().sort((a, b) => b.date.localeCompare(a.date));

  const cashFlow = useMemo(() => {
    const months = [];
    for (let i = 0; i < 4; i++) {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + i);
      const m = localDateStr(d).slice(0, 7);
      const tx = finance.filter((f) => f.date.slice(0, 7) === m && f.status !== "cancelado");
      const inc = tx.filter((f) => f.type === "entrada").reduce((s, f) => s + Number(f.amount), 0);
      const exp = tx.filter((f) => f.type === "saida").reduce((s, f) => s + Number(f.amount), 0);
      months.push({ month: monthLabel(m), income: inc, expense: exp, balance: inc - exp });
    }
    return months;
  }, [finance]);

  return (
    <div>
      <div className="cr-row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1 className="cr-h1 cr-serif">Finanças</h1>
          <p className="cr-sub">Orçamento mensal, renda recebida, compromissos, despesas e investimentos.</p>
        </div>
        <button className="cr-btn primary" onClick={() => setEditing("new")}><Plus size={14} /> Novo lançamento</button>
      </div>

      <div className="cr-tabbar" style={{ marginTop: 14 }}>
        <button className={`cr-tabbtn ${tab === "visao" ? "active" : ""}`} onClick={() => setTab("visao")}>Visão mensal</button>
        <button className={`cr-tabbtn ${tab === "planejamento" ? "active" : ""}`} onClick={() => setTab("planejamento")}>Planejamento</button>
        <button className={`cr-tabbtn ${tab === "lancamentos" ? "active" : ""}`} onClick={() => setTab("lancamentos")}>Lançamentos</button>
        <button className={`cr-tabbtn ${tab === "fatura" ? "active" : ""}`} onClick={() => setTab("fatura")}>Fatura</button>
        <button className={`cr-tabbtn ${tab === "fluxo" ? "active" : ""}`} onClick={() => setTab("fluxo")}>Fluxo de caixa</button>
        <button className={`cr-tabbtn ${tab === "investimentos" ? "active" : ""}`} onClick={() => setTab("investimentos")}>Investimentos</button>
        <button className={`cr-tabbtn ${tab === "contas" ? "active" : ""}`} onClick={() => setTab("contas")}>Contas & Cartões</button>
      </div>

      {tab === "visao" && (
        <div>
          <div className="cr-row" style={{ margin: "14px 0", alignItems: "center" }}>
            <button className="cr-btn ghost" onClick={() => setMonthOffset(monthOffset - 1)}>←</button>
            <span className="cr-serif" style={{ fontSize: 16, minWidth: 90, textAlign: "center" }}>{monthLabel(selectedMonth)}</span>
            <button className="cr-btn ghost" onClick={() => setMonthOffset(monthOffset + 1)}>→</button>
            {monthOffset !== 0 && <button className="cr-btn ghost" onClick={() => setMonthOffset(0)}>hoje</button>}
          </div>
          {(() => {
            const fm = financeMood(income, expense);
            return (
              <div className="cr-card" style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
                <PandaMood mood={fm.mood} />
                <div>
                  <p className="cr-label" style={{ marginBottom: 4 }}>Como está seu mês</p>
                  <p className="cr-serif" style={{ fontSize: 15, margin: 0 }}>{fm.message}</p>
                </div>
              </div>
            );
          })()}
          <div className="cr-grid cr-grid-3" style={{ marginBottom: 16 }}>
            <div className="cr-card"><p className="cr-label">Renda efetivamente recebida</p><p className="cr-serif" style={{ fontSize: 20 }}>{fmtBRL(income)}</p></div>
            <div className="cr-card"><p className="cr-label">Gastos efetivamente realizados</p><p className="cr-serif" style={{ fontSize: 20 }}>{fmtBRL(expense)}</p></div>
            <div className="cr-card"><p className="cr-label">Saldo após gastos de consumo</p><p className="cr-serif" style={{ fontSize: 20, color: balance >= 0 ? "#5C7A56" : "#A1493C" }}>{fmtBRL(balance)}</p></div>
            <div className="cr-card"><p className="cr-label">Despesas fixas pendentes</p><p className="cr-serif" style={{ fontSize: 20 }}>{fmtBRL(planSummary.fixedCommitments)}</p></div>
            <div className="cr-card"><p className="cr-label">Gastos fixos realizados</p><p className="cr-serif" style={{ fontSize: 20 }}>{fmtBRL(planSummary.fixedSpent)}</p></div>
            <div className="cr-card"><p className="cr-label">Gastos variáveis realizados</p><p className="cr-serif" style={{ fontSize: 20 }}>{fmtBRL(planSummary.variableSpent)}</p></div>
            <div className="cr-card"><p className="cr-label">Outras despesas pendentes</p><p className="cr-serif" style={{ fontSize: 20 }}>{fmtBRL(planSummary.variableCommitments)}</p></div>
            <div className="cr-card"><p className="cr-label">Reserva protegida ainda pendente</p><p className="cr-serif" style={{ fontSize: 20 }}>{fmtBRL(planSummary.reservedRemaining)}</p></div>
            <div className="cr-card"><p className="cr-label">Reservas e investimentos realizados</p><p className="cr-serif" style={{ fontSize: 20 }}>{fmtBRL(planSummary.transferPaid)}</p></div>
            <div className="cr-card"><p className="cr-label">Previsão de gastos do mês</p><p className="cr-serif" style={{ fontSize: 20 }}>{fmtBRL(planSummary.projectedSpending)}</p></div>
            <div className="cr-card"><p className="cr-label">Disponível sem comprometer metas</p><p className="cr-serif" style={{ fontSize: 20, color: planSummary.available >= 0 ? "#5C7A56" : "#A1493C" }}>{fmtBRL(planSummary.available)}</p></div>
            <div className="cr-card"><p className="cr-label">Percentual da renda recebido já gasto</p><p className="cr-serif" style={{ fontSize: 20 }}>{income > 0 ? `${Math.round((expense / income) * 100)}%` : "—"}</p></div>
            <div className="cr-card"><p className="cr-label">Fatura do cartão (crédito)</p><p className="cr-serif" style={{ fontSize: 20 }}>{fmtBRL(invoiceTotal)}</p></div>
            <div className="cr-card"><p className="cr-label">Parcelas futuras</p><p className="cr-serif" style={{ fontSize: 20 }}>{fmtBRL(futureInstallments)}</p></div>
            <div className="cr-card"><p className="cr-label">Lançamentos no mês</p><p className="cr-serif" style={{ fontSize: 20 }}>{monthTx.length}</p></div>
          </div>
          <div className="cr-card" style={{ marginBottom: 16 }}>
            <p className="cr-label" style={{ marginBottom: 6 }}>Planejamento por categoria — {monthLabel(selectedMonth)}</p>
            {planSummary.byCategory.length === 0
              ? <p className="cr-sub" style={{ margin: 0 }}>Configure limites na aba Planejamento. Os limites acompanham apenas rendas efetivamente recebidas.</p>
              : planSummary.byCategory.map((entry) => (
                <div className="cr-list-row" key={entry.id}>
                  <span className="cr-list-title" style={{ flex: 1 }}>{entry.category}</span>
                  <span className="cr-chip">limite {fmtBRL(entry.limit)}</span>
                  <span className="cr-chip">gasto {fmtBRL(entry.spent)}</span>
                  <span className="cr-chip">comprometido {fmtBRL(entry.committed)}</span>
                  <strong style={{ color: entry.remaining >= 0 ? "#5C7A56" : "#A1493C" }}>{fmtBRL(entry.remaining)}</strong>
                </div>
              ))}
          </div>
          {byMonth.length > 0 && (
            <div className="cr-card" style={{ marginBottom: 16 }}>
              <p className="cr-label" style={{ marginBottom: 6 }}>Últimos meses</p>
              <MiniBarChartFinance data={byMonth} />
            </div>
          )}
          {(() => {
            const catData = expenseCategoryData(finance, selectedMonth);
            if (catData.length === 0) return null;
            return (
              <div className="cr-card" style={{ marginBottom: 16 }}>
                <p className="cr-label" style={{ marginBottom: 10 }}>Gastos por categoria — {monthLabel(selectedMonth)}</p>
                <DonutChart data={catData} />
              </div>
            );
          })()}
          <div className="cr-card">
            <p className="cr-label" style={{ marginBottom: 6 }}>Lançamentos do mês</p>
            {monthTx.length === 0 && <p className="cr-empty">Nada neste mês.</p>}
            {monthTx.slice().sort((a, b) => b.date.localeCompare(a.date)).map((f) => (
              <FinanceRow key={f.id} f={f} onEdit={() => setEditing(f)} onRemove={() => remove(f.id)} />
            ))}
          </div>
        </div>
      )}

      {tab === "lancamentos" && (
        <div>
          <div className="cr-row" style={{ margin: "14px 0" }}>
            <select className="cr-select" style={{ maxWidth: 180 }} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="todos">Todos os status</option>
              {getList("financeStatus").map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
              <option value="atrasado">Atrasado</option>
            </select>
            <button className="cr-btn" title="Gerenciar opções (criar, renomear, excluir, reordenar)" onClick={() => ctx.openManager("financeStatus")}><SettingsIcon size={13} /> Gerenciar status</button>
          </div>
          <div className="cr-card">
            {filteredTx.length === 0 && <p className="cr-empty">Nenhum lançamento encontrado.</p>}
            {filteredTx.map((f) => (
              <FinanceRow key={f.id} f={f} onEdit={() => setEditing(f)} onRemove={() => remove(f.id)} />
            ))}
          </div>
        </div>
      )}

      {tab === "planejamento" && (
        <FinancePlanningPanel finance={finance} month={selectedMonth} settings={settings} setSettings={setSettings} summary={planSummary} />
      )}

      {tab === "fatura" && (
        <div>
          <div className="cr-row" style={{ margin: "14px 0", alignItems: "center" }}>
            <select className="cr-select" style={{ maxWidth: 200 }} value={invoiceCard} onChange={(e) => setInvoiceCard(e.target.value)}>
              <option value="">Selecione um cartão</option>
              {cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button className="cr-btn ghost" onClick={() => setMonthOffset(monthOffset - 1)}>←</button>
            <span className="cr-serif" style={{ fontSize: 15 }}>{monthLabel(selectedMonth)}</span>
            <button className="cr-btn ghost" onClick={() => setMonthOffset(monthOffset + 1)}>→</button>
          </div>
          {!invoiceCard && cards.length === 0 && <p className="cr-empty">Cadastre um cartão em "Contas & Cartões" para ver a fatura.</p>}
          {invoiceCard && (() => {
            const cardTx = finance.filter((f) => f.cardId === invoiceCard && f.date.slice(0, 7) === selectedMonth);
            const total = cardTx.reduce((s, f) => s + Number(f.amount), 0);
            return (
              <div className="cr-card">
                <div className="cr-row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
                  <span className="cr-serif" style={{ fontSize: 16 }}>Total da fatura</span>
                  <span className="cr-serif" style={{ fontSize: 18 }}>{fmtBRL(total)}</span>
                </div>
                {cardTx.length === 0 && <p className="cr-empty">Nenhuma compra neste cartão em {monthLabel(selectedMonth)}.</p>}
                {cardTx.map((f) => (
                  <div className="cr-list-row" key={f.id}>
                    <span className="cr-list-title" style={{ flex: 1 }}>{f.desc || f.category}</span>
                    {f.installmentGroup && <span className="cr-chip">{f.installmentGroup.index}/{f.installmentGroup.total}</span>}
                    <span className="cr-chip" style={{ background: effectiveStatus(f) === "atrasado" ? "#F6DEDA" : undefined }}>{STATUS_LABEL[effectiveStatus(f)]}</span>
                    <span style={{ fontWeight: 600, fontSize: 13.5 }}>{fmtBRL(f.amount)}</span>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {tab === "fluxo" && (
        <div>
          <p className="cr-sub" style={{ margin: "14px 0" }}>Previsão a partir dos lançamentos agendados e pagos. Renda futura não é saldo disponível até ser recebida.</p>
          <div className="cr-grid cr-grid-4">
            {cashFlow.map((m, i) => (
              <div className="cr-card" key={i}>
                <p className="cr-label">{m.month}</p>
                <p className="cr-sub" style={{ margin: "4px 0", color: "#5C7A56" }}>+{fmtBRL(m.income)}</p>
                <p className="cr-sub" style={{ margin: "4px 0", color: "#A1493C" }}>-{fmtBRL(m.expense)}</p>
                <p className="cr-serif" style={{ fontSize: 16, color: m.balance >= 0 ? "#5C7A56" : "#A1493C" }}>{fmtBRL(m.balance)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "investimentos" && <InvestmentsPanel investments={investments} setInvestments={setInvestments} settings={settings} setSettings={setSettings} />}

      {tab === "contas" && (
        <AccountsCardsPanel accounts={accounts} setAccounts={setAccounts} cards={cards} setCards={setCards} settings={settings} setSettings={setSettings} />
      )}

      {editing && (
        <FinanceModal item={editing === "new" ? null : editing} onSave={save} onGenerate={generate} onDiscard={discardDraft} onClose={() => setEditing(null)}
          accounts={accounts} cards={cards} paymentMethods={settings.paymentMethods || DEFAULT_SETTINGS.paymentMethods}
          categories={settings.financeCategories || DEFAULT_SETTINGS.financeCategories} />
      )}
    </div>
  );
}

function FinancePlanningPanel({ finance, month, settings, setSettings, summary }) {
  const plan = settings.financePlan || { grossSalary: "", extraIncome: "", deductions: "", netSalary: "", payday: "5", allocations: [] };
  const allocations = Array.isArray(plan.allocations) ? plan.allocations : [];
  const grossSalary = Number(plan.grossSalary) || 0;
  const extraIncome = Number(plan.extraIncome) || 0;
  const deductions = Number(plan.deductions) || 0;
  const calculatedNet = Math.max(0, grossSalary + extraIncome - deductions);
  const expectedNet = Number(plan.netSalary) > 0 ? Number(plan.netSalary) : calculatedNet;
  const expectedAllocationTotal = allocations.reduce((total, allocation) =>
    total + allocationValue(allocation, expectedNet), 0);
  const plannedUnallocated = expectedNet - expectedAllocationTotal;
  const setPlan = (next) => setSettings({ ...settings, financePlan: { ...plan, ...next } });
  const updateAllocation = (id, changes) => setPlan({
    allocations: allocations.map((allocation) => allocation.id === id ? { ...allocation, ...changes } : allocation),
  });
  const removeAllocation = (id) => setPlan({ allocations: allocations.filter((allocation) => allocation.id !== id) });
  const addAllocation = () => setPlan({
    allocations: [...allocations, {
      id: uid(), category: "", mode: "percent", amount: "", priority: "normal", protected: false,
    }],
  });

  const monthIncome = summary.receivedIncome;

  return (
    <div>
      <p className="cr-sub" style={{ margin: "14px 0" }}>
        Planeje sua renda e a distribuição do orçamento de {monthLabel(month)}. A renda prevista é apenas uma referência: dinheiro futuro só entra no cálculo de disponibilidade depois de ser registrado como recebido.
      </p>
      <div className="cr-grid cr-grid-3" style={{ marginBottom: 16 }}>
        <div className="cr-card">
          <p className="cr-label">Salário bruto mensal</p>
          <input type="number" min="0" step="0.01" className="cr-input" value={plan.grossSalary ?? ""}
            onChange={(event) => setPlan({ grossSalary: event.target.value })} aria-label="Salário bruto mensal" />
        </div>
        <div className="cr-card">
          <p className="cr-label">Renda extra prevista</p>
          <input type="number" min="0" step="0.01" className="cr-input" value={plan.extraIncome ?? ""}
            onChange={(event) => setPlan({ extraIncome: event.target.value })} aria-label="Renda extra prevista" />
        </div>
        <div className="cr-card">
          <p className="cr-label">Descontos e deduções</p>
          <input type="number" min="0" step="0.01" className="cr-input" value={plan.deductions ?? ""}
            onChange={(event) => setPlan({ deductions: event.target.value })} aria-label="Descontos e deduções" />
        </div>
        <div className="cr-card">
          <p className="cr-label">Salário líquido esperado (opcional)</p>
          <input type="number" min="0" step="0.01" className="cr-input" value={plan.netSalary ?? ""}
            onChange={(event) => setPlan({ netSalary: event.target.value })} aria-label="Salário líquido esperado" />
          <p className="cr-sub" style={{ margin: "6px 0 0" }}>Estimativa calculada: {fmtBRL(calculatedNet)}.</p>
        </div>
        <div className="cr-card">
          <p className="cr-label">Dia previsto para receber</p>
          <input type="number" min="1" max="31" step="1" className="cr-input" value={plan.payday ?? "5"}
            onChange={(event) => setPlan({ payday: event.target.value })} aria-label="Dia previsto para receber" />
        </div>
        <div className="cr-card">
          <p className="cr-label">Renda líquida prevista</p>
          <p className="cr-serif" style={{ fontSize: 20, margin: 0 }}>{fmtBRL(expectedNet)}</p>
          <p className="cr-sub" style={{ margin: "6px 0 0" }}>Recebido em {monthLabel(month)}: {fmtBRL(monthIncome)}</p>
        </div>
      </div>

      <div className="cr-card" style={{ marginBottom: 16 }}>
        <div className="cr-row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <div>
            <h2 className="cr-serif" style={{ fontSize: 18, margin: 0 }}>Distribuição do orçamento</h2>
            <p className="cr-sub" style={{ margin: "4px 0 0" }}>Defina limites por percentual ou valor. Valores protegidos representam reserva/objetivos e reduzem o dinheiro livre sem serem tratados como consumo. Classifique a transferência realizada e use a mesma categoria da alocação para evitar desconto duplicado.</p>
          </div>
          <button className="cr-btn primary" onClick={addAllocation}><Plus size={14} /> Adicionar categoria</button>
        </div>
        {allocations.length === 0 && <p className="cr-empty">Nenhuma distribuição configurada ainda.</p>}
        {allocations.map((allocation) => (
          <div className="cr-card" key={allocation.id} style={{ marginTop: 10, padding: 12 }}>
            <div className="cr-grid cr-grid-3">
              <div className="cr-field">
                <label className="cr-label">Categoria / objetivo</label>
                <input className="cr-input" value={allocation.category || ""}
                  onChange={(event) => updateAllocation(allocation.id, { category: event.target.value })}
                  placeholder="ex.: Moradia, Reserva de emergência" />
              </div>
              <div className="cr-field">
                <label className="cr-label">Tipo de limite</label>
                <select className="cr-select" value={allocation.mode || "percent"}
                  onChange={(event) => updateAllocation(allocation.id, { mode: event.target.value })}>
                  <option value="percent">Percentual da renda recebida</option>
                  <option value="fixed">Valor fixo mensal</option>
                </select>
              </div>
              <div className="cr-field">
                <label className="cr-label">{allocation.mode === "fixed" ? "Valor mensal (R$)" : "Percentual (%)"}</label>
                <input type="number" min="0" step="0.01" className="cr-input" value={allocation.amount ?? ""}
                  onChange={(event) => updateAllocation(allocation.id, { amount: event.target.value })} />
              </div>
              <div className="cr-field">
                <label className="cr-label">Prioridade</label>
                <select className="cr-select" value={allocation.priority || "normal"}
                  onChange={(event) => updateAllocation(allocation.id, { priority: event.target.value })}>
                  <option value="high">Prioritária</option>
                  <option value="normal">Normal</option>
                  <option value="low">Opcional</option>
                </select>
              </div>
              <label className="cr-row" style={{ alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={allocation.protected === true}
                  onChange={(event) => updateAllocation(allocation.id, { protected: event.target.checked })} />
                <span className="cr-label" style={{ margin: 0 }}>Valor protegido (reserva/investimento)</span>
              </label>
              <div className="cr-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <span className="cr-sub" style={{ margin: 0 }}>
                  Limite planejado: {fmtBRL(allocationValue(allocation, expectedNet))} · recebido: {fmtBRL(allocationValue(allocation, monthIncome))}
                </span>
                <button className="cr-btn ghost danger" onClick={() => removeAllocation(allocation.id)} aria-label="Remover categoria">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {allocations.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="cr-row" style={{ justifyContent: "space-between" }}>
              <span className="cr-sub" style={{ margin: 0 }}>Distribuído sobre o líquido esperado: {fmtBRL(expectedAllocationTotal)}</span>
              <strong role={plannedUnallocated < 0 ? "alert" : undefined} style={{ color: plannedUnallocated >= 0 ? "#5C7A56" : "#A1493C" }}>
                {plannedUnallocated < 0
                  ? `Plano excede o líquido esperado em ${fmtBRL(Math.abs(plannedUnallocated))}`
                  : `Líquido esperado sem distribuição: ${fmtBRL(plannedUnallocated)}`}
              </strong>
            </div>
            <div className="cr-row" style={{ justifyContent: "space-between", marginTop: 4 }}>
              <span className="cr-sub" style={{ margin: 0 }}>Distribuído com dinheiro já recebido: {fmtBRL(summary.allocationTotal)}</span>
              <span className="cr-sub" style={{ margin: 0 }}>Ainda não distribuído: {fmtBRL(summary.unallocated)}</span>
            </div>
          </div>
        )}
      </div>

      <div className="cr-card">
        <h2 className="cr-serif" style={{ fontSize: 18, margin: "0 0 8px" }}>Dinheiro do mês: recebido, comprometido e gasto</h2>
        <p className="cr-sub" style={{ margin: "0 0 12px" }}>
          Só lançamentos de entrada com status pago contam como renda recebida. Despesas pendentes são compromissos, não gastos realizados. Ao registrar uma despesa, marque-a como paga quando o pagamento acontecer para que os valores não sejam contados duas vezes.
        </p>
        <div className="cr-grid cr-grid-3">
          <div><p className="cr-label">Recebido</p><strong>{fmtBRL(summary.receivedIncome)}</strong></div>
          <div><p className="cr-label">Gasto</p><strong>{fmtBRL(summary.spent)}</strong></div>
          <div><p className="cr-label">Comprometido</p><strong>{fmtBRL(summary.commitments)}</strong></div>
          <div><p className="cr-label">Protegido para objetivos (ainda não transferido)</p><strong>{fmtBRL(summary.reservedRemaining)}</strong></div>
          <div><p className="cr-label">Transferido para reserva/investimento</p><strong>{fmtBRL(summary.transferPaid)}</strong></div>
          <div><p className="cr-label">Disponível sem comprometer metas</p>
            <strong style={{ color: summary.available >= 0 ? "#5C7A56" : "#A1493C" }}>{fmtBRL(summary.available)}</strong>
          </div>
          <div><p className="cr-label">Líquido esperado (não recebido)</p><strong>{fmtBRL(expectedNet)}</strong></div>
        </div>
        {summary.available < 0 && (
          <p role="alert" style={{ color: "#A1493C", marginBottom: 0 }}>
            Seus gastos, compromissos e reservas excedem em {fmtBRL(Math.abs(summary.available))} a renda recebida deste mês. Não conte com rendas futuras para cobrir esse saldo.
          </p>
        )}
      </div>
    </div>
  );
}

function FinanceRow({ f, onEdit, onRemove }) {
  const st = effectiveStatus(f);
  return (
    <div className="cr-list-row">
      <span className="cr-chip">{fmtDateShort(f.date)}</span>
      <span className="cr-list-title" style={{ flex: 1 }}>{f.desc || f.category}</span>
      <span className="cr-chip">{f.category}</span>
      {f.type === "saida" && <span className="cr-chip">{EXPENSE_CLASS_LABEL[f.expenseClass] || EXPENSE_CLASS_LABEL.variable}</span>}
      {f.type === "saida" && Number(f.plannedAmount) > 0 && Number(f.plannedAmount) !== Number(f.amount)
        && <span className="cr-chip">prev. {fmtBRL(f.plannedAmount)}</span>}
      {f.paymentMethod && <span className="cr-chip">{f.paymentMethod}</span>}
      {f.installmentGroup && <span className="cr-chip">{f.installmentGroup.index}/{f.installmentGroup.total}</span>}
      {f.recurringId && <span className="cr-chip">recorrente</span>}
      <span className="cr-chip" style={st === "atrasado" ? { background: "#F6DEDA", color: "#A1493C" } : st === "cancelado" ? { opacity: 0.6 } : undefined}>{STATUS_LABEL[st]}</span>
      <span style={{ color: f.type === "entrada" ? "#5C7A56" : "#A1493C", fontWeight: 600, fontSize: 13.5 }}>
        {f.type === "entrada" ? "+" : "-"}{fmtBRL(f.amount)}
      </span>
      <button className="cr-btn ghost" onClick={onEdit}><Pencil size={14} /></button>
      <button className="cr-btn ghost danger" onClick={onRemove}><Trash2 size={14} /></button>
    </div>
  );
}

function InvestmentsPanel({ investments, setInvestments, settings, setSettings }) {
  const [editing, setEditing] = useState(null);
  const [catModal, setCatModal] = useState(false);
  const categories = settings.investmentCategories || DEFAULT_INVESTMENT_CATEGORIES;
  const setCategories = (list) => setSettings({ ...settings, investmentCategories: list });
  const [confirmDel, setConfirmDel] = useState(null);

  const save = (data) => { setInvestments(upsertById(investments, data)); };
  const remove = (id) => setInvestments(investments.filter((x) => x.id !== id));
  const catName = (id) => (categories.find((c) => c.id === id) || {}).name || "Sem categoria";

  const active = investments.filter((i) => i.status !== "resgatado");
  const total = active.reduce((s, i) => s + Number(i.amount || 0), 0);
  const redeemed = investments.filter((i) => i.status === "resgatado").reduce((s, i) => s + Number(i.amount || 0), 0);

  const byCat = categories.map((c, idx) => ({
    id: c.id, label: c.name, color: CATEGORY_PALETTE[idx % CATEGORY_PALETTE.length],
    value: active.filter((i) => i.categoryId === c.id).reduce((s, i) => s + Number(i.amount || 0), 0),
  }));
  const noCat = active.filter((i) => !categories.some((c) => c.id === i.categoryId)).reduce((s, i) => s + Number(i.amount || 0), 0);
  if (noCat > 0) byCat.push({ id: "", label: "Sem categoria", value: noCat, color: "#B9B2A6" });
  const donutData = byCat.filter((c) => c.value > 0);

  const deleteCategory = (id) => {
    setInvestments(investments.map((i) => (i.categoryId === id ? { ...i, categoryId: "" } : i)));
    setCategories(categories.filter((c) => c.id !== id));
    setConfirmDel(null);
  };

  return (
    <div>
      <div className="cr-row" style={{ margin: "14px 0", justifyContent: "space-between", flexWrap: "wrap" }}>
        <div>
          <p className="cr-label" style={{ marginBottom: 2 }}>Total investido</p>
          <p className="cr-serif" style={{ fontSize: 30, margin: 0 }}>{fmtBRL(total)}</p>
          {redeemed > 0 && <p className="cr-sub" style={{ margin: "2px 0 0" }}>{fmtBRL(redeemed)} já resgatados</p>}
        </div>
        <div className="cr-row">
          <button className="cr-btn" onClick={() => setCatModal(true)}>Objetivos e categorias</button>
          <button className="cr-btn primary" onClick={() => setEditing("new")}><Plus size={14} /> Novo investimento</button>
        </div>
      </div>

      <div className="cr-grid cr-grid-2" style={{ marginBottom: 18 }}>
        <div className="cr-card">
          <h3 className="cr-serif" style={{ margin: "0 0 10px", fontSize: 15 }}>Para onde está indo o dinheiro</h3>
          {donutData.length === 0 ? <p className="cr-empty">Nenhum investimento cadastrado ainda.</p> : <DonutChart data={donutData} size={190} />}
        </div>
        <div className="cr-card">
          <h3 className="cr-serif" style={{ margin: "0 0 10px", fontSize: 15 }}>Por objetivo</h3>
          {byCat.map((c) => (
            <div key={c.id || "none"} style={{ marginBottom: 10 }}>
              <div className="cr-row" style={{ justifyContent: "space-between" }}>
                <span style={{ fontSize: 13.5 }}><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 3, background: c.color, marginRight: 7 }} />{c.label}</span>
                <strong style={{ fontSize: 13.5 }}>{fmtBRL(c.value)}</strong>
              </div>
              <div className="cr-progress-track" style={{ marginTop: 4 }}>
                <div className="cr-progress-fill" style={{ width: `${total ? (c.value / total) * 100 : 0}%`, background: c.color }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {categories.concat(noCat > 0 || investments.some((i) => !categories.some((c) => c.id === i.categoryId)) ? [{ id: "", name: "Sem categoria" }] : []).map((c) => {
        const items = investments.filter((i) => (c.id ? i.categoryId === c.id : !categories.some((x) => x.id === i.categoryId)))
          .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
        if (items.length === 0) return null;
        return (
          <div key={c.id || "none"} style={{ marginBottom: 14 }}>
            <SectionTitle title={c.name} count={`${items.length} ${items.length === 1 ? "investimento" : "investimentos"}`} />
            <div className="cr-card">
            {items.map((i) => (
              <div className="cr-list-row" key={i.id}>
                <div style={{ flex: 1 }}>
                  <div style={{ textDecoration: i.status === "resgatado" ? "line-through" : "none" }}>{i.name}</div>
                  <div className="cr-sub" style={{ margin: 0 }}>{[i.institution, i.date ? fmtDateShort(i.date) : "", i.notes].filter(Boolean).join(" · ")}</div>
                </div>
                {i.status === "resgatado" && <span className="cr-chip">resgatado</span>}
                <strong>{fmtBRL(i.amount)}</strong>
                <button className="cr-btn ghost" onClick={() => setEditing(i)}><Pencil size={14} /></button>
                <button className="cr-btn ghost danger" onClick={() => remove(i.id)}><Trash2 size={14} /></button>
              </div>
            ))}
            </div>
          </div>
        );
      })}

      {editing && <InvestmentModal item={editing === "new" ? null : editing} categories={categories} onSave={save} onClose={() => setEditing(null)} />}
      {catModal && (
        <Modal size="small" title="Objetivos e categorias de investimento" onClose={() => setCatModal(false)}>
          <p className="cr-sub" style={{ marginTop: 0 }}>↑ ↓ mover · nome editável · lixeira excluir · salvo automaticamente.</p>
          {categories.map((c) => (
            <div className="cr-row" key={c.id} style={{ marginBottom: 6, flexWrap: "nowrap" }}>
              <button className="cr-btn ghost" style={{ padding: "4px 6px" }} disabled={categories.indexOf(c) === 0} onClick={() => setCategories(moveItem(categories, categories.indexOf(c), -1))}>↑</button>
              <button className="cr-btn ghost" style={{ padding: "4px 6px" }} disabled={categories.indexOf(c) === categories.length - 1} onClick={() => setCategories(moveItem(categories, categories.indexOf(c), 1))}>↓</button>
              <input className="cr-input" value={c.name} onChange={(e) => setCategories(categories.map((x) => x.id === c.id ? { ...x, name: e.target.value } : x))} />
              <button className="cr-btn ghost danger" onClick={() => setConfirmDel(c)}><Trash2 size={13} /></button>
            </div>
          ))}
          <button className="cr-btn primary" onClick={() => setCategories([...categories, { id: uid(), name: "Novo objetivo" }])}><Plus size={13} /> Adicionar novo objetivo</button>
          <div className="cr-row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
            <button className="cr-btn primary" onClick={() => setCatModal(false)}>Concluir</button>
          </div>
        </Modal>
      )}
      {confirmDel && (
        <ConfirmModal title="Excluir objetivo" message={`Excluir "${confirmDel.name}"? Os investimentos dele continuam salvos, só ficam sem categoria.`}
          onConfirm={() => deleteCategory(confirmDel.id)} onCancel={() => setConfirmDel(null)} />
      )}
    </div>
  );
}

function InvestmentModal({ item, categories, onSave, onClose }) {
  const [form, setForm] = useState(item || { name: "", amount: "", categoryId: categories[0]?.id || "", date: todayStr(), institution: "", status: "ativo", notes: "" });
  const autoStatus = useAutoSave(form, onSave, (f) => ({ ...f, amount: Number(f.amount) || 0 }));
  return (
    <Modal title={item ? "Editar investimento" : "Novo investimento"} onClose={onClose}>
      <div className="cr-field"><label className="cr-label">Nome</label>
        <input className="cr-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ex: Tesouro Selic, CDB…" /></div>
      <div className="cr-row">
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Valor (R$)</label>
          <input type="number" className="cr-input" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Data</label>
          <input type="date" className="cr-input" value={form.date || ""} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
      </div>
      <div className="cr-field"><label className="cr-label">Objetivo / categoria</label>
        <select className="cr-select" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
          <option value="">Sem categoria</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></div>
      <div className="cr-row">
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Instituição ou local</label>
          <input className="cr-input" value={form.institution} onChange={(e) => setForm({ ...form, institution: e.target.value })} placeholder="ex: Nubank, corretora…" /></div>
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Status</label>
          <select className="cr-select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="ativo">ativo</option><option value="resgatado">resgatado</option>
          </select></div>
      </div>
      <div className="cr-field"><label className="cr-label">Observação</label>
        <textarea className="cr-textarea" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      <AutoSaveFooter status={autoStatus} onClose={onClose} />
    </Modal>
  );
}

function FinanceModal({ item, onSave, onGenerate, onDiscard, onClose, accounts, cards, paymentMethods, categories }) {
  const ctx = useContext(ListsContext);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [form, setForm] = useState(item || {
    type: "saida", category: categories[0] || "", expenseClass: "variable", amount: "", plannedAmount: "", date: todayStr(), desc: "",
    paymentMethod: "Pix", status: "pago", accountId: "", cardId: "", link: "",
    installmentsCount: 1, recurringEnabled: false, recurringMonths: 12,
  });
  const isEdit = !!item;
  const isCredit = form.paymentMethod === "Crédito";
  const draftId = useRef(uid());
  const needsGeneration = !isEdit && ((isCredit && Number(form.installmentsCount) > 1) || !!form.recurringEnabled);
  const autoStatus = useAutoSave(form, onSave, (f) => {
    const gen = !isEdit && ((f.paymentMethod === "Crédito" && Number(f.installmentsCount) > 1) || !!f.recurringEnabled);
    return gen ? null : { ...f, amount: Number(f.amount) || 0 };
  }, draftId.current, (f) => Number(f.amount) > 0 && !!f.date);
  const saveTransaction = async () => {
    if (!(Number(form.amount) > 0) || !form.date || saving) return;
    setSaving(true);
    setSaveError("");
    try {
      const saved = await onSave({ ...form, id: item?.id || draftId.current, amount: Number(form.amount) });
      if (saved === false) {
        setSaveError("Não foi possível confirmar o salvamento. Verifique a conexão e tente novamente.");
        return;
      }
      onClose();
    } catch (error) {
      console.error("Não foi possível salvar o lançamento financeiro.", error);
      setSaveError(error instanceof Error ? error.message : "Não foi possível salvar o lançamento. Tente novamente.");
    } finally {
      setSaving(false);
    }
  };
  useEffect(() => { if (needsGeneration && onDiscard) onDiscard(draftId.current); }, [needsGeneration]);

  return (
    <Modal title={item ? "Editar lançamento" : "Novo lançamento"} onClose={onClose}>
      <div className="cr-field"><label className="cr-label">Tipo</label>
        <select className="cr-select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
          <option value="entrada">entrada</option><option value="saida">saída</option>
        </select></div>
      <div className="cr-field"><label className="cr-label">Categoria</label>
        <div className="cr-row" style={{ flexWrap: "nowrap", gap: 6 }}>
          <input className="cr-input" list="finance-categories" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="ex: Alimentação, Salário…" />
          <button type="button" className="cr-btn ghost" style={{ padding: "6px 8px" }} title="Gerenciar categorias" onClick={() => ctx.openManager("financeCategories")}><SettingsIcon size={14} /></button>
        </div>
        <datalist id="finance-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      </div>
      {form.type === "saida" && (
        <div className="cr-field">
          <label className="cr-label">Classificação da despesa</label>
          <select className="cr-select" value={form.expenseClass || "variable"}
            onChange={(e) => setForm({ ...form, expenseClass: e.target.value })}>
            {Object.entries(EXPENSE_CLASS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
      )}
      <div className="cr-row">
        <div className="cr-field" style={{ flex: 1 }}>
          <label className="cr-label">{form.type === "saida" && form.status === "pago" ? "Valor real pago (R$)" : "Valor do lançamento / previsto (R$)"}</label>
          <input type="number" min="0.01" step="0.01" className="cr-input" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </div>
        <div className="cr-field" style={{ flex: 1 }}>
          <label className="cr-label">{form.type === "saida" && form.status !== "pago" ? "Vencimento previsto" : "Data do lançamento / pagamento"}</label>
          <input type="date" className="cr-input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
      </div>
      {form.type === "saida" && (
        <div className="cr-field">
          <label className="cr-label">Valor previsto original (R$), se diferente</label>
          <input type="number" min="0" step="0.01" className="cr-input" value={form.plannedAmount ?? ""}
            onChange={(e) => setForm({ ...form, plannedAmount: e.target.value })} placeholder="Opcional" />
        </div>
      )}
      <div className="cr-field"><label className="cr-label">Descrição</label>
        <input className="cr-input" value={form.desc} onChange={(e) => setForm({ ...form, desc: e.target.value })} /></div>

      <div className="cr-row">
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Forma de pagamento</label>
          <div className="cr-row" style={{ flexWrap: "nowrap", gap: 6 }}>
            <select className="cr-select" value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value, cardId: e.target.value === "Crédito" ? form.cardId : "" })}>
              {paymentMethods.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <button type="button" className="cr-btn ghost" style={{ padding: "6px 8px" }} title="Gerenciar formas de pagamento" onClick={() => ctx.openManager("paymentMethods")}><SettingsIcon size={14} /></button>
          </div></div>
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Status</label>
          <ManagedSelect listKey="financeStatus" value={form.status} onChange={(v) => setForm({
            ...form,
            status: v,
            plannedAmount: form.type === "saida" && v === "pago" && !form.plannedAmount ? form.amount : form.plannedAmount,
          })} /></div>
      </div>

      {isCredit && (
        <div className="cr-field"><label className="cr-label">Cartão</label>
          <select className="cr-select" value={form.cardId} onChange={(e) => setForm({ ...form, cardId: e.target.value })}>
            <option value="">Selecione…</option>
            {cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></div>
      )}
      {!isCredit && accounts.length > 0 && (
        <div className="cr-field"><label className="cr-label">Conta</label>
          <select className="cr-select" value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
            <option value="">Selecione…</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select></div>
      )}

      {!isEdit && isCredit && (
        <div className="cr-field"><label className="cr-label">Parcelamento</label>
          <select className="cr-select" value={form.installmentsCount} onChange={(e) => setForm({ ...form, installmentsCount: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 18, 24].map((n) => <option key={n} value={n}>{n === 1 ? "à vista / 1x" : `${n}x`}</option>)}
          </select>
          {form.installmentsCount > 1 && form.amount && (
            <p className="cr-sub" style={{ marginTop: 4 }}>{form.installmentsCount}x de {fmtBRL((Number(form.amount) || 0) / form.installmentsCount)}</p>
          )}
        </div>
      )}

      {!isEdit && (
        <div className="cr-field">
          <label className="cr-row" style={{ cursor: "pointer" }}>
            <div className={`cr-checkbox ${form.recurringEnabled ? "checked" : ""}`} onClick={() => setForm({ ...form, recurringEnabled: !form.recurringEnabled })}>
              {form.recurringEnabled && <Check size={13} />}
            </div>
            <span className="cr-label" style={{ margin: 0 }}>Lançamento recorrente (repete todo mês)</span>
          </label>
          {form.recurringEnabled && (
            <div className="cr-field" style={{ marginTop: 8 }}>
              <label className="cr-label">Gerar quantos meses à frente</label>
              <input type="number" className="cr-input" value={form.recurringMonths} onChange={(e) => setForm({ ...form, recurringMonths: e.target.value })} />
            </div>
          )}
        </div>
      )}

      <div className="cr-field"><label className="cr-label">Link (nota fiscal, comprovante, produto…)</label>
        <input className="cr-input" value={form.link || ""} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="https://…" /></div>

      {needsGeneration ? (
        <div style={{ marginTop: 14 }}>
          <p className="cr-sub" style={{ marginTop: 0 }}>
            {form.recurringEnabled ? "Este lançamento vai se repetir por vários meses." : `Esta compra será dividida em ${form.installmentsCount} parcelas.`} Confirme para criar todos os lançamentos de uma vez.
          </p>
          <button className="cr-btn primary" style={{ width: "100%", justifyContent: "center" }}
            onClick={() => onGenerate({ ...form, id: draftId.current, amount: Number(form.amount) || 0 })}>
            {form.recurringEnabled ? "Criar lançamentos recorrentes" : "Criar parcelas"}
          </button>
        </div>
      ) : (
        <div className="cr-row" style={{ justifyContent: "space-between", marginTop: 14, alignItems: "center" }}>
          <span className="cr-sub" style={{ margin: 0, fontSize: 12 }}>
            {saveError || (saving ? "Salvando lançamento…" : autoStatus === "salvando" ? "Salvando…" : autoStatus === "salvo" ? "✓ Salvo automaticamente" : "Informe um valor maior que zero para salvar.")}
          </span>
          <button type="button" className="cr-btn primary" onClick={saveTransaction}
            disabled={saving || !(Number(form.amount) > 0) || !form.date}>Salvar lançamento</button>
        </div>
      )}
    </Modal>
  );
}

function MiniBarChartFinance({ data, height = 280 }) {
  const [hover, setHover] = useState(null); // { i, series, value }
  const max = Math.max(1, ...data.flatMap((d) => [d.entrada, d.saida]));
  return (
    <div>
      <div className="cr-row" style={{ gap: 18, marginBottom: 10 }}>
        <span className="cr-row" style={{ gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: "#97A587", display: "inline-block" }} />
          <span className="cr-sub" style={{ margin: 0 }}>Entradas</span>
        </span>
        <span className="cr-row" style={{ gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: "#D9A79A", display: "inline-block" }} />
          <span className="cr-sub" style={{ margin: 0 }}>Saídas</span>
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", height, gap: 10, padding: "8px 4px 0", position: "relative" }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "flex-end" }}>
            <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: "85%", width: "100%", justifyContent: "center" }}>
              {[["entrada", d.entrada, "#97A587"], ["saida", d.saida, "#D9A79A"]].map(([key, val, color]) => (
                <div key={key} style={{ position: "relative", width: 26, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}
                  onMouseEnter={() => setHover({ i, key, val })} onMouseLeave={() => setHover(null)}
                  onClick={() => setHover(hover && hover.i === i && hover.key === key ? null : { i, key, val })}>
                  {hover && hover.i === i && hover.key === key && (
                    <div className="cr-serif" style={{
                      position: "absolute", bottom: `${Math.max(4, (val / max) * 100)}%`, marginBottom: 6,
                      background: "var(--ink)", color: "#fff", fontSize: 11, padding: "3px 8px", borderRadius: 6, whiteSpace: "nowrap", zIndex: 2,
                    }}>{fmtBRL(val)}</div>
                  )}
                  <div style={{ width: "100%", height: `${Math.max(2, (val / max) * 100)}%`, background: color, borderRadius: "5px 5px 0 0", cursor: "pointer" }} />
                </div>
              ))}
            </div>
            <span className="cr-sub" style={{ margin: "6px 0 0", fontSize: 11.5 }}>{d.month}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AccountsCardsPanel({ accounts, setAccounts, cards, setCards, settings, setSettings }) {
  const [editingAccount, setEditingAccount] = useState(null);
  const [editingCard, setEditingCard] = useState(null);
  const [newMethod, setNewMethod] = useState("");
  const methods = settings.paymentMethods || DEFAULT_SETTINGS.paymentMethods;

  const saveAccount = (data) => { setAccounts(upsertById(accounts, data)); };
  const saveCard = (data) => { setCards(upsertById(cards, data)); };

  const addMethod = () => {
    if (!newMethod.trim()) return;
    setSettings({ ...settings, paymentMethods: [...methods, newMethod.trim()] });
    setNewMethod("");
  };
  const removeMethod = (m) => setSettings({ ...settings, paymentMethods: methods.filter((x) => x !== m) });

  return (
    <div style={{ marginTop: 14 }}>
      <div className="cr-card" style={{ marginBottom: 16 }}>
        <div className="cr-row" style={{ justifyContent: "space-between" }}>
          <h3 className="cr-serif" style={{ margin: 0, fontSize: 16 }}>Contas</h3>
          <button className="cr-btn" onClick={() => setEditingAccount("new")}><Plus size={13} /> Nova conta</button>
        </div>
        {accounts.length === 0 && <p className="cr-empty">Nenhuma conta cadastrada.</p>}
        {accounts.map((a) => (
          <div className="cr-list-row" key={a.id}>
            <span className="cr-list-title" style={{ flex: 1 }}>{a.name}</span>
            <span className="cr-chip">{a.type}</span>
            <button className="cr-btn ghost" onClick={() => setEditingAccount(a)}><Pencil size={13} /></button>
            <button className="cr-btn ghost danger" onClick={() => setAccounts(accounts.filter((x) => x.id !== a.id))}><Trash2 size={13} /></button>
          </div>
        ))}
      </div>

      <div className="cr-card" style={{ marginBottom: 16 }}>
        <div className="cr-row" style={{ justifyContent: "space-between" }}>
          <h3 className="cr-serif" style={{ margin: 0, fontSize: 16 }}>Cartões</h3>
          <button className="cr-btn" onClick={() => setEditingCard("new")}><Plus size={13} /> Novo cartão</button>
        </div>
        {cards.length === 0 && <p className="cr-empty">Nenhum cartão cadastrado.</p>}
        {cards.map((c) => (
          <div className="cr-list-row" key={c.id}>
            <span className="cr-list-title" style={{ flex: 1 }}>{c.name}</span>
            <span className="cr-chip">limite {fmtBRL(c.limit)}</span>
            <span className="cr-chip">fecha dia {c.closingDay}</span>
            <span className="cr-chip">vence dia {c.dueDay}</span>
            <button className="cr-btn ghost" onClick={() => setEditingCard(c)}><Pencil size={13} /></button>
            <button className="cr-btn ghost danger" onClick={() => setCards(cards.filter((x) => x.id !== c.id))}><Trash2 size={13} /></button>
          </div>
        ))}
      </div>

      <div className="cr-card">
        <h3 className="cr-serif" style={{ marginTop: 0, fontSize: 16 }}>Formas de pagamento</h3>
        <div className="cr-row" style={{ flexWrap: "wrap", marginBottom: 10 }}>
          {methods.map((m) => (
            <span key={m} className="cr-chip">{m}
              <button className="cr-btn ghost" style={{ padding: 2 }} onClick={() => removeMethod(m)}><Trash2 size={11} /></button>
            </span>
          ))}
        </div>
        <div className="cr-row">
          <input className="cr-input" style={{ maxWidth: 200 }} placeholder="Nova forma de pagamento" value={newMethod} onChange={(e) => setNewMethod(e.target.value)} />
          <button className="cr-btn" onClick={addMethod}><Plus size={13} /></button>
        </div>
      </div>

      {editingAccount && <AccountModal item={editingAccount === "new" ? null : editingAccount} onSave={saveAccount} onClose={() => setEditingAccount(null)} />}
      {editingCard && <CardModal item={editingCard === "new" ? null : editingCard} onSave={saveCard} onClose={() => setEditingCard(null)} />}
    </div>
  );
}

function AccountModal({ item, onSave, onClose }) {
  const [form, setForm] = useState(item || { name: "", type: "conta bancária" });
  const autoStatus = useAutoSave(form, onSave, undefined);
  return (
    <Modal title={item ? "Editar conta" : "Nova conta"} onClose={onClose}>
      <div className="cr-field"><label className="cr-label">Nome</label>
        <input className="cr-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
      <div className="cr-field"><label className="cr-label">Tipo</label>
        <ManagedSelect listKey="accountType" value={form.type} onChange={(v) => setForm({ ...form, type: v })} /></div>
      <AutoSaveFooter status={autoStatus} onClose={onClose} />
    </Modal>
  );
}

function CardModal({ item, onSave, onClose }) {
  const [form, setForm] = useState(item || { name: "", limit: "", closingDay: "", dueDay: "", bank: "" });
  const autoStatus = useAutoSave(form, onSave, (form) => ({ ...form, limit: Number(form.limit) || 0 }));
  return (
    <Modal title={item ? "Editar cartão" : "Novo cartão"} onClose={onClose}>
      <div className="cr-field"><label className="cr-label">Nome do cartão</label>
        <input className="cr-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
      <div className="cr-field"><label className="cr-label">Banco / instituição</label>
        <input className="cr-input" value={form.bank} onChange={(e) => setForm({ ...form, bank: e.target.value })} /></div>
      <div className="cr-row">
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Limite (R$)</label>
          <input type="number" className="cr-input" value={form.limit} onChange={(e) => setForm({ ...form, limit: e.target.value })} /></div>
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Dia de fechamento</label>
          <input type="number" className="cr-input" value={form.closingDay} onChange={(e) => setForm({ ...form, closingDay: e.target.value })} /></div>
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Dia de vencimento</label>
          <input type="number" className="cr-input" value={form.dueDay} onChange={(e) => setForm({ ...form, dueDay: e.target.value })} /></div>
      </div>
      <AutoSaveFooter status={autoStatus} onClose={onClose} />
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/* NOTES                                                                   */
/* ---------------------------------------------------------------------- */

function NotesView({ notes, setNotes, areas }) {
  const [editing, setEditing] = useState(null);
  const [query, setQuery] = useState("");
  const save = (data) => { setNotes(upsertById(notes, data, { createdAt: todayStr() })); };
  const remove = (id) => setNotes(notes.filter((x) => x.id !== id));
  const filtered = notes.filter((n) => !query || n.title.toLowerCase().includes(query.toLowerCase()) || n.content.toLowerCase().includes(query.toLowerCase()));

  return (
    <div>
      <div className="cr-row" style={{ justifyContent: "space-between" }}>
        <div><h1 className="cr-h1 cr-serif">Notas</h1><p className="cr-sub">Seu segundo cérebro pessoal.</p></div>
        <button className="cr-btn primary" onClick={() => setEditing("new")}><Plus size={14} /> Nova nota</button>
      </div>
      <input className="cr-input" style={{ maxWidth: 260, margin: "14px 0" }} placeholder="Buscar notas…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="cr-grid cr-grid-3">
        {filtered.length === 0 && <p className="cr-empty">Nenhuma nota encontrada.</p>}
        {filtered.map((n) => (
          <div className="cr-card" key={n.id}>
            <div className="cr-row" style={{ justifyContent: "space-between" }}>
              <h3 style={{ margin: 0, fontSize: 15 }} className="cr-serif">{n.title}</h3>
              <div className="cr-row" style={{ gap: 2 }}>
                <button className="cr-btn ghost" onClick={() => setEditing(n)}><Pencil size={13} /></button>
                <button className="cr-btn ghost danger" onClick={() => remove(n.id)}><Trash2 size={13} /></button>
              </div>
            </div>
            <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "8px 0" }}>{n.content}</p>
            <div className="cr-row" style={{ justifyContent: "space-between" }}>
              <AreaBadge area={n.area} areas={areas} />
              {n.link && <button className="cr-btn ghost" style={{ padding: "4px 8px" }} onClick={() => openExternalLink(n.link)}><Link2 size={12} /> Abrir link</button>}
            </div>
          </div>
        ))}
      </div>
      {editing && <NoteModal note={editing === "new" ? null : editing} areas={areas} onSave={save} onClose={() => setEditing(null)} />}
    </div>
  );
}

function NoteModal({ note, areas, onSave, onClose }) {
  const [form, setForm] = useState(note || { title: "", content: "", area: areas[0]?.id, link: "" });
  const autoStatus = useAutoSave(form, onSave, undefined);
  return (
    <Modal title={note ? "Editar nota" : "Nova nota"} onClose={onClose}>
      <div className="cr-field"><label className="cr-label">Título</label>
        <input className="cr-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
      <div className="cr-field"><label className="cr-label">Conteúdo</label>
        <textarea className="cr-textarea" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} /></div>
      <div className="cr-field"><label className="cr-label">Área</label>
        <AreaSelect value={form.area} onChange={(v) => setForm({ ...form, area: v })} areas={areas} /></div>
      <div className="cr-field"><label className="cr-label">Link de referência (opcional)</label>
        <input className="cr-input" value={form.link || ""} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="https://…" /></div>
      <AutoSaveFooter status={autoStatus} onClose={onClose} />
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/* MY APPS                                                                 */
/* ---------------------------------------------------------------------- */

function iconForApp(name) {
  const n = (name || "").toLowerCase();
  if (n.includes("calendar") || n.includes("agenda")) return CalendarDays;
  if (n.includes("drive")) return HardDrive;
  if (n.includes("gmail") || n.includes("mail")) return Mail;
  if (n.includes("notion")) return FileText;
  if (n.includes("skoob") || n.includes("livro")) return BookOpen;
  if (n.includes("pinterest")) return ImageIcon;
  if (n.includes("amazon")) return ShoppingBag;
  if (n.includes("shopee") || n.includes("shein")) return ShoppingCart;
  if (n.includes("cupla")) return Heart;
  if (n.includes("chatgpt") || n.includes("gemini") || n.includes("claude")) return Bot;
  if (n.includes("canva")) return Palette;
  if (n.includes("tarefas") || n.includes("tasks")) return ListChecks;
  return Link2;
}

function AppsView({ apps, setApps }) {
  const [editing, setEditing] = useState(null);
  const save = (data) => { setApps(upsertById(apps, data)); };
  const remove = (id) => setApps(apps.filter((x) => x.id !== id));

  return (
    <div>
      <div className="cr-row" style={{ justifyContent: "space-between" }}>
        <div><h1 className="cr-h1 cr-serif">Meus Apps</h1><p className="cr-sub">Atalhos para o que você mais usa.</p></div>
        <button className="cr-btn primary" onClick={() => setEditing("new")}><Plus size={14} /> Novo atalho</button>
      </div>
      <div className="cr-grid cr-grid-4" style={{ marginTop: 16 }}>
        {apps.map((a) => {
          const AppIcon = iconForApp(a.name);
          return (
          <div className="cr-card" key={a.id} style={{ textAlign: "center" }}>
            <button style={{
              textDecoration: "none", color: "inherit", border: "none", background: "none",
              padding: 0, cursor: "pointer", width: "100%", font: "inherit",
            }} onClick={() => openExternalLink(a.url)}>
              <div style={{
                width: 44, height: 44, borderRadius: "50%", background: "#F1E4DE",
                display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto",
              }}>
                <AppIcon size={20} style={{ color: "var(--clay)" }} />
              </div>
              <div style={{ fontSize: 13.5, marginTop: 8 }}>{a.name}</div>
            </button>
            <div className="cr-row" style={{ justifyContent: "center", marginTop: 8 }}>
              <button className="cr-btn ghost" onClick={() => setEditing(a)}><Pencil size={13} /></button>
              <button className="cr-btn ghost danger" onClick={() => remove(a.id)}><Trash2 size={13} /></button>
            </div>
          </div>
          );
        })}
      </div>
      {editing && <AppModal app={editing === "new" ? null : editing} onSave={save} onClose={() => setEditing(null)} />}
    </div>
  );
}

function AppModal({ app, onSave, onClose }) {
  const [form, setForm] = useState(app || { name: "", url: "" });
  const autoStatus = useAutoSave(form, onSave, undefined);
  return (
    <Modal title={app ? "Editar atalho" : "Novo atalho"} onClose={onClose}>
      <div className="cr-field"><label className="cr-label">Nome</label>
        <input className="cr-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
      <div className="cr-field"><label className="cr-label">Link</label>
        <input className="cr-input" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…" /></div>
      <AutoSaveFooter status={autoStatus} onClose={onClose} />
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/* SETTINGS                                                                */
/* ---------------------------------------------------------------------- */

function SettingsView({ areas, setAreas, settings, setSettings, allData, deletedPages, pageOf, onRestorePage, restoreBackup, onRefresh, refreshing }) {
  const ctx = useContext(ListsContext);
  const [editingArea, setEditingArea] = useState(null);

  const saveArea = (data) => { setAreas(areas.some((x) => x.id === data.id) ? areas.map((x) => x.id === data.id ? { ...x, ...data } : x) : [...areas, data]); };
  const removeArea = (id) => setAreas(areas.filter((x) => x.id !== id));

  const [showBackupText, setShowBackupText] = useState(false);
  const backupJson = JSON.stringify(allData, null, 2);

  const exportData = async () => {
    try {
      const blob = new Blob([backupJson], { type: "application/json" });
      const result = await shareOrDownloadFile(blob, "central-de-comando-backup.json", "Backup da Central");
      if (result === "shared") notify("Backup compartilhado.");
    } catch (e) {
      notify("Não foi possível exportar o backup. Tente novamente.");
      setShowBackupText(true);
    }
  };

  const importData = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        await restoreBackup(parsed);
        notify("Backup importado e salvo no Supabase.");
      } catch (err) {
        notify(err instanceof Error ? `Não foi possível importar o backup: ${err.message}` : "Não foi possível importar o backup.");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div>
      <h1 className="cr-h1 cr-serif">Configurações</h1>
      <p className="cr-sub">Personalize áreas da vida, textos do dashboard e seus dados.</p>

      <div className="cr-card" style={{ marginBottom: 16 }}>
        <h3 className="cr-serif" style={{ marginTop: 0, fontSize: 16 }}>Listas, categorias e status</h3>
        <p className="cr-sub" style={{ marginTop: 0 }}>Aqui ficam todas as opções que você pode personalizar. Em cada tela também há um botão "Gerenciar" ao lado do campo. Em cada lista dá para adicionar, renomear, excluir e reordenar.</p>
        {[...Object.keys(LIST_REGISTRY).map((key) => ({ key, label: LIST_REGISTRY[key].label, open: () => ctx.openManager(key) })),
          { key: "areas", label: "Áreas da vida", open: () => ctx.openAreas() },
          { key: "prices", label: "Faixas de preço dos procedimentos", open: () => ctx.openPrices() }].map((row) => (
          <div className="cr-list-row" key={row.key}>
            <span className="cr-list-title" style={{ flex: 1 }}>{row.label}</span>
            <button className="cr-btn" onClick={row.open}><SettingsIcon size={13} /> Gerenciar</button>
          </div>
        ))}
        <p className="cr-sub" style={{ marginBottom: 0 }}>Objetivos de investimento ficam em Finanças → Investimentos → "Objetivos e categorias". Os lugares, em Procedimentos → Lugares e profissionais.</p>
      </div>

      <div className="cr-card" style={{ marginBottom: 16 }}>
        <h3 className="cr-serif" style={{ marginTop: 0, fontSize: 16 }}>Páginas excluídas</h3>
        {(deletedPages || []).length === 0 && <p className="cr-sub" style={{ margin: 0 }}>Nenhuma página excluída. Para excluir uma, use "Editar" no menu lateral.</p>}
        {(deletedPages || []).map((id) => (
          <div className="cr-list-row" key={id}>
            <span className="cr-list-title" style={{ flex: 1 }}>{pageOf(id)}</span>
            <button className="cr-btn" onClick={() => onRestorePage(id)}>Restaurar página</button>
          </div>
        ))}
      </div>

      <div className="cr-card" style={{ marginBottom: 16 }}>
        <h3 className="cr-serif" style={{ marginTop: 0, fontSize: 16 }}>Textos do dashboard</h3>
        <div className="cr-field"><label className="cr-label">Seu nome (opcional)</label>
          <input className="cr-input" value={settings.name} onChange={(e) => setSettings({ ...settings, name: e.target.value })} /></div>
        <div className="cr-field"><label className="cr-label">Frase motivacional</label>
          <input className="cr-input" value={settings.quote} onChange={(e) => setSettings({ ...settings, quote: e.target.value })} /></div>
      </div>

      <div className="cr-card" style={{ marginBottom: 16 }}>
        <h3 className="cr-serif" style={{ marginTop: 0, fontSize: 16 }}>Tema</h3>
        <p className="cr-sub">Ajuste as cores de destaque do sistema.</p>
        <div className="cr-row">
          {["clay", "rose", "sage"].map((k) => (
            <div key={k} style={{ textAlign: "center" }}>
              <input type="color" value={settings.theme?.[k] || DEFAULT_SETTINGS.theme[k]}
                onChange={(e) => setSettings({ ...settings, theme: { ...settings.theme, [k]: e.target.value } })}
                style={{ width: 44, height: 34, border: "1px solid var(--line)", borderRadius: 8, padding: 2 }} />
              <div className="cr-sub" style={{ marginTop: 2 }}>{k}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="cr-card" style={{ marginBottom: 16 }}>
        <h3 className="cr-serif" style={{ marginTop: 0, fontSize: 16 }}>Widgets do dashboard</h3>
        <p className="cr-sub">Escolha o que aparece na tela inicial e em que ordem.</p>
        {(settings.dashboardWidgets || DEFAULT_WIDGETS).map((w, i) => {
          const list = settings.dashboardWidgets || DEFAULT_WIDGETS;
          const move = (dir) => {
            const idx = list.findIndex((x) => x.id === w.id);
            const to = idx + dir;
            if (to < 0 || to >= list.length) return;
            const copy = [...list];
            [copy[idx], copy[to]] = [copy[to], copy[idx]];
            setSettings({ ...settings, dashboardWidgets: copy });
          };
          const toggle = () => setSettings({ ...settings, dashboardWidgets: list.map((x) => x.id === w.id ? { ...x, visible: !x.visible } : x) });
          return (
            <div className="cr-list-row" key={w.id}>
              <div className={`cr-checkbox ${w.visible ? "checked" : ""}`} onClick={toggle}>{w.visible && <Check size={13} />}</div>
              <span className="cr-list-title" style={{ flex: 1 }}>{w.label}</span>
              <button className="cr-btn ghost" disabled={i === 0} onClick={() => move(-1)}>↑</button>
              <button className="cr-btn ghost" disabled={i === list.length - 1} onClick={() => move(1)}>↓</button>
            </div>
          );
        })}
      </div>

      <div className="cr-card" style={{ marginBottom: 16 }}>
        <div className="cr-row" style={{ justifyContent: "space-between" }}>
          <h3 className="cr-serif" style={{ margin: 0, fontSize: 16 }}>Áreas da vida</h3>
          <button className="cr-btn" onClick={() => setEditingArea("new")}><Plus size={14} /> Nova área</button>
        </div>
        <div className="cr-row" style={{ flexWrap: "wrap", marginTop: 12 }}>
          {areas.map((a) => (
            <div key={a.id} className="cr-chip" style={{ padding: "6px 10px", fontSize: 13 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: a.color || "#B0A594", display: "inline-block", marginRight: 5 }} />
              {a.name}
              <button className="cr-btn ghost" style={{ padding: 2 }} onClick={() => setEditingArea(a)}><Pencil size={12} /></button>
              <button className="cr-btn ghost danger" style={{ padding: 2 }} onClick={() => removeArea(a.id)}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      </div>

      <div className="cr-card" style={{ marginBottom: 16 }}>
        <h3 className="cr-serif" style={{ marginTop: 0, fontSize: 16 }}>Sincronização entre aparelhos</h3>
        <p className="cr-sub">
          Seus dados são salvos na sua conta do Supabase e ficam disponíveis nos aparelhos em que você entrar com o mesmo Google.
          A atualização não é ao vivo: antes de continuar em outro aparelho, use "Atualizar dados agora". Se editar a mesma informação
          simultaneamente em dois aparelhos, a última gravação prevalece.
        </p>
        <button className="cr-btn" onClick={onRefresh} disabled={refreshing}>
          <Download size={14} /> {refreshing ? "Atualizando…" : "Atualizar dados agora"}
        </button>
      </div>

      <div className="cr-card">
        <h3 className="cr-serif" style={{ marginTop: 0, fontSize: 16 }}>Backup e portabilidade</h3>
        <p className="cr-sub">Seus dados são seus — exporte tudo em JSON quando quiser, ou importe um backup.</p>
        <div className="cr-row">
          <button className="cr-btn" onClick={exportData}><Download size={14} /> Exportar backup</button>
          <label className="cr-btn" style={{ cursor: "pointer" }}>
            <Upload size={14} /> Importar backup
            <input type="file" accept="application/json" style={{ display: "none" }} onChange={importData} />
          </label>
          <button className="cr-btn ghost" onClick={() => setShowBackupText(true)}>Ver como texto (se o download não abrir)</button>
        </div>
      </div>

      {showBackupText && (
        <Modal title="Seu backup em texto" onClose={() => setShowBackupText(false)}>
          <p className="cr-sub" style={{ marginBottom: 10 }}>
            Se o botão de exportar não baixou o arquivo, selecione todo o texto abaixo (ou use o botão) e cole num arquivo .json no seu computador.
          </p>
          <button className="cr-btn primary" style={{ marginBottom: 10 }} onClick={() => {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(backupJson).then(() => notify("Backup copiado.")).catch(() => notify("Não consegui copiar automaticamente; selecione o texto manualmente."));
            } else {
              notify("Selecione o texto abaixo manualmente e copie.");
            }
          }}>Copiar tudo</button>
          <textarea readOnly value={backupJson} className="cr-textarea" style={{ minHeight: 260, fontSize: 11, fontFamily: "monospace" }} onFocus={(e) => e.target.select()} />
        </Modal>
      )}

      {editingArea && <AreaModal area={editingArea === "new" ? null : editingArea} onSave={saveArea} onClose={() => setEditingArea(null)} />}
    </div>
  );
}

function AreaModal({ area, onSave, onClose }) {
  const [form, setForm] = useState(area || { name: "", color: "#C9A57E" });
  const autoStatus = useAutoSave(form, onSave, undefined);
  return (
    <Modal title={area ? "Editar área" : "Nova área da vida"} onClose={onClose}>
      <div className="cr-field"><label className="cr-label">Nome</label>
        <input className="cr-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
      <div className="cr-field"><label className="cr-label">Cor</label>
        <input type="color" className="cr-input" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} style={{ padding: 2, height: 36, maxWidth: 100 }} /></div>
      <AutoSaveFooter status={autoStatus} onClose={onClose} />
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/* ESTUDOS                                                                 */
/* ---------------------------------------------------------------------- */

// Cada item antigo de Estudos que era só um assunto (ex: "CRM") vira uma ÁREA;
// itens com link, progresso ou horas viram CURSOS dentro de uma área.
function migrateStudyToAreas(study, studyAreas) {
  let areas = [...studyAreas];
  const courses = [];
  let changed = false;
  const areaByName = (name) => {
    const key = (name || "").trim().toLowerCase();
    let a = areas.find((x) => (x.name || "").trim().toLowerCase() === key);
    if (!a) { a = { id: uid(), name: (name || "").trim(), description: "", image: "" }; areas = [...areas, a]; }
    return a;
  };
  study.forEach((s) => {
    if (s.areaId) { courses.push(s); return; }
    changed = true;
    const bare = !s.link && !(s.links && s.links.length) && !Number(s.progress) && !Number(s.hours) && !s.done && s.status !== "concluido" && !s.notes;
    if (bare) {
      const a = areaByName(s.title || "Sem nome");
      if (s.deadline && !a.description) a.description = "Prazo: " + fmtDateShort(s.deadline);
    } else {
      const a = areaByName(s.subject || "Sem área");
      courses.push({ ...s, areaId: a.id, status: s.status || (s.done ? "concluido" : Number(s.progress) > 0 ? "estudando" : "para estudar") });
    }
  });
  return { study: changed ? courses : study, areas: changed ? areas : studyAreas, changed };
}

// Todos os links de um curso (os novos + o link antigo, se existir)
function studyLinks(s) {
  const list = (s.links || []).filter((l) => l && l.url);
  if (s.link && !list.some((l) => l.url === s.link)) list.unshift({ id: "legacy", label: "Abrir link", url: s.link });
  return list;
}

function linkLabel(l) {
  if (l.label) return l.label;
  try { return new URL(l.url).hostname.replace("www.", ""); } catch (e) { return "Abrir link"; }
}

function courseStatusId(c) {
  if (c.status) return c.status;
  if (c.done) return "concluido";
  return Number(c.progress) > 0 ? "estudando" : "para estudar";
}

function StudyView({ study, setStudy, studyAreas, setStudyAreas }) {
  const ctx = useContext(ListsContext);
  const [editingCourse, setEditingCourse] = useState(null); // { item, areaId }
  const [editingArea, setEditingArea] = useState(null);
  const [confirmArea, setConfirmArea] = useState(null);
  const [fStatus, setFStatus] = useState("todos");
  const [query, setQuery] = useState("");
  const [openAreas, setOpenAreas] = useState({});

  const saveCourse = (data) => { setStudy(upsertById(study, data)); };
  const removeCourse = (id) => setStudy(study.filter((x) => x.id !== id));
  const saveArea = (data) => { setStudyAreas(upsertById(studyAreas, data)); };
  const deleteArea = (id) => { setStudy(study.filter((c) => c.areaId !== id)); setStudyAreas(studyAreas.filter((a) => a.id !== id)); setConfirmArea(null); };

  const statusList = getList("courseStatus");
  const counts = (id) => study.filter((c) => courseStatusId(c) === id).length;
  const matches = (c) => (fStatus === "todos" || courseStatusId(c) === fStatus)
    && (!query || (c.title + " " + (c.description || "")).toLowerCase().includes(query.toLowerCase()));
  const totalCourses = study.length;

  return (
    <div>
      <div className="cr-row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1 className="cr-h1 cr-serif">Estudos</h1>
          <p className="cr-sub">{studyAreas.length} áreas e {totalCourses} cursos. Cada área reúne vários cursos.</p>
        </div>
        <button className="cr-btn primary" onClick={() => setEditingArea("new")}><Plus size={14} /> Nova área</button>
      </div>

      <div className="cr-row" style={{ margin: "14px 0 0", flexWrap: "wrap" }}>
        <input className="cr-input" style={{ maxWidth: 260 }} placeholder="Buscar curso…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <FilterGroups groups={[{
        key: "status", label: "Status", value: fStatus, onChange: setFStatus, onManage: () => ctx.openManager("courseStatus"),
        options: statusList.map((s) => ({ value: s.id, label: s.name, count: counts(s.id) })),
      }]} />

      {studyAreas.length === 0 && <p className="cr-empty">Nenhuma área ainda. Clique em "Nova área" para criar a primeira (ex: CRM, Marketing, Dados).</p>}

      {studyAreas.map((area, areaIdx) => {
        const all = study.filter((c) => c.areaId === area.id);
        const shown = all.filter(matches);
        const hasFilter = fStatus !== "todos" || query;
        if (hasFilter && shown.length === 0) return null;
        const avg = all.length ? Math.round(all.reduce((s, c) => s + (courseStatusId(c) === "concluido" ? 100 : Number(c.progress) || 0), 0) / all.length) : 0;
        const isOpen = openAreas[area.id] !== undefined ? openAreas[area.id] : all.length > 0;
        return (
          <div className="cr-card" key={area.id} style={{ marginBottom: 14 }}>
            <div className="cr-row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ flex: 1, cursor: "pointer", minWidth: 220 }} onClick={() => setOpenAreas({ ...openAreas, [area.id]: !isOpen })}>
                <h2 className="cr-serif" style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: TITLE_INK }}>
                  <span style={{ color: TITLE_WINE }}>{isOpen ? "▾" : "▸"}</span> {area.name} <span style={{ margin: 0, fontSize: 13, letterSpacing: 0, textTransform: "none", fontWeight: 600, color: TITLE_WINE }}>({all.length} {all.length === 1 ? "curso" : "cursos"})</span>
                </h2>
                {area.description && <p className="cr-sub" style={{ margin: "2px 0 0 22px" }}>{area.description}</p>}
              </div>
              <div className="cr-row" style={{ gap: 2 }}>
                <button className="cr-btn ghost" title="Subir área" disabled={areaIdx === 0} onClick={() => setStudyAreas(moveItem(studyAreas, areaIdx, -1))}>↑</button>
                <button className="cr-btn ghost" title="Descer área" disabled={areaIdx === studyAreas.length - 1} onClick={() => setStudyAreas(moveItem(studyAreas, areaIdx, 1))}>↓</button>
                <button className="cr-btn primary" onClick={() => { setOpenAreas({ ...openAreas, [area.id]: true }); setEditingCourse({ item: null, areaId: area.id }); }}><Plus size={13} /> Adicionar curso</button>
                <button className="cr-btn ghost" title="Editar área" onClick={() => setEditingArea(area)}><Pencil size={13} /></button>
                <button className="cr-btn ghost danger" title="Excluir área" onClick={() => setConfirmArea({ area, n: all.length })}><Trash2 size={13} /></button>
              </div>
            </div>
            {all.length > 0 && (
              <div style={{ margin: "8px 0 0 18px", maxWidth: 360 }}>
                <div className="cr-progress-track"><div className="cr-progress-fill" style={{ width: `${avg}%`, background: progressColor(avg) }} /></div>
                <p className="cr-sub" style={{ margin: "3px 0 0", fontSize: 11.5 }}>{avg}% da área concluído</p>
              </div>
            )}
            {isOpen && (
              <div style={{ marginTop: 12 }}>
                {all.length === 0 && <p className="cr-empty" style={{ margin: "4px 0 8px" }}>Nenhum curso nesta área ainda.</p>}
                {shown.map((c) => {
                  const st = courseStatusId(c);
                  const pct = isClosedItem("courseStatus", st) ? 100 : Number(c.progress) || 0;
                  const links = studyLinks(c);
                  return (
                    <div key={c.id} style={{ padding: "12px 0", borderTop: "1px solid var(--line)" }}>
                      <div className="cr-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ flex: 1 }}>
                          <div className="cr-row" style={{ gap: 8 }}>
                            <strong style={{ fontSize: 15 }}>{c.title}</strong>
                            <span className="cr-chip">{listName("courseStatus", st)}</span>
                            {c.deadline && <span className="cr-chip">até {fmtDateShort(c.deadline)}</span>}
                            {Number(c.hours) > 0 && <span className="cr-chip">{c.hours}h</span>}
                          </div>
                          {c.description && <p className="cr-sub" style={{ margin: "4px 0 0" }}>{c.description}</p>}
                        </div>
                        <div className="cr-row" style={{ gap: 2 }}>
                          <button className="cr-btn ghost" onClick={() => setEditingCourse({ item: c, areaId: area.id })}><Pencil size={13} /></button>
                          <button className="cr-btn ghost danger" onClick={() => removeCourse(c.id)}><Trash2 size={13} /></button>
                        </div>
                      </div>
                      <div className="cr-row" style={{ alignItems: "center", margin: "6px 0" }}>
                        <div className="cr-progress-track" style={{ flex: 1, maxWidth: 360 }}><div className="cr-progress-fill" style={{ width: `${pct}%`, background: progressColor(pct) }} /></div>
                        <span className="cr-sub" style={{ margin: 0 }}>{pct}%</span>
                      </div>
                      <div className="cr-row" style={{ flexWrap: "wrap", gap: 6 }}>
                        {links.length === 0 && <button className="cr-btn ghost" style={{ border: "1.5px dashed var(--line)" }} onClick={() => setEditingCourse({ item: c, areaId: area.id })}><Link2 size={13} /> Adicionar link</button>}
                        {links.map((l, i) => (
                          <button key={l.id || i} className="cr-btn primary" onClick={() => openExternalLink(l.url)}><Link2 size={14} /> {linkLabel(l)}</button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {editingCourse && <CourseModal item={editingCourse.item} areaId={editingCourse.areaId} areas={studyAreas} onSave={saveCourse} onClose={() => setEditingCourse(null)} />}
      {editingArea && <StudyAreaModal item={editingArea === "new" ? null : editingArea} onSave={saveArea} onClose={() => setEditingArea(null)} />}
      {confirmArea && (
        <ConfirmModal title="Excluir área" message={`Excluir a área "${confirmArea.area.name}"${confirmArea.n ? ` e os ${confirmArea.n} curso(s) dentro dela` : ""}? Isso não pode ser desfeito.`}
          onConfirm={() => deleteArea(confirmArea.area.id)} onCancel={() => setConfirmArea(null)} />
      )}
    </div>
  );
}

function StudyAreaModal({ item, onSave, onClose }) {
  const [form, setForm] = useState(item || { name: "", description: "", image: "" });
  const autoStatus = useAutoSave(form, onSave, undefined);
  return (
    <Modal title={item ? "Editar área de estudo" : "Nova área de estudo"} onClose={onClose}>
      <div className="cr-field"><label className="cr-label">Nome da área</label>
        <input className="cr-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ex: CRM, Marketing, Dados, IA" /></div>
      <div className="cr-field"><label className="cr-label">Descrição</label>
        <textarea className="cr-textarea" value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
      <ImagePickerField label="Imagem (opcional)" value={form.image} onChange={(v) => setForm({ ...form, image: v })} />
      <AutoSaveFooter status={autoStatus} onClose={onClose} />
    </Modal>
  );
}

function CourseModal({ item, areaId, areas, onSave, onClose }) {
  const [form, setForm] = useState(item || { areaId, title: "", description: "", status: "para estudar", progress: 0, links: [], hours: "", deadline: "", image: "", notes: "" });
  const autoStatus = useAutoSave(form, onSave, (f) => ({ ...f, areaId: f.areaId || areaId, hours: Number(f.hours) || 0 }));
  const links = form.links || [];
  const setLink = (id, field, value) => setForm({ ...form, links: links.map((l) => l.id === id ? { ...l, [field]: value } : l) });
  const setProgress = (v) => setForm({
    ...form, progress: v,
    status: v >= 100 ? (getList("courseStatus").find((s) => s.closed)?.id || "concluido") : (v > 0 && courseStatusId(form) === "para estudar" ? "estudando" : form.status),
  });
  return (
    <Modal title={item ? "Editar curso" : "Novo curso"} onClose={onClose}>
      <div className="cr-field"><label className="cr-label">Área</label>
        <select className="cr-select" value={form.areaId || areaId} onChange={(e) => setForm({ ...form, areaId: e.target.value })}>
          {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select></div>
      <div className="cr-field"><label className="cr-label">Nome do curso</label>
        <input className="cr-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="ex: CRM Estratégia" /></div>
      <div className="cr-field"><label className="cr-label">Descrição</label>
        <textarea className="cr-textarea" value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>

      <div className="cr-field"><label className="cr-label">Links do curso (aulas, plataforma, material…)</label>
        {studyLinks(form).filter((l) => l.id === "legacy").map((l) => (
          <div className="cr-row" key="legacy" style={{ marginBottom: 6 }}>
            <input className="cr-input" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="https://…" />
            <button className="cr-btn ghost danger" onClick={() => setForm({ ...form, link: "" })}><Trash2 size={13} /></button>
          </div>
        ))}
        {links.map((l) => (
          <div className="cr-row" key={l.id} style={{ marginBottom: 6 }}>
            <input className="cr-input" style={{ maxWidth: 170 }} placeholder="Nome (ex: Aula 1)" value={l.label} onChange={(e) => setLink(l.id, "label", e.target.value)} />
            <input className="cr-input" placeholder="https://…" value={l.url} onChange={(e) => setLink(l.id, "url", e.target.value)} />
            <button className="cr-btn ghost danger" onClick={() => setForm({ ...form, links: links.filter((x) => x.id !== l.id) })}><Trash2 size={13} /></button>
          </div>
        ))}
        <button className="cr-btn" onClick={() => setForm({ ...form, links: [...links, { id: uid(), label: "", url: "" }] })}><Plus size={13} /> Adicionar link</button>
      </div>

      <div className="cr-row">
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Status</label>
          <ManagedSelect listKey="courseStatus" value={courseStatusId(form)} onChange={(v) => setForm({ ...form, status: v, progress: isClosedItem("courseStatus", v) ? 100 : form.progress })} /></div>
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Prazo</label>
          <input type="date" className="cr-input" value={form.deadline || ""} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></div>
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Horas</label>
          <input type="number" className="cr-input" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} /></div>
      </div>
      <div className="cr-field"><label className="cr-label">Progresso: {Number(form.progress) || 0}%</label>
        <input type="range" min="0" max="100" value={Number(form.progress) || 0} onChange={(e) => setProgress(Number(e.target.value))} style={{ width: "100%" }} />
        <div className="cr-progress-track" style={{ marginTop: 6 }}><div className="cr-progress-fill" style={{ width: `${Number(form.progress) || 0}%`, background: progressColor(Number(form.progress) || 0) }} /></div></div>
      <ImagePickerField label="Imagem (opcional)" value={form.image} onChange={(v) => setForm({ ...form, image: v })} />
      <div className="cr-field"><label className="cr-label">Anotações</label>
        <textarea className="cr-textarea" value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      <AutoSaveFooter status={autoStatus} onClose={onClose} />
    </Modal>
  );
}

function CareerView({ career, setCareer }) {
  const ctx = useContext(ListsContext);
  const [editing, setEditing] = useState(null);
  const save = (data) => { setCareer(upsertById(career, data)); };
  const remove = (id) => setCareer(career.filter((x) => x.id !== id));

  return (
    <div>
      <div className="cr-row" style={{ justifyContent: "space-between" }}>
        <div><h1 className="cr-h1 cr-serif">Carreira</h1><p className="cr-sub">Candidaturas, cursos, reuniões e conquistas.</p></div>
        <div className="cr-row">
          <button className="cr-btn" onClick={() => ctx.openManager("careerType")}><SettingsIcon size={13} /> Gerenciar tipos</button>
          <button className="cr-btn" onClick={() => ctx.openManager("careerStatus")}><SettingsIcon size={13} /> Gerenciar status</button>
          <button className="cr-btn primary" onClick={() => setEditing("new")}><Plus size={14} /> Novo item</button>
        </div>
      </div>
      {career.length === 0 && <p className="cr-empty">Nada registrado ainda.</p>}
      {[...getList("careerType").map((t) => t.id), ...Array.from(new Set(career.map((c) => c.type).filter((t) => t && !getList("careerType").some((x) => x.id === t))))].map((typeId) => {
        const items = career.filter((c) => c.type === typeId);
        if (items.length === 0) return null;
        return (
          <div key={typeId}>
            <SectionTitle title={listName("careerType", typeId)} count={`${items.length} ${items.length === 1 ? "item" : "itens"}`} />
            <div className="cr-card">
              {items.map((c) => (
                <div className="cr-list-row" key={c.id}>
                  <div style={{ flex: 1 }}>
                    <div>{c.title}</div>
                    {c.notes && <div className="cr-sub" style={{ margin: 0 }}>{c.notes}</div>}
                  </div>
                  <span className="cr-chip">{listName("careerStatus", c.status)}</span>
                  {c.date && <span className="cr-chip">{fmtDateShort(c.date)}</span>}
                  {c.link && <button className="cr-btn primary" style={{ padding: "4px 10px" }} onClick={() => openExternalLink(c.link)}><Link2 size={13} /> Abrir</button>}
                  <button className="cr-btn ghost" onClick={() => setEditing(c)}><Pencil size={14} /></button>
                  <button className="cr-btn ghost danger" onClick={() => remove(c.id)}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {editing && <CareerModal item={editing === "new" ? null : editing} onSave={save} onClose={() => setEditing(null)} />}
    </div>
  );
}

function CareerModal({ item, onSave, onClose }) {
  const [form, setForm] = useState(item || { type: "candidatura", title: "", date: todayStr(), status: "em andamento", notes: "", link: "" });
  const autoStatus = useAutoSave(form, onSave, undefined);
  return (
    <Modal title={item ? "Editar item" : "Novo item de carreira"} onClose={onClose}>
      <div className="cr-field"><label className="cr-label">Tipo</label>
        <ManagedSelect listKey="careerType" value={form.type} onChange={(v) => setForm({ ...form, type: v })} /></div>
      <div className="cr-field"><label className="cr-label">Título</label>
        <input className="cr-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
      <div className="cr-row">
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Data</label>
          <input type="date" className="cr-input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Status</label>
          <ManagedSelect listKey="careerStatus" value={form.status} onChange={(v) => setForm({ ...form, status: v })} /></div>
      </div>
      <div className="cr-field"><label className="cr-label">Link (vaga, portfólio, documento do Drive…)</label>
        <input className="cr-input" value={form.link || ""} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="https://drive.google.com/…" /></div>
      <div className="cr-field"><label className="cr-label">Notas</label>
        <textarea className="cr-textarea" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      <AutoSaveFooter status={autoStatus} onClose={onClose} />
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/* ROTINAS                                                                 */
/* ---------------------------------------------------------------------- */

const WEEKDAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const WEEKDAY_NAMES = [["segunda", 0], ["terça", 1], ["terca", 1], ["quarta", 2], ["quinta", 3], ["sexta", 4], ["sábado", 5], ["sabado", 5], ["domingo", 6]];

// Em quais dias da semana (0 = segunda ... 6 = domingo) a etapa acontece.
// Usa os dias marcados; se não houver, tenta entender pelo texto ("Segunda: ..." ou "dias úteis").
function stepDays(step) {
  if (Array.isArray(step.days) && step.days.length) return step.days;
  const text = (step.text || "").toLowerCase();
  const hit = WEEKDAY_NAMES.find(([n]) => text.startsWith(n));
  if (hit) return [hit[1]];
  const tm = (step.time || "").toLowerCase();
  if (tm.includes("dias úteis") || tm.includes("dias uteis")) return [0, 1, 2, 3, 4];
  if (tm.includes("alternados")) return [0, 2, 4];
  return [0, 1, 2, 3, 4, 5, 6];
}

function stepLabel(step) {
  const text = step.text || "";
  const hasDayPrefix = WEEKDAY_NAMES.some(([n]) => text.toLowerCase().startsWith(n)) && text.includes(":");
  return hasDayPrefix ? text.replace(/^[^:]+:\s*/, "") : text;
}

/* ---------------------------------------------------------------------- */
/* GOOGLE AGENDA: o que está realmente agendado                            */
/* ---------------------------------------------------------------------- */

const GCAL_BLUE = "#3F6C9E";


function gcalDayOf(s) { return (s || "").slice(0, 10); }
function gcalTimeOf(s) { return (s || "").length > 10 ? s.slice(11, 16) : ""; }
function fmtCalendarDate(dateStr) {
  const year = dateStr.slice(0, 4);
  return year === String(new Date().getFullYear()) ? fmtDateShort(dateStr) : `${fmtDateShort(dateStr)}/${year}`;
}
function gcalLocalStr(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function gcalDateStr(d) { return gcalLocalStr(d).slice(0, 10); }

// eventos que caem num dia (dia inteiro: o fim do Google é exclusivo)
function gcalOnDay(events, day) {
  return events.filter((e) => {
    if (e.ad) return day >= gcalDayOf(e.s) && day < (gcalDayOf(e.e) || addDays(gcalDayOf(e.s), 1));
    return gcalDayOf(e.s) === day;
  }).sort((a, b) => (a.ad === b.ad ? (a.s || "").localeCompare(b.s || "") : a.ad ? -1 : 1));
}

function findMeetLink(text) {
  const m = (text || "").match(/https:\/\/meet\.google\.com\/[a-z0-9-]+/i);
  return m ? m[0] : "";
}

// ---------- leitura de arquivo .ics (exportado do Google Agenda)
function parseICSDate(value, params) {
  const v = (value || "").trim();
  if (/^\d{8}$/.test(v)) return { str: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, allDay: true, date: new Date(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8)) };
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return null;
  const d = m[7] ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])) : new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return { str: gcalLocalStr(d), allDay: false, date: d };
}

function expandRRule(rule, startDate, exdates, windowStart, windowEnd) {
  const parts = {};
  rule.split(";").forEach((kv) => { const [k, v] = kv.split("="); if (k) parts[k.toUpperCase()] = v; });
  const freq = parts.FREQ;
  const interval = Math.max(1, Number(parts.INTERVAL) || 1);
  const count = parts.COUNT ? Number(parts.COUNT) : null;
  let until = null;
  if (parts.UNTIL) { const u = parseICSDate(parts.UNTIL.length === 8 ? parts.UNTIL : parts.UNTIL); until = u ? u.date : null; if (until && parts.UNTIL.length === 8) until = new Date(until.getTime() + 86399000); }
  const dayMap = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 0 };
  const byday = (parts.BYDAY || "").split(",").map((x) => dayMap[x.replace(/[^A-Z]/g, "")]).filter((x) => x !== undefined);
  const out = [];
  const ex = new Set(exdates);
  let emitted = 0, guard = 0;
  const push = (d) => {
    if (until && d > until) return false;
    if (count && emitted >= count) return false;
    emitted++;
    if (d >= windowStart && d <= windowEnd && !ex.has(gcalLocalStr(d))) out.push(new Date(d));
    return true;
  };
  const cur = new Date(startDate);
  if (freq === "DAILY") {
    while (guard++ < 4000 && cur <= windowEnd) { if (!push(cur)) break; cur.setDate(cur.getDate() + interval); }
  } else if (freq === "WEEKLY") {
    const days = byday.length ? byday : [startDate.getDay()];
    const weekStart = new Date(startDate); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    while (guard++ < 1000 && weekStart <= windowEnd) {
      for (const wd of [...days].sort((a, b) => a - b)) {
        const d = new Date(weekStart); d.setDate(d.getDate() + wd);
        d.setHours(startDate.getHours(), startDate.getMinutes(), 0, 0);
        if (d < startDate) continue;
        if (!push(d)) return out;
      }
      weekStart.setDate(weekStart.getDate() + 7 * interval);
    }
  } else if (freq === "MONTHLY") {
    while (guard++ < 400 && cur <= windowEnd) { if (!push(cur)) break; cur.setMonth(cur.getMonth() + interval); }
  } else if (freq === "YEARLY") {
    while (guard++ < 100 && cur <= windowEnd) { if (!push(cur)) break; cur.setFullYear(cur.getFullYear() + interval); }
  } else {
    push(cur);
  }
  return out;
}

function parseICS(text) {
  const lines = (text || "").replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const raw = [];
  let cur = null;
  lines.forEach((line) => {
    if (line === "BEGIN:VEVENT") { cur = { ex: [] }; return; }
    if (line === "END:VEVENT") { if (cur) raw.push(cur); cur = null; return; }
    if (!cur) return;
    const idx = line.indexOf(":");
    if (idx < 0) return;
    const head = line.slice(0, idx), value = line.slice(idx + 1);
    const name = head.split(";")[0].toUpperCase();
    const unesc = (v) => v.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
    if (name === "SUMMARY") cur.t = unesc(value);
    else if (name === "DTSTART") cur.start = parseICSDate(value);
    else if (name === "DTEND") cur.end = parseICSDate(value);
    else if (name === "LOCATION") cur.loc = unesc(value);
    else if (name === "DESCRIPTION") cur.desc = unesc(value);
    else if (name === "RRULE") cur.rrule = value;
    else if (name === "EXDATE") value.split(",").forEach((x) => { const d = parseICSDate(x); if (d) cur.ex.push(d.allDay ? d.str + "T00:00" : d.str); });
    else if (name === "UID") cur.uid = value;
    else if (name === "STATUS") cur.status = value;
    else if (name === "URL") cur.url = value;
    else if (name === "RECURRENCE-ID") cur.recId = parseICSDate(value);
  });
  const now = new Date();
  const wStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
  const wEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 365);
  const overridden = new Set(raw.filter((r) => r.recId && r.uid).map((r) => r.uid + "|" + gcalDateStr(r.recId.date)));
  const events = [];
  raw.forEach((r) => {
    if (!r.start || r.status === "CANCELLED") return;
    const dur = r.end ? r.end.date.getTime() - r.start.date.getTime() : 0;
    const base = { t: r.t || "(sem título)", ad: r.start.allDay, loc: r.loc || "", meet: findMeetLink((r.desc || "") + " " + (r.loc || "")), url: r.url || "" };
    const make = (d, i) => {
      const s = r.start.allDay ? gcalDateStr(d) : gcalLocalStr(d);
      const e = r.start.allDay ? gcalDateStr(new Date(d.getTime() + (dur || 86400000))) : gcalLocalStr(new Date(d.getTime() + dur));
      return { ...base, id: (r.uid || uid()) + "_" + i + "_" + s, s, e };
    };
    if (r.rrule && !r.recId) {
      const occ = expandRRule(r.rrule, r.start.date, r.ex, wStart, wEnd);
      occ.forEach((d, i) => { if (!(r.uid && overridden.has(r.uid + "|" + gcalDateStr(d)))) events.push(make(d, i)); });
    } else if (r.start.date >= wStart && r.start.date <= wEnd) {
      events.push(make(r.start.date, 0));
    }
  });
  return events.sort((a, b) => a.s.localeCompare(b.s));
}

async function callCalendarFunction(payload) {
  const { data, error } = await getSupabase().functions.invoke("google-calendar", { body: payload });
  if (error) {
    let responseBody = null;
    if (error.context instanceof Response) {
      try { responseBody = await error.context.clone().json(); } catch { responseBody = null; }
    }
    const failure = new Error(responseBody?.error || error.message || "Não foi possível acessar sua agenda Google.");
    failure.missing = responseBody?.missing === true;
    throw failure;
  }
  return data;
}

function parseCalendarIcs(ics) {
  const events = parseICS(ics);
  if (ics.includes("BEGIN:VEVENT") && events.length === 0) {
    throw new Error("Não foi possível interpretar os eventos do link .ics.");
  }
  const name = ics.match(/^X-WR-CALNAME:(.+)$/m)?.[1]?.trim() || "";
  return { events, name, updatedAt: new Date().toISOString() };
}

// Salva o link secreto no Supabase (tabela calendar_links, só acessível pela Edge Function)
// e devolve o id do registro e os eventos. O navegador não guarda o link depois disso.
async function saveCalendarLink(icsUrl) {
  const data = await callCalendarFunction({ action: "add-link", icsUrl });
  if (typeof data?.ics !== "string" || typeof data?.id !== "string") {
    throw new Error("A resposta ao salvar o link da agenda está inválida.");
  }
  return { linkId: data.id, existing: data.existing === true, ...parseCalendarIcs(data.ics) };
}

async function fetchCalendarLink(linkId) {
  const data = await callCalendarFunction({ action: "fetch-link", linkId });
  if (typeof data?.ics !== "string") throw new Error("A resposta do link .ics está inválida.");
  return parseCalendarIcs(data.ics);
}

async function removeCalendarLink(linkId) {
  await callCalendarFunction({ action: "remove-link", linkId });
}

const GCAL_COLORS = ["#3F6C9E", "#7A1712", "#3E9A5A", "#B4781F", "#6E4FA3", "#1F8A8A", "#C2477A", "#5C6B73"];
const GCAL_MAX_CALENDARS = 30;
const EMPTY_GCAL = { calendars: [], updatedAt: "" };

function makeCalendar(partial, index) {
  return {
    id: uid(),
    name: "Agenda",
    color: GCAL_COLORS[index % GCAL_COLORS.length],
    linkId: "",
    enabled: true,
    events: [],
    updatedAt: "",
    lastError: "",
    ...partial,
  };
}

// Só existe o fluxo de link secreto. Converte formatos antigos e descarta o que veio de
// conexão OAuth ou arquivo .ics. Agendas com `icsUrl` (link guardado dentro dos dados) são
// migradas para o servidor na próxima atualização.
function normalizeGcal(saved) {
  if (saved && Array.isArray(saved.calendars)) {
    const calendars = saved.calendars
      .filter((c) => c && c.kind !== "google" && c.kind !== "file" && (c.linkId || c.icsUrl))
      .map((c, i) => {
        const { kind: _kind, reconnect: _reconnect, ...rest } = c;
        return makeCalendar(rest, i);
      });
    return { ...saved, calendars };
  }
  if (saved && saved.source === "ics-link" && saved.icsUrl) {
    return {
      calendars: [makeCalendar({
        name: "Agenda principal", icsUrl: saved.icsUrl, events: saved.events || [],
        updatedAt: saved.updatedAt || "", lastError: saved.lastError || "",
      }, 0)],
      updatedAt: saved.updatedAt || "",
    };
  }
  return { ...EMPTY_GCAL, calendars: [] };
}

function canRefreshCalendar(cal) {
  return !!cal.icsUrl || (!!cal.enabled && !!cal.linkId);
}

async function refreshCalendar(cal) {
  try {
    if (cal.linkId) {
      const result = await fetchCalendarLink(cal.linkId);
      return { ...cal, name: cal.name || result.name || "Agenda", events: result.events, updatedAt: result.updatedAt, lastError: "" };
    }
    if (cal.icsUrl) {
      const { icsUrl, ...rest } = cal;
      const result = await saveCalendarLink(icsUrl);
      return { ...rest, linkId: result.linkId, name: cal.name || result.name || "Agenda", events: result.events, updatedAt: result.updatedAt, lastError: "" };
    }
    return cal;
  } catch (error) {
    return {
      ...cal,
      lastError: error?.missing
        ? "Este link não está mais salvo no servidor. Remova a agenda e adicione o link de novo."
        : error instanceof Error ? error.message : "Não foi possível atualizar esta agenda.",
    };
  }
}

function latestStamp(calendars, fallback = "") {
  const stamps = calendars.map((c) => c.updatedAt).filter(Boolean).sort();
  return stamps.length ? stamps[stamps.length - 1] : fallback;
}

// Atualiza todas em paralelo; a falha de uma não impede as outras.
async function refreshAllCalendars(gcal) {
  const calendars = await Promise.all(gcal.calendars.map((c) => (canRefreshCalendar(c) ? refreshCalendar(c) : c)));
  return { ...gcal, calendars, updatedAt: latestStamp(calendars, gcal.updatedAt || "") };
}

// Junta os eventos das agendas ativas, marcando cada um com a agenda de origem.
function gcalMergedEvents(gcal) {
  return (gcal.calendars || []).filter((c) => c.enabled).flatMap((c) =>
    (c.events || []).map((e) => ({ ...e, id: `${c.id}:${e.id}`, calId: c.id, calName: c.name, color: c.color })));
}

function GoogleAgendaView({ gcal, setGcal }) {
  const [mode, setMode] = useState(() => (gcal.calendars || []).length > 0 ? "lista" : "mes");
  const [offset, setOffset] = useState(0);
  const [showBreaks, setShowBreaks] = useState(false);
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState(null);
  const [connect, setConnect] = useState(false);
  const [dayOpen, setDayOpen] = useState(null);
  const today = todayStr();

  const merged = gcalMergedEvents(gcal);
  const all = merged.filter((e) => (showBreaks || e.t.trim().toLowerCase() !== "pausa")
    && (!query || e.t.toLowerCase().includes(query.toLowerCase())));

  const evChip = (e) => (
    <div key={e.id} onClick={(ev) => { ev.stopPropagation(); setDetail(e); }} title={e.t}
      style={{ cursor: "pointer", fontSize: 11.5, padding: "2px 6px", borderRadius: 6, marginBottom: 3, background: `${e.color}22`, borderLeft: `3px solid ${e.color}`, color: "#211D1A", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
      {!e.ad && <strong>{gcalTimeOf(e.s)} </strong>}{e.t}
    </div>
  );

  let body;
  let rangeLabel = "";
  if (mode === "mes") {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offset);
    const ym = gcalDateStr(d).slice(0, 7);
    rangeLabel = monthLabel(ym);
    const gridStart = startOfWeek(ym + "-01");
    const cells = [];
    for (let i = 0; i < 42; i++) cells.push(addDays(gridStart, i));
    body = (
      <div style={{ overflowX: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(110px, 1fr))", gap: 6, minWidth: 780 }}>
          {WEEKDAY_LABELS.map((l) => <div key={l} className="cr-label" style={{ textAlign: "center", margin: 0 }}>{l}</div>)}
          {cells.map((day) => {
            const evs = gcalOnDay(all, day);
            const inMonth = day.slice(0, 7) === ym;
            return (
              <div key={day} onClick={() => setDayOpen(day)} className="cr-card"
                style={{ padding: 6, minHeight: 96, cursor: "pointer", opacity: inMonth ? 1 : 0.45, background: day === today ? "#E8F0F9" : undefined, borderColor: day === today ? GCAL_BLUE : undefined }}>
                <div style={{ fontSize: 12, fontWeight: day === today ? 700 : 500, marginBottom: 3 }}>{Number(day.slice(8))}</div>
                {evs.slice(0, 3).map(evChip)}
                {evs.length > 3 && <div className="cr-sub" style={{ margin: 0, fontSize: 11 }}>+{evs.length - 3} mais</div>}
              </div>
            );
          })}
        </div>
      </div>
    );
  } else if (mode === "semana") {
    const start = startOfWeek(addDays(today, offset * 7));
    rangeLabel = `${fmtCalendarDate(start)} a ${fmtCalendarDate(addDays(start, 6))}`;
    body = (
      <div style={{ overflowX: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(120px, 1fr))", gap: 8, minWidth: 840 }}>
          {Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((day, i) => (
            <div key={day} className="cr-card" style={{ padding: 8, minHeight: 220, background: day === today ? "#E8F0F9" : undefined, borderColor: day === today ? GCAL_BLUE : undefined }}>
              <p className="cr-serif" style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 600 }}>{WEEKDAY_LABELS[i]} {fmtDateShort(day)}</p>
              {gcalOnDay(all, day).map(evChip)}
              {gcalOnDay(all, day).length === 0 && <p className="cr-sub" style={{ margin: 0, fontSize: 11.5 }}>livre</p>}
            </div>
          ))}
        </div>
      </div>
    );
  } else {
    const upcoming = all.filter((e) => (
      e.ad ? gcalDayOf(e.e) > today : gcalDayOf(e.s) >= today
    )).sort((a, b) => a.s.localeCompare(b.s));
    rangeLabel = "próximos eventos";
    const months = [];
    upcoming.forEach((e) => {
      const ym = gcalDayOf(e.s).slice(0, 7);
      let g = months.find((m) => m.ym === ym);
      if (!g) { g = { ym, items: [] }; months.push(g); }
      g.items.push(e);
    });
    body = (
      <div>
        {months.length === 0 && <p className="cr-empty">
          {all.length
            ? `A agenda foi carregada com ${all.length} evento(s), mas não há eventos futuros no período consultado.`
            : "Nenhum evento futuro por enquanto. Use \"Gerenciar agendas\" para adicionar seus links."}
        </p>}
        {months.map((m) => (
          <div key={m.ym}>
            <SectionTitle title={monthLabel(m.ym)} count={`${m.items.length} eventos`} />
            <div className="cr-card">
              {m.items.map((e) => (
                <div className="cr-list-row" key={e.id} style={{ cursor: "pointer" }} onClick={() => setDetail(e)}>
                  <span className="cr-chip" style={{ background: `${e.color}22`, borderLeft: `3px solid ${e.color}`, color: "#211D1A", minWidth: 84, justifyContent: "center" }}>{fmtCalendarDate(gcalDayOf(e.s))}</span>
                  <span className="cr-list-title" style={{ flex: 1 }}>{e.t}{gcal.calendars.length > 1 && <span className="cr-sub" style={{ margin: "0 0 0 8px", fontSize: 11.5, color: e.color }}>{e.calName}</span>}</span>
                  <span className="cr-sub" style={{ margin: 0 }}>{e.ad ? "dia inteiro" : gcalTimeOf(e.s) + (gcalTimeOf(e.e) ? " a " + gcalTimeOf(e.e) : "")}</span>
                  {e.meet && <button className="cr-btn primary" style={{ padding: "3px 10px" }} onClick={(ev) => { ev.stopPropagation(); openExternalLink(e.meet); }}>Meet</button>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const updated = gcal.updatedAt ? new Date(gcal.updatedAt) : null;
  const toggleCalendar = (id) => setGcal({ ...gcal, calendars: gcal.calendars.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c)) });
  const dayEvents = dayOpen ? gcalOnDay(all, dayOpen) : [];

  return (
    <div>
      <div className="cr-card" style={{ borderLeft: `5px solid ${GCAL_BLUE}`, marginTop: 14 }}>
        <div className="cr-row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <p className="cr-serif" style={{ margin: 0, fontSize: 17, color: TITLE_INK, fontWeight: 700 }}><span style={{ color: TITLE_WINE }}>GOOGLE AGENDA:</span> o que realmente está agendado</p>
            <p className="cr-sub" style={{ margin: "2px 0 0" }}>
              {gcal.calendars.length === 0
                ? "Nenhuma agenda conectada ainda. Em \"Gerenciar agendas\", cole os links secretos .ics das suas agendas para ver todas aqui. Esta visão não mistura com as Rotinas."
                : `${gcal.calendars.filter((c) => c.enabled).length} de ${gcal.calendars.length} agenda(s) ativa(s), ${merged.length} evento(s)${updated ? `, atualizado em ${updated.toLocaleDateString("pt-BR")} às ${updated.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : ""}. Esta visão não mistura com as Rotinas.`}
            </p>
            {gcal.calendars.filter((c) => c.lastError).map((c) => (
              <p key={c.id} className="cr-sub" role="alert" style={{ color: "#7A1712", margin: "8px 0 0" }}>{c.name}: {c.lastError} Abra "Gerenciar agendas" para tentar de novo.</p>
            ))}
          </div>
          <div className="cr-row">
            <button className="cr-btn primary" onClick={() => setConnect(true)}>Gerenciar agendas</button>
            <button className="cr-btn" onClick={() => openExternalLink("https://calendar.google.com")}>Abrir Google Agenda</button>
          </div>
        </div>
      </div>

      {gcal.calendars.length > 1 && (
        <div className="cr-row" style={{ margin: "12px 0 0", flexWrap: "wrap", gap: 6 }} aria-label="Filtrar por agenda">
          {gcal.calendars.map((c) => (
            <button key={c.id} type="button" className="cr-chip" aria-pressed={c.enabled} onClick={() => toggleCalendar(c.id)}
              title={c.enabled ? "Clique para esconder esta agenda" : "Clique para mostrar esta agenda"}
              style={{ cursor: "pointer", border: `1px solid ${c.color}`, background: c.enabled ? `${c.color}22` : "transparent", color: "#211D1A", opacity: c.enabled ? 1 : 0.55, textDecoration: c.enabled ? "none" : "line-through" }}>
              <span style={{ color: c.color }}>●</span>&nbsp;{c.name}
            </button>
          ))}
        </div>
      )}
      <div className="cr-row" style={{ margin: "14px 0", alignItems: "center", flexWrap: "wrap" }}>
        <button className={`cr-tabbtn ${mode === "mes" ? "active" : ""}`} onClick={() => { setMode("mes"); setOffset(0); }}>Mês</button>
        <button className={`cr-tabbtn ${mode === "semana" ? "active" : ""}`} onClick={() => { setMode("semana"); setOffset(0); }}>Semana</button>
        <button className={`cr-tabbtn ${mode === "lista" ? "active" : ""}`} onClick={() => { setMode("lista"); setOffset(0); }}>Próximos eventos</button>
        {mode !== "lista" && (
          <>
            <button className="cr-btn ghost" onClick={() => setOffset(offset - 1)}>←</button>
            <span className="cr-serif" style={{ fontSize: 15, minWidth: 140, textAlign: "center" }}>{rangeLabel}</span>
            <button className="cr-btn ghost" onClick={() => setOffset(offset + 1)}>→</button>
            {offset !== 0 && <button className="cr-btn ghost" onClick={() => setOffset(0)}>hoje</button>}
          </>
        )}
        <input className="cr-input" style={{ maxWidth: 200 }} placeholder="Buscar evento…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="cr-chip" style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={showBreaks} onChange={() => setShowBreaks(!showBreaks)} style={{ marginRight: 4 }} /> mostrar "Pausa"
        </label>
      </div>

      {body}

      {dayOpen && (
        <Modal size="small" title={`${fmtCalendarDate(dayOpen)}`} onClose={() => setDayOpen(null)}>
          {dayEvents.length === 0 && <p className="cr-empty">Nada agendado neste dia.</p>}
          {dayEvents.map((e) => (
            <div className="cr-list-row" key={e.id} style={{ cursor: "pointer" }} onClick={() => { setDayOpen(null); setDetail(e); }}>
              <span className="cr-chip" style={{ background: `${e.color}22`, borderLeft: `3px solid ${e.color}`, color: "#211D1A" }}>{e.ad ? "dia todo" : gcalTimeOf(e.s)}</span>
              <span className="cr-list-title" style={{ flex: 1 }}>{e.t}{gcal.calendars.length > 1 && <span className="cr-sub" style={{ margin: "0 0 0 8px", fontSize: 11.5, color: e.color }}>{e.calName}</span>}</span>
            </div>
          ))}
        </Modal>
      )}
      {detail && (
        <Modal title={detail.t} onClose={() => setDetail(null)}>
          <p style={{ fontSize: 15 }}><strong>Quando:</strong> {fmtCalendarDate(gcalDayOf(detail.s))}{detail.ad ? " (dia inteiro)" : ` das ${gcalTimeOf(detail.s)} às ${gcalTimeOf(detail.e)}`}</p>
          {detail.calName && <p style={{ fontSize: 15 }}><strong>Agenda:</strong> <span style={{ color: detail.color }}>●</span> {detail.calName}</p>}
          {detail.loc && <p style={{ fontSize: 15 }}><strong>Local:</strong> {detail.loc}</p>}
          <div className="cr-row" style={{ gap: 8 }}>
            {detail.meet && <button className="cr-btn primary" onClick={() => openExternalLink(detail.meet)}><Link2 size={14} /> Entrar na reunião (Meet)</button>}
            {detail.url && <button className="cr-btn primary" onClick={() => openExternalLink(detail.url)}>Abrir no Google Agenda</button>}
          </div>
          <p className="cr-sub" style={{ marginTop: 16 }}>Este evento vem do Google Agenda. Para editar ou excluir, use o próprio Google Agenda e depois atualize aqui.</p>
        </Modal>
      )}
      {connect && <GoogleConnectModal gcal={gcal} setGcal={setGcal} onClose={() => setConnect(false)} />}
    </div>
  );
}

function CalendarRow({ cal, busy, onPatch, onRefresh, onRemove }) {
  const [name, setName] = useState(cal.name);
  useEffect(() => { setName(cal.name); }, [cal.name]);
  const commitName = () => {
    const next = name.trim();
    if (!next) { setName(cal.name); return; }
    if (next !== cal.name) onPatch({ name: next });
  };
  return (
    <div className="cr-card" style={{ marginBottom: 10, borderLeft: `5px solid ${cal.color}`, opacity: cal.enabled ? 1 : 0.7 }}>
      <div className="cr-row" style={{ flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <input className="cr-input" style={{ flex: "1 1 180px", minWidth: 140 }} value={name} aria-label="Nome da agenda"
          onChange={(e) => setName(e.target.value)} onBlur={commitName} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
        <label className="cr-chip" style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={cal.enabled} onChange={() => onPatch({ enabled: !cal.enabled })} style={{ marginRight: 4 }} /> mostrar
        </label>
      </div>
      <div className="cr-row" style={{ gap: 6, margin: "8px 0", flexWrap: "wrap" }} aria-label="Cor da agenda">
        {GCAL_COLORS.map((color) => (
          <button key={color} type="button" onClick={() => onPatch({ color })} aria-label={`Cor ${color}`} aria-pressed={cal.color === color}
            style={{ width: 24, height: 24, borderRadius: 12, background: color, cursor: "pointer", border: cal.color === color ? "3px solid #211D1A" : "2px solid transparent", padding: 0 }} />
        ))}
      </div>
      <p className="cr-sub" style={{ margin: "0 0 8px", fontSize: 12 }}>
        {(cal.events || []).length} evento(s)
        {cal.updatedAt ? `, atualizada em ${new Date(cal.updatedAt).toLocaleDateString("pt-BR")}` : ""}
        {cal.linkId ? ", link salvo no servidor" : ", link ainda não migrado para o servidor"}
      </p>
      {cal.lastError && <p className="cr-sub" role="alert" style={{ color: "#7A1712", margin: "0 0 8px", fontSize: 12.5 }}>{cal.lastError}</p>}
      <div className="cr-row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button className="cr-btn" disabled={busy} onClick={onRefresh}>Atualizar</button>
        <button className="cr-btn ghost danger" disabled={busy} onClick={onRemove}><Trash2 size={13} /> Remover</button>
      </div>
    </div>
  );
}

function GoogleConnectModal({ gcal, setGcal, onClose }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [bulk, setBulk] = useState("");
  const [removing, setRemoving] = useState(null);
  const calendars = gcal.calendars || [];

  const persist = async (next, okMessage) => {
    const saved = await setGcal({ ...next, updatedAt: latestStamp(next.calendars, next.updatedAt) });
    if (saved === false) { setMsg("A alteração foi feita na tela, mas não foi possível salvar. Confira sua conexão e tente novamente."); return false; }
    if (okMessage) setMsg(okMessage);
    return true;
  };
  const patchCalendar = (id, changes) => persist({ ...gcal, calendars: calendars.map((c) => (c.id === id ? { ...c, ...changes } : c)) });

  const addLinks = async () => {
    const links = Array.from(new Set(bulk.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean)));
    if (!links.length) { setMsg("Cole ao menos um link secreto .ics (um por linha)."); return; }
    if (calendars.length + links.length > GCAL_MAX_CALENDARS) {
      setMsg(`O limite é de ${GCAL_MAX_CALENDARS} agendas. Remova alguma antes de adicionar mais.`); return;
    }
    setBusy(true); setMsg("");
    try {
      const results = await Promise.all(links.map(async (url) => {
        try { return { ok: true, url, data: await saveCalendarLink(url) }; }
        catch (err) { return { ok: false, url, message: err instanceof Error ? err.message : "Falha ao salvar o link." }; }
      }));
      const knownIds = new Set(calendars.map((c) => c.linkId).filter(Boolean));
      const okResults = results.filter((r) => r.ok);
      const duplicated = okResults.filter((r) => knownIds.has(r.data.linkId)).length;
      const added = okResults.filter((r) => !knownIds.has(r.data.linkId)).map((r, i) => makeCalendar({
        name: r.data.name || `Agenda ${calendars.length + i + 1}`, linkId: r.data.linkId,
        events: r.data.events, updatedAt: r.data.updatedAt,
      }, calendars.length + i));
      const failed = results.filter((r) => !r.ok);
      if (added.length && !(await persist({ ...gcal, calendars: [...calendars, ...added] }))) return;
      setBulk(failed.map((f) => f.url).join("\n"));
      const parts = [];
      if (added.length) parts.push(`${added.length} agenda(s) adicionada(s)`);
      if (duplicated) parts.push(`${duplicated} já estava(m) na lista`);
      if (failed.length) parts.push(`${failed.length} falhou(aram): ${failed.map((f) => `…${f.url.slice(-10)} (${f.message})`).join("; ")}`);
      setMsg(parts.join(". ") + ".");
    } finally { setBusy(false); }
  };

  const refreshAll = async () => {
    setBusy(true); setMsg("");
    try {
      const next = await refreshAllCalendars(gcal);
      const failed = next.calendars.filter((c) => c.lastError).length;
      await persist(next, failed ? `Atualizado, mas ${failed} agenda(s) com erro. Veja os detalhes em cada uma.` : "Todas as agendas foram atualizadas.");
    } finally { setBusy(false); }
  };

  const refreshOne = async (cal) => {
    setBusy(true); setMsg("");
    try {
      const updated = await refreshCalendar(cal);
      await persist({ ...gcal, calendars: calendars.map((c) => (c.id === cal.id ? updated : c)) },
        updated.lastError ? "" : `${updated.name} atualizada.`);
    } finally { setBusy(false); }
  };

  const removeCalendar = async (target) => {
    setBusy(true); setMsg("");
    try {
      if (target.linkId) {
        try { await removeCalendarLink(target.linkId); }
        catch (err) {
          if (!err?.missing) { setMsg(`Não foi possível remover o link do servidor: ${err instanceof Error ? err.message : "tente de novo."}`); return; }
        }
      }
      await persist({ ...gcal, calendars: calendars.filter((c) => c.id !== target.id) }, "Agenda removida.");
    } finally { setBusy(false); }
  };

  return (
    <Modal title="Agendas do Google" onClose={onClose}>
      {msg && <div className="cr-card" role="status" style={{ borderColor: GCAL_BLUE, marginBottom: 14 }}><strong>{msg}</strong></div>}

      <h3 className="cr-serif" style={{ fontSize: 17 }}>Suas agendas ({calendars.length})</h3>
      {calendars.length === 0 && <p className="cr-sub">Nenhuma agenda ainda. Cole os links abaixo.</p>}
      {calendars.map((cal) => (
        <CalendarRow key={cal.id} cal={cal} busy={busy}
          onPatch={(changes) => patchCalendar(cal.id, changes)}
          onRefresh={() => refreshOne(cal)}
          onRemove={() => setRemoving(cal)} />
      ))}
      {calendars.length > 0 && (
        <button className="cr-btn primary" disabled={busy} onClick={refreshAll}>{busy ? "Atualizando…" : "Atualizar todas"}</button>
      )}

      <h3 className="cr-serif" style={{ fontSize: 17, marginTop: 26 }}>Adicionar agendas por link secreto</h3>
      <p className="cr-sub">
        No Google Agenda (no computador): Configurações → clique na agenda em "Configurações dos meus calendários" → <strong>Integrar agenda</strong> → copie o <strong>Endereço secreto no formato iCal</strong>.
        Cole um link por linha; o nome de cada agenda é preenchido automaticamente. Os links são salvos no seu Supabase, em uma tabela que o navegador não consegue ler, e não entram nos backups.
      </p>
      <textarea className="cr-input" rows={5} style={{ width: "100%", boxSizing: "border-box" }} value={bulk}
        placeholder={"https://calendar.google.com/calendar/ical/…/basic.ics\nhttps://calendar.google.com/calendar/ical/…/basic.ics"}
        onChange={(e) => setBulk(e.target.value)} />
      <div className="cr-row" style={{ marginTop: 8 }}>
        <button className="cr-btn primary" disabled={busy} onClick={addLinks}>{busy ? "Salvando…" : "Salvar e adicionar"}</button>
      </div>

      <div className="cr-row" style={{ justifyContent: "flex-end", marginTop: 20 }}>
        <button className="cr-btn primary" onClick={onClose}>Concluir</button>
      </div>

      {removing && (
        <ConfirmModal title="Remover agenda" confirmLabel="Remover"
          message={`Remover "${removing.name}" da Central? O link será apagado do servidor. Isso não apaga nada no Google Agenda.`}
          onCancel={() => setRemoving(null)}
          onConfirm={() => { const target = removing; setRemoving(null); removeCalendar(target); }} />
      )}
    </Modal>
  );
}

const ROUTINE_CATEGORY_KEYWORDS = [
  ["treino", /academia|alongament|treino|gl[uú]teo|perna|costas|cardio|dan[cç]a|yoga|pilates|muscula|abd[oô]m|flexibilidade|caminhada|corrida|gin[aá]stica|calistenia/i],
  ["trabalho", /trabalho|reuni[aã]o|expediente|escrit[oó]rio|home office/i],
  ["estudos", /estud|curso|\bler\b|leitura|ingl[eê]s|\baula\b|livro|faculdade|est[aá]gio|tcc/i],
  ["autocuidado", /skin ?care|cabelo|beber [aá]gua|banho|descanso|massagem|unha|maquiagem|sono|medita/i],
  ["casa", /casa|limpeza|mercado|faxina|lavar|cozinh/i],
];

// Categoria da etapa: a que você escolheu; se não escolheu, tenta entender pelo nome
function stepCategoryId(step) {
  const list = getList("routineCategory");
  if (step.category && list.some((c) => c.id === step.category)) return step.category;
  const hit = ROUTINE_CATEGORY_KEYWORDS.find(([, re]) => re.test(step.text || ""));
  const id = hit ? hit[0] : "outros";
  if (list.some((c) => c.id === id)) return id;
  return list.some((c) => c.id === "outros") ? "outros" : ((list[0] && list[0].id) || "");
}

function itemColor(key, id) {
  const it = getList(key).find((i) => i.id === id);
  if (it && it.color) return it.color;
  const reg = LIST_REGISTRY[key];
  const d = reg && reg.defaults.find((i) => i.id === id);
  return (d && d.color) || "#8C8177";
}

function readableText(hex) {
  const h = (hex || "#888888").replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? "#3A2A12" : "#FFFFFF";
}

function PriorityChip({ id }) {
  if (!id) return null;
  const color = itemColor("priority", id);
  return <span className="cr-chip" style={{ background: color, color: readableText(color), fontWeight: 600 }}>{listName("priority", id)}</span>;
}

function PrioritySelect({ value, onChange }) {
  const color = value ? itemColor("priority", value) : "";
  return (
    <select className="cr-select" value={value || ""} onChange={(e) => onChange(e.target.value)}
      style={{ maxWidth: 118, padding: "4px 6px", fontSize: 12, background: color || undefined, color: color ? readableText(color) : undefined, fontWeight: color ? 600 : 400 }}>
      <option value="">Prioridade</option>
      {getList("priority").map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
    </select>
  );
}

function toMin(hhmm) { const [h, m] = (hhmm || "0:0").split(":").map(Number); return h * 60 + (m || 0); }
function fromMin(min) { const t = Math.max(0, Math.min(24 * 60 - 1, min)); return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; }
function fmtDuration(min) { const h = Math.floor(min / 60), m = min % 60; return h ? (m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`) : `${m}min`; }
function toHHMM(h, m) { return `${String(Math.min(23, Number(h))).padStart(2, "0")}:${m || "00"}`; }

// Início e término: usa os horários preenchidos; nas etapas antigas, lê do texto ("8h-9h")
function stepStartEnd(step) {
  if (step.start) return { start: step.start, end: step.end || "" };
  const toks = [];
  const re = /(\d{1,2})\s*(?:[:h]\s*(\d{2}))?/g;
  let m;
  while ((m = re.exec(step.time || "")) && toks.length < 2) toks.push(toHHMM(m[1], m[2]));
  return { start: toks[0] || "", end: toks[1] || "" };
}
function stepStart(step) { return stepStartEnd(step).start; }
function stepRangeLabel(step) {
  const { start, end } = stepStartEnd(step);
  return start ? (end ? `${start} – ${end}` : start) : "";
}

// Lado a lado quando duas atividades acontecem no mesmo horário
function layoutLanes(items) {
  items.sort((a, b) => a.sm - b.sm || a.em - b.em);
  let cluster = [], clusterEnd = -1, laneEnds = [];
  const flush = () => { cluster.forEach((it) => { it.lanes = laneEnds.length || 1; }); cluster = []; laneEnds = []; clusterEnd = -1; };
  items.forEach((it) => {
    if (cluster.length && it.sm >= clusterEnd) flush();
    let lane = laneEnds.findIndex((e) => e <= it.sm);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(it.em); } else laneEnds[lane] = it.em;
    it.lane = lane; cluster.push(it); clusterEnd = Math.max(clusterEnd, it.em);
  });
  flush();
}

function RoutinesCalendar({ routines, onEdit, onToggle }) {
  const ctx = useContext(ListsContext);
  const [routineFilter, setRoutineFilter] = useState("todas");
  const todayIdx = (new Date().getDay() + 6) % 7;
  const today = todayStr();
  const list = routineFilter === "todas" ? routines : routines.filter((r) => r.id === routineFilter);
  const PX = 0.85; // pixels por minuto

  const columns = WEEKDAY_LABELS.map((label, day) => {
    const timed = [], untimed = [];
    list.forEach((r) => (r.steps || []).forEach((s) => {
      if (!stepDays(s).includes(day)) return;
      const { start, end } = stepStartEnd(s);
      const cat = stepCategoryId(s);
      if (!start) { untimed.push({ routine: r, step: s, cat }); return; }
      const sm = toMin(start);
      let em = end ? toMin(end) : sm + 60;
      if (em <= sm) em = sm + 30;
      timed.push({ routine: r, step: s, cat, start, end: end || fromMin(em), sm, em });
    }));
    layoutLanes(timed);
    return { label, day, timed, untimed };
  });
  const allTimed = columns.flatMap((c) => c.timed);
  const gridStart = allTimed.length ? Math.min(7, Math.floor(Math.min(...allTimed.map((e) => e.sm)) / 60)) : 7;
  const gridEnd = allTimed.length ? Math.max(21, Math.ceil(Math.max(...allTimed.map((e) => e.em)) / 60)) : 21;
  const gridH = (gridEnd - gridStart) * 60 * PX;
  const hours = Array.from({ length: gridEnd - gridStart + 1 }, (_, i) => gridStart + i);
  const usedCats = new Set(columns.flatMap((c) => [...c.timed, ...c.untimed].map((e) => e.cat)));
  const cols = "52px repeat(7, minmax(104px, 1fr))";

  return (
    <div>
      <div className="cr-card" style={{ borderLeft: "5px solid var(--clay)", marginTop: 14 }}>
        <p className="cr-serif" style={{ margin: 0, fontSize: 17, color: TITLE_INK, fontWeight: 700 }}><span style={{ color: TITLE_WINE }}>CALENDÁRIO DE ROTINAS:</span> o que você planejou fazer</p>
        <p className="cr-sub" style={{ margin: "2px 0 0" }}>É a rotina que você pretende seguir, não o que está no Google Agenda nem o que você de fato fez. Cada cor é uma categoria e cada bloco mostra início, término e o tempo ocupado.</p>
      </div>
      <div className="cr-row" style={{ margin: "12px 0", flexWrap: "wrap", alignItems: "center" }}>
        <select className="cr-select" style={{ maxWidth: 240 }} value={routineFilter} onChange={(e) => setRoutineFilter(e.target.value)}>
          <option value="todas">Todas as rotinas</option>
          {routines.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        {getList("routineCategory").filter((c) => usedCats.has(c.id)).map((c) => (
          <span key={c.id} className="cr-chip" style={{ background: itemColor("routineCategory", c.id), color: readableText(itemColor("routineCategory", c.id)), fontWeight: 600 }}>{c.name}</span>
        ))}
        <button className="cr-btn" onClick={() => ctx.openManager("routineCategory")}><SettingsIcon size={13} /> Gerenciar categorias e cores</button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: 880 }}>
          <div style={{ display: "grid", gridTemplateColumns: cols, gap: 4 }}>
            <div />
            {columns.map((c) => (
              <div key={c.day} className="cr-serif" style={{ textAlign: "center", fontSize: 14, fontWeight: 600, padding: "6px 0", borderRadius: 8, background: c.day === todayIdx ? "#F7E9E4" : undefined }}>
                {c.label}{c.day === todayIdx ? " (hoje)" : ""}
              </div>
            ))}
          </div>
          {columns.some((c) => c.untimed.length) && (
            <div style={{ display: "grid", gridTemplateColumns: cols, gap: 4, marginBottom: 6 }}>
              <div className="cr-sub" style={{ margin: 0, fontSize: 10.5, textAlign: "right", paddingRight: 4 }}>sem horário</div>
              {columns.map((c) => (
                <div key={c.day}>
                  {c.untimed.map((e, i) => (
                    <div key={e.step.id + i} onClick={() => onEdit(e.routine)} style={{ cursor: "pointer", fontSize: 11, padding: "3px 6px", borderRadius: 6, marginBottom: 3, background: itemColor("routineCategory", e.cat), color: readableText(itemColor("routineCategory", e.cat)) }}>{stepLabel(e.step)}</div>
                  ))}
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: cols, gap: 4 }}>
            <div style={{ position: "relative", height: gridH }}>
              {hours.map((h) => (
                <div key={h} className="cr-sub" style={{ position: "absolute", top: (h - gridStart) * 60 * PX - 7, right: 4, margin: 0, fontSize: 10.5 }}>{String(h).padStart(2, "0")}:00</div>
              ))}
            </div>
            {columns.map((c) => (
              <div key={c.day} style={{ position: "relative", height: gridH, borderRadius: 8, border: "1px solid var(--line)", background: c.day === todayIdx ? "#FBF1ED" : "#FCFAF6", backgroundImage: `repeating-linear-gradient(to bottom, var(--line) 0, var(--line) 1px, transparent 1px, transparent ${60 * PX}px)` }}>
                {c.timed.map((e, i) => {
                  const color = itemColor("routineCategory", e.cat);
                  const txt = readableText(color);
                  const isToday = c.day === todayIdx;
                  const doneToday = isToday && e.step.log && e.step.log[today];
                  const h = Math.max(24, (e.em - e.sm) * PX - 2);
                  return (
                    <div key={e.step.id + "-" + i} onClick={() => onEdit(e.routine)}
                      title={`${stepLabel(e.step)} · ${listName("routineCategory", e.cat)} · ${e.start} – ${e.end} (${fmtDuration(e.em - e.sm)})`}
                      style={{ position: "absolute", top: (e.sm - gridStart * 60) * PX, height: h, left: `calc(${(e.lane * 100) / e.lanes}% + 1px)`, width: `calc(${100 / e.lanes}% - 3px)`,
                        background: color, color: txt, borderRadius: 6, padding: "3px 6px", fontSize: 11, lineHeight: 1.25, overflow: "hidden", cursor: "pointer", boxSizing: "border-box", opacity: doneToday ? 0.55 : 1 }}>
                      {isToday && (
                        <div onClick={(ev) => { ev.stopPropagation(); onToggle(e.routine, e.step.id); }}
                          style={{ position: "absolute", top: 3, right: 3, width: 14, height: 14, borderRadius: 4, border: `1.5px solid ${txt}`, background: doneToday ? txt : "transparent", color, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {doneToday && <Check size={10} />}
                        </div>
                      )}
                      <strong style={{ display: "block", fontSize: 10.5 }}>{e.start} – {e.end}</strong>
                      <span style={{ textDecoration: doneToday ? "line-through" : "none" }}>{stepLabel(e.step)}</span>
                      {h > 56 && <span style={{ display: "block", opacity: 0.85, fontSize: 10 }}>{listName("routineCategory", e.cat)} · {fmtDuration(e.em - e.sm)}</span>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function RoutinesView({ routines, setRoutines, embedded, gcal, setGcal }) {
  const [editing, setEditing] = useState(null);
  const [view, setView] = useState("calendario");
  const [confirmDel, setConfirmDel] = useState(null);
  const [dayOpen, setDayOpen] = useState(null);
  const [showDoneSteps, setShowDoneSteps] = useState(false);
  const save = (data) => { setRoutines(upsertById(routines, data)); };
  const remove = (id) => setRoutines(routines.filter((x) => x.id !== id));
  // cada dia tem seu próprio "feito", assim dá para acompanhar o que foi realizado
  const toggleStep = (routine, stepId) => {
    const today = todayStr();
    const steps = routine.steps.map((s) => {
      if (s.id !== stepId) return s;
      const log = { ...(s.log || {}) };
      if (log[today]) delete log[today]; else log[today] = true;
      return { ...s, log };
    });
    setRoutines(routines.map((r) => r.id === routine.id ? { ...r, steps } : r));
  };

  return (
    <div>
      <div className="cr-row" style={{ justifyContent: embedded ? "flex-end" : "space-between", marginTop: embedded ? 12 : 0 }}>
        {!embedded && <div><h1 className="cr-h1 cr-serif">Rotinas</h1><p className="cr-sub">Sequências de etapas para seus momentos do dia.</p></div>}
        <button className="cr-btn primary" onClick={() => setEditing("new")}><Plus size={14} /> Nova rotina</button>
      </div>

      <div className="cr-tabbar" style={{ marginTop: 8 }}>
        <button className={`cr-tabbtn ${view === "calendario" ? "active" : ""}`} onClick={() => setView("calendario")}>Calendário de Rotinas (planejado)</button>
        <button className={`cr-tabbtn ${view === "google" ? "active" : ""}`} onClick={() => setView("google")}>Google Agenda (agendado de verdade)</button>
        <button className={`cr-tabbtn ${view === "lista" ? "active" : ""}`} onClick={() => setView("lista")}>Lista</button>
      </div>

      {view === "google" ? (
        <GoogleAgendaView gcal={gcal} setGcal={setGcal} />
      ) : view === "calendario" ? (
        routines.length === 0 ? <p className="cr-empty">Nenhuma rotina cadastrada ainda.</p> : <RoutinesCalendar routines={routines} onEdit={setEditing} onToggle={toggleStep} />
      ) : (
        <>
        <div className="cr-row" style={{ marginTop: 12 }}>
          <button className="cr-btn ghost" onClick={() => setShowDoneSteps(!showDoneSteps)}>{showDoneSteps ? "Ocultar o que já fiz hoje" : "Mostrar o que já fiz hoje"}</button>
        </div>
        <div className="cr-grid cr-grid-2" style={{ marginTop: 8 }}>
          {routines.length === 0 && <p className="cr-empty">Nenhuma rotina cadastrada ainda.</p>}
          {routines.map((r) => (
            <div className="cr-card" key={r.id}>
              <div className="cr-row" style={{ justifyContent: "space-between" }}>
                <h3 className="cr-serif" style={{ margin: 0, fontSize: 16 }}>{r.name}</h3>
                <div className="cr-row" style={{ gap: 2 }}>
                  <button className="cr-btn ghost" onClick={() => setEditing(r)}><Pencil size={13} /></button>
                  <button className="cr-btn ghost danger" onClick={() => setConfirmDel(r)}><Trash2 size={13} /></button>
                </div>
              </div>
              <p className="cr-sub" style={{ margin: "2px 0 6px" }}>Marcações valem para hoje e recomeçam amanhã.</p>
              {r.steps.length > 0 && !showDoneSteps && r.steps.every((x) => x.log && x.log[todayStr()]) && <p className="cr-empty">Tudo feito por hoje.</p>}
              {r.steps.filter((x) => showDoneSteps || !(x.log && x.log[todayStr()])).map((s) => {
                const doneToday = !!(s.log && s.log[todayStr()]);
                return (
                  <div className="cr-list-row" key={s.id}>
                    <div className={`cr-checkbox ${doneToday ? "checked" : ""}`} onClick={() => toggleStep(r, s.id)}>
                      {doneToday && <Check size={13} />}
                    </div>
                    <button className="cr-btn ghost" title="Abrir os detalhes deste dia e registrar o que você fez"
                      style={{ flex: 1, justifyContent: "flex-start", textAlign: "left", textDecoration: doneToday ? "line-through" : "none", fontWeight: 600 }}
                      onClick={() => setDayOpen({ routineId: r.id, stepId: s.id })}>{s.text}</button>
                    {Object.values(s.sessions || {}).some((x) => (x.exercises || []).length) && (
                      <span className="cr-chip">{Object.values(s.sessions).filter((x) => (x.exercises || []).length).length} treino(s) registrados</span>
                    )}
                    {stepRangeLabel(s) && <span className="cr-chip">{stepRangeLabel(s)}</span>}
                    <span className="cr-chip" style={{ background: itemColor("routineCategory", stepCategoryId(s)), color: readableText(itemColor("routineCategory", stepCategoryId(s))) }}>{listName("routineCategory", stepCategoryId(s))}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        </>
      )}
      {editing && <RoutineModal routine={editing === "new" ? null : editing} onSave={save} onClose={() => setEditing(null)} />}
      {dayOpen && (() => {
        const rt = routines.find((x) => x.id === dayOpen.routineId);
        const st = rt && rt.steps.find((x) => x.id === dayOpen.stepId);
        if (!st) return null;
        return <WorkoutDayPage routine={rt} step={st} onClose={() => setDayOpen(null)}
          onChange={(updated) => setRoutines(routines.map((x) => x.id === rt.id ? { ...x, steps: x.steps.map((y) => y.id === updated.id ? updated : y) } : x))} />;
      })()}
      {confirmDel && (
        <ConfirmModal title="Excluir rotina" message={`Excluir a rotina "${confirmDel.name}"?`}
          onConfirm={() => { remove(confirmDel.id); setConfirmDel(null); }} onCancel={() => setConfirmDel(null)} />
      )}
    </div>
  );
}

function PlanningTracker({ tasks, setTasks, routines }) {
  const [mode, setMode] = useState("semana");
  const [offset, setOffset] = useState(0);
  const today = todayStr();

  const range = useMemo(() => {
    if (mode === "semana") {
      const start = startOfWeek(addDays(today, offset * 7));
      return { start, end: addDays(start, 6), label: `${fmtDateShort(start)} a ${fmtDateShort(addDays(start, 6))}` };
    }
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offset);
    const ym = d.toISOString().slice(0, 7);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return { start: ym + "-01", end: ym + "-" + String(last).padStart(2, "0"), label: monthLabel(ym) };
  }, [mode, offset, today]);

  const days = [];
  for (let d = range.start; d <= range.end; d = addDays(d, 1)) days.push(d);

  const periodTasks = tasks.filter((t) => t.dueDate && t.dueDate >= range.start && t.dueDate <= range.end);
  const tasksDone = periodTasks.filter((t) => t.done).length;
  const overdue = periodTasks.filter((t) => !t.done && t.dueDate < today);
  const pending = periodTasks.filter((t) => !t.done).sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const perDay = days.map((d) => {
    const dayTasks = periodTasks.filter((t) => t.dueDate === d);
    const idx = (new Date(d + "T00:00:00").getDay() + 6) % 7;
    let rPlanned = 0, rDone = 0;
    if (d <= today) {
      routines.forEach((r) => (r.steps || []).forEach((s) => {
        if (stepDays(s).includes(idx)) { rPlanned++; if (s.log && s.log[d]) rDone++; }
      }));
    }
    return { d, idx, tPlanned: dayTasks.length, tDone: dayTasks.filter((t) => t.done).length, rPlanned, rDone };
  });
  const rPlannedTotal = perDay.reduce((s, x) => s + x.rPlanned, 0);
  const rDoneTotal = perDay.reduce((s, x) => s + x.rDone, 0);
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const allPlanned = periodTasks.length + rPlannedTotal;
  const allDone = tasksDone + rDoneTotal;

  const SummaryCard = ({ title, done, planned, note }) => (
    <div className="cr-card">
      <p className="cr-label">{title}</p>
      <p className="cr-serif" style={{ fontSize: 26, margin: "2px 0" }}>{pct(done, planned)}%</p>
      <div className="cr-progress-track"><div className="cr-progress-fill" style={{ width: `${pct(done, planned)}%`, background: progressColor(pct(done, planned)) }} /></div>
      <p className="cr-sub" style={{ margin: "6px 0 0" }}>{done} de {planned} {note}</p>
    </div>
  );

  return (
    <div>
      <div className="cr-row" style={{ margin: "14px 0", alignItems: "center", flexWrap: "wrap" }}>
        <button className={`cr-tabbtn ${mode === "semana" ? "active" : ""}`} onClick={() => { setMode("semana"); setOffset(0); }}>Semana</button>
        <button className={`cr-tabbtn ${mode === "mes" ? "active" : ""}`} onClick={() => { setMode("mes"); setOffset(0); }}>Mês</button>
        <button className="cr-btn ghost" onClick={() => setOffset(offset - 1)}>←</button>
        <span className="cr-serif" style={{ fontSize: 15, minWidth: 130, textAlign: "center" }}>{range.label}</span>
        <button className="cr-btn ghost" onClick={() => setOffset(offset + 1)}>→</button>
        {offset !== 0 && <button className="cr-btn ghost" onClick={() => setOffset(0)}>atual</button>}
      </div>

      <div className="cr-grid cr-grid-3" style={{ marginBottom: 16 }}>
        <SummaryCard title="Tarefas realizadas" done={tasksDone} planned={periodTasks.length} note="tarefas planejadas" />
        <SummaryCard title="Rotinas cumpridas" done={rDoneTotal} planned={rPlannedTotal} note="etapas previstas até hoje" />
        <SummaryCard title="Geral do período" done={allDone} planned={allPlanned} note="itens planejados" />
      </div>

      <div className="cr-card" style={{ marginBottom: 16 }}>
        <h3 className="cr-serif" style={{ margin: "0 0 10px", fontSize: 15 }}>Dia a dia: planejado x realizado</h3>
        {perDay.map((x) => {
          const planned = x.tPlanned + x.rPlanned, done = x.tDone + x.rDone;
          const p = pct(done, planned);
          return (
            <div key={x.d} className="cr-row" style={{ marginBottom: 6, alignItems: "center", opacity: x.d > today && planned === 0 ? 0.5 : 1 }}>
              <span style={{ width: 86, fontSize: 12.5, fontWeight: x.d === today ? 700 : 400 }}>{WEEKDAY_LABELS[x.idx]} {fmtDateShort(x.d)}</span>
              <div className="cr-progress-track" style={{ flex: 1 }}>
                <div className="cr-progress-fill" style={{ width: `${planned ? p : 0}%`, background: progressColor(p) }} />
              </div>
              <span className="cr-sub" style={{ margin: 0, width: 150, fontSize: 11.5 }}>
                {x.tPlanned} tarefa(s), {x.d <= today ? `${x.rDone}/${x.rPlanned} rotina` : "rotina a vir"}
              </span>
            </div>
          );
        })}
      </div>

      <div className="cr-card">
        <h3 className="cr-serif" style={{ margin: "0 0 10px", fontSize: 15 }}>Ainda pendente neste período {overdue.length > 0 && <span className="cr-chip" style={{ background: "#F6DEDA", color: "#A1493C" }}>{overdue.length} atrasada(s)</span>}</h3>
        {pending.length === 0 && <p className="cr-empty">Tudo que foi planejado neste período está feito. 🎉</p>}
        {pending.map((t) => (
          <div className="cr-list-row" key={t.id}>
            <div className="cr-checkbox" onClick={() => setTasks(toggleTaskDone(tasks, t.id))} />
            <span className="cr-list-title" style={{ flex: 1 }}>{t.title}</span>
            <PriorityChip id={t.priority} />
            <span className="cr-chip" style={t.dueDate < today ? { background: "#F6DEDA", color: "#A1493C" } : undefined}>{fmtDateShort(t.dueDate)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlanningHub({ tasks, setTasks, routines, setRoutines, areas, initial, gcal, setGcal }) {
  const [section, setSection] = useState(initial || "tarefas");
  return (
    <div>
      <div>
        <h1 className="cr-h1 cr-serif">Planejamento e Rotinas</h1>
        <p className="cr-sub">Tarefas, períodos, rotinas e o acompanhamento do que você planejou e realizou, tudo no mesmo lugar.</p>
      </div>
      <div className="cr-tabbar" style={{ marginTop: 12 }}>
        <button className={`cr-tabbtn ${section === "tarefas" ? "active" : ""}`} onClick={() => setSection("tarefas")}>Tarefas e períodos</button>
        <button className={`cr-tabbtn ${section === "rotinas" ? "active" : ""}`} onClick={() => setSection("rotinas")}>Rotinas</button>
        <button className={`cr-tabbtn ${section === "acompanhamento" ? "active" : ""}`} onClick={() => setSection("acompanhamento")}>Acompanhamento</button>
      </div>
      {section === "tarefas" && <TasksView embedded tasks={tasks} setTasks={setTasks} areas={areas} />}
      {section === "rotinas" && <RoutinesView embedded routines={routines} setRoutines={setRoutines} gcal={gcal} setGcal={setGcal} />}
      {section === "acompanhamento" && <PlanningTracker tasks={tasks} setTasks={setTasks} routines={routines} />}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* PÁGINAS CRIADAS POR VOCÊ                                               */
/* ---------------------------------------------------------------------- */

function CustomPageView({ page, setPage }) {
  const [newItem, setNewItem] = useState("");
  const checklist = page.checklist || [];
  const links = page.links || [];
  const done = checklist.filter((c) => c.done).length;
  const pct = checklist.length ? Math.round((done / checklist.length) * 100) : 0;
  const addItem = () => {
    if (!newItem.trim()) return;
    setPage({ ...page, checklist: [...checklist, { id: uid(), text: newItem.trim(), done: false }] });
    setNewItem("");
  };
  return (
    <div>
      <input className="cr-input cr-serif" value={page.name} onChange={(e) => setPage({ ...page, name: e.target.value })}
        style={{ fontSize: 28, fontWeight: 600, border: "none", background: "transparent", padding: 0, width: "100%" }} placeholder="Nome da página" />
      <p className="cr-sub">Página sua: anotações, checklist e links. Tudo é salvo automaticamente.</p>

      <div className="cr-grid cr-grid-2" style={{ marginTop: 14 }}>
        <div className="cr-card">
          <h3 className="cr-serif" style={{ margin: "0 0 8px", fontSize: 15 }}>Anotações</h3>
          <textarea className="cr-textarea" style={{ minHeight: 260 }} value={page.notes || ""} onChange={(e) => setPage({ ...page, notes: e.target.value })} placeholder="Escreva o que quiser aqui…" />
        </div>
        <div>
          <div className="cr-card" style={{ marginBottom: 14 }}>
            <h3 className="cr-serif" style={{ margin: "0 0 8px", fontSize: 15 }}>Checklist {checklist.length > 0 && <span className="cr-sub" style={{ margin: 0 }}>({done}/{checklist.length})</span>}</h3>
            {checklist.length > 0 && <div className="cr-progress-track" style={{ marginBottom: 8 }}><div className="cr-progress-fill" style={{ width: `${pct}%`, background: progressColor(pct) }} /></div>}
            {checklist.map((c) => (
              <div className="cr-list-row" key={c.id}>
                <div className={`cr-checkbox ${c.done ? "checked" : ""}`} onClick={() => setPage({ ...page, checklist: checklist.map((x) => x.id === c.id ? { ...x, done: !x.done } : x) })}>{c.done && <Check size={13} />}</div>
                <input className="cr-input" style={{ border: "none", background: "transparent", textDecoration: c.done ? "line-through" : "none" }} value={c.text}
                  onChange={(e) => setPage({ ...page, checklist: checklist.map((x) => x.id === c.id ? { ...x, text: e.target.value } : x) })} />
                <PrioritySelect value={c.priority} onChange={(v) => setPage({ ...page, checklist: checklist.map((x) => x.id === c.id ? { ...x, priority: v } : x) })} />
                <button className="cr-btn ghost danger" onClick={() => setPage({ ...page, checklist: checklist.filter((x) => x.id !== c.id) })}><Trash2 size={13} /></button>
              </div>
            ))}
            <div className="cr-row" style={{ marginTop: 8 }}>
              <input className="cr-input" placeholder="Novo item…" value={newItem} onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addItem(); }} />
              <button className="cr-btn" onClick={addItem}><Plus size={13} /></button>
            </div>
          </div>
          <div className="cr-card">
            <h3 className="cr-serif" style={{ margin: "0 0 8px", fontSize: 15 }}>Links</h3>
            {links.map((l) => (
              <div key={l.id} style={{ marginBottom: 10 }}>
                <div className="cr-row" style={{ marginBottom: 4 }}>
                  <input className="cr-input" style={{ maxWidth: 140 }} placeholder="Nome" value={l.label} onChange={(e) => setPage({ ...page, links: links.map((x) => x.id === l.id ? { ...x, label: e.target.value } : x) })} />
                  <input className="cr-input" placeholder="https://…" value={l.url} onChange={(e) => setPage({ ...page, links: links.map((x) => x.id === l.id ? { ...x, url: e.target.value } : x) })} />
                  <button className="cr-btn ghost danger" onClick={() => setPage({ ...page, links: links.filter((x) => x.id !== l.id) })}><Trash2 size={13} /></button>
                </div>
                {l.url && <button className="cr-btn primary" style={{ width: "100%", justifyContent: "center" }} onClick={() => openExternalLink(siteUrl(l.url))}><Link2 size={14} /> {l.label || "Abrir link"}</button>}
              </div>
            ))}
            <button className="cr-btn" onClick={() => setPage({ ...page, links: [...links, { id: uid(), label: "", url: "" }] })}><Plus size={13} /> Adicionar link</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PageDeleteModal({ name, builtin, onConfirm, onCancel }) {
  const [wipe, setWipe] = useState(false);
  return (
    <Modal size="small" title="Excluir página" onClose={onCancel}>
      <p style={{ fontSize: 14, lineHeight: 1.5, marginTop: 0 }}>
        Excluir a página <strong>{name}</strong>? Ela some da Central e da busca.{builtin ? "" : " Todo o conteúdo dela será apagado."}
      </p>
      {builtin && (
        <label className="cr-row" style={{ cursor: "pointer", alignItems: "flex-start", marginBottom: 6 }}>
          <input type="checkbox" checked={wipe} onChange={() => setWipe(!wipe)} style={{ marginTop: 3 }} />
          <span style={{ fontSize: 13.5 }}>Apagar também tudo que está salvo nela, sem volta</span>
        </label>
      )}
      {builtin && <p className="cr-sub" style={{ marginTop: 0 }}>Se não marcar, os dados ficam guardados e voltam se você restaurar a página em Configurações.</p>}
      <div className="cr-row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button className="cr-btn" onClick={onCancel}>Cancelar</button>
        <button className="cr-btn primary" style={{ background: "#A1493C" }} onClick={() => onConfirm(wipe)}>Excluir página</button>
      </div>
    </Modal>
  );
}

function PageNameModal({ item, onSave, onClose }) {
  const [form, setForm] = useState(item || { name: "" });
  const autoStatus = useAutoSave(form, (data) => { if ((data.name || "").trim()) onSave(data); });
  return (
    <Modal size="small" title={item ? "Renomear página" : "Nova página"} onClose={onClose}>
      <div className="cr-field"><label className="cr-label">Nome da página</label>
        <input className="cr-input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ex: Viagem, Casa nova, Livros…" /></div>
      <AutoSaveFooter status={autoStatus} onClose={onClose} />
    </Modal>
  );
}

// Página de um dia de treino: registre exercícios, séries, repetições, carga, duração e o que mais quiser
function WorkoutDayPage({ routine, step, onChange, onClose }) {
  const [date, setDate] = useState(todayStr());
  const sessions = step.sessions || {};
  const day = sessions[date] || { exercises: [], notes: "", extras: [] };
  const setDay = (d) => onChange({ ...step, sessions: { ...sessions, [date]: d } });
  const upd = (id, field, v) => setDay({ ...day, exercises: day.exercises.map((e) => (e.id === id ? { ...e, [field]: v } : e)) });
  const addExercise = () => setDay({ ...day, exercises: [...day.exercises, { id: uid(), name: "", sets: "", reps: "", load: "", duration: "", status: "planejado", notes: "" }] });
  const previousDates = Object.keys(sessions).filter((d) => d < date && (sessions[d].exercises || []).length).sort().reverse();
  const allDates = Object.keys(sessions).filter((d) => (sessions[d].exercises || []).length || sessions[d].notes).sort().reverse();
  const copyLast = () => {
    const last = sessions[previousDates[0]];
    setDay({ ...day, exercises: [...day.exercises, ...last.exercises.map((e) => ({ ...e, id: uid(), status: "planejado" }))] });
  };
  const extras = day.extras || [];
  const doneCount = day.exercises.filter((e) => e.status === "feito").length;

  return (
    <Modal title={`${routine.name}: ${stepLabel(step)}`} onClose={onClose}>
      <div className="cr-row" style={{ alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <button className="cr-btn ghost" onClick={() => setDate(addDays(date, -1))}>←</button>
        <input type="date" className="cr-input" style={{ maxWidth: 170 }} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <button className="cr-btn ghost" onClick={() => setDate(addDays(date, 1))}>→</button>
        {date !== todayStr() && <button className="cr-btn ghost" onClick={() => setDate(todayStr())}>hoje</button>}
        <span className="cr-sub" style={{ margin: 0 }}>{day.exercises.length ? `${doneCount} de ${day.exercises.length} exercícios feitos` : "Nenhum exercício registrado neste dia"}</span>
      </div>

      {day.exercises.map((e, i) => (
        <div key={e.id} className="cr-card" style={{ marginBottom: 10, padding: 14 }}>
          <div className="cr-row" style={{ alignItems: "center" }}>
            <span className="cr-sub" style={{ margin: 0, width: 22 }}>{i + 1}.</span>
            <input className="cr-input" placeholder="Exercício (ex: Agachamento)" value={e.name} onChange={(ev) => upd(e.id, "name", ev.target.value)} />
            <button className="cr-btn ghost danger" onClick={() => setDay({ ...day, exercises: day.exercises.filter((x) => x.id !== e.id) })}><Trash2 size={13} /></button>
          </div>
          <div className="cr-row" style={{ marginTop: 8, flexWrap: "wrap" }}>
            <div className="cr-field" style={{ flex: "1 1 80px", margin: 0 }}><label className="cr-label">Séries</label>
              <input type="number" className="cr-input" value={e.sets} onChange={(ev) => upd(e.id, "sets", ev.target.value)} /></div>
            <div className="cr-field" style={{ flex: "1 1 80px", margin: 0 }}><label className="cr-label">Repetições</label>
              <input className="cr-input" value={e.reps} onChange={(ev) => upd(e.id, "reps", ev.target.value)} placeholder="ex: 12" /></div>
            <div className="cr-field" style={{ flex: "1 1 90px", margin: 0 }}><label className="cr-label">Carga (kg)</label>
              <input className="cr-input" value={e.load} onChange={(ev) => upd(e.id, "load", ev.target.value)} /></div>
            <div className="cr-field" style={{ flex: "1 1 90px", margin: 0 }}><label className="cr-label">Duração (min)</label>
              <input className="cr-input" value={e.duration} onChange={(ev) => upd(e.id, "duration", ev.target.value)} /></div>
            <div className="cr-field" style={{ flex: "1 1 170px", margin: 0 }}><label className="cr-label">Status</label>
              <ManagedSelect listKey="workoutStatus" value={e.status} onChange={(v) => upd(e.id, "status", v)} /></div>
          </div>
          <input className="cr-input" style={{ marginTop: 8 }} placeholder="Observações deste exercício" value={e.notes} onChange={(ev) => upd(e.id, "notes", ev.target.value)} />
        </div>
      ))}
      <div className="cr-row" style={{ marginBottom: 16, flexWrap: "wrap" }}>
        <button className="cr-btn primary" onClick={addExercise}><Plus size={14} /> Adicionar exercício</button>
        {previousDates.length > 0 && (
          <button className="cr-btn" onClick={copyLast}>Copiar do último treino ({fmtDateShort(previousDates[0])})</button>
        )}
      </div>

      <div className="cr-field"><label className="cr-label">Outros detalhes do dia (a coluna que você quiser)</label>
        {extras.map((x) => (
          <div className="cr-row" key={x.id} style={{ marginBottom: 6 }}>
            <input className="cr-input" style={{ maxWidth: 180 }} placeholder="ex: Sono, Energia, Peso" value={x.label} onChange={(e) => setDay({ ...day, extras: extras.map((y) => y.id === x.id ? { ...y, label: e.target.value } : y) })} />
            <input className="cr-input" placeholder="valor" value={x.value} onChange={(e) => setDay({ ...day, extras: extras.map((y) => y.id === x.id ? { ...y, value: e.target.value } : y) })} />
            <button className="cr-btn ghost danger" onClick={() => setDay({ ...day, extras: extras.filter((y) => y.id !== x.id) })}><Trash2 size={13} /></button>
          </div>
        ))}
        <button className="cr-btn" onClick={() => setDay({ ...day, extras: [...extras, { id: uid(), label: "", value: "" }] })}><Plus size={13} /> Adicionar detalhe</button>
      </div>
      <div className="cr-field"><label className="cr-label">Observações do treino</label>
        <textarea className="cr-textarea" value={day.notes || ""} onChange={(e) => setDay({ ...day, notes: e.target.value })} placeholder="Como foi o treino, o que melhorar…" /></div>

      {allDates.length > 0 && (
        <div className="cr-field"><label className="cr-label">Histórico deste dia da semana</label>
          <div className="cr-row" style={{ flexWrap: "wrap", gap: 6 }}>
            {allDates.map((d) => (
              <button key={d} className={`cr-tabbtn ${d === date ? "active" : ""}`} onClick={() => setDate(d)}>
                {fmtDateShort(d)} ({(sessions[d].exercises || []).length})
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="cr-sub" style={{ marginTop: 14 }}>✓ Tudo é salvo automaticamente.</p>
    </Modal>
  );
}

function RoutineModal({ routine, onSave, onClose }) {
  const [form, setForm] = useState(routine
    ? { ...routine, steps: routine.steps.map((st) => (st.start ? st : { ...st, ...stepStartEnd(st) })) }
    : { name: "", steps: [] });
  const autoStatus = useAutoSave(form, onSave, undefined);
  const addStep = () => setForm({ ...form, steps: [...form.steps, { id: uid(), text: "", time: "", start: "", end: "", category: "", days: [0, 1, 2, 3, 4, 5, 6], done: false }] });
  const setTimes = (id, patch) => setForm({ ...form, steps: form.steps.map((st) => {
    if (st.id !== id) return st;
    const n = { ...st, ...patch };
    n.time = n.start ? (n.end ? `${n.start} – ${n.end}` : n.start) : "";
    return n;
  }) });
  const updateStep = (id, field, value) => setForm({ ...form, steps: form.steps.map((s) => s.id === id ? { ...s, [field]: value } : s) });
  const removeStep = (id) => setForm({ ...form, steps: form.steps.filter((s) => s.id !== id) });
  const toggleDay = (step, day) => {
    const current = stepDays(step);
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort((a, b) => a - b);
    updateStep(step.id, "days", next.length ? next : current);
  };

  return (
    <Modal title={routine ? "Editar rotina" : "Nova rotina"} onClose={onClose}>
      <div className="cr-field"><label className="cr-label">Nome da rotina</label>
        <input className="cr-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ex: Rotina da manhã" /></div>
      <label className="cr-label">Etapas (marque os dias da semana em que cada uma acontece)</label>
      {form.steps.map((s) => {
        const days = stepDays(s);
        return (
          <div key={s.id} style={{ marginBottom: 12, paddingBottom: 10, borderBottom: "1px solid var(--line)" }}>
            <div className="cr-row" style={{ marginBottom: 6 }}>
              <button className="cr-btn ghost" style={{ padding: "4px 6px" }} title="Subir etapa" disabled={form.steps.indexOf(s) === 0} onClick={() => setForm({ ...form, steps: moveItem(form.steps, form.steps.indexOf(s), -1) })}>↑</button>
              <button className="cr-btn ghost" style={{ padding: "4px 6px" }} title="Descer etapa" disabled={form.steps.indexOf(s) === form.steps.length - 1} onClick={() => setForm({ ...form, steps: moveItem(form.steps, form.steps.indexOf(s), 1) })}>↓</button>
              <input className="cr-input" placeholder="Etapa" value={s.text} onChange={(e) => updateStep(s.id, "text", e.target.value)} />
              <button className="cr-btn ghost danger" onClick={() => removeStep(s.id)}><Trash2 size={13} /></button>
            </div>
            <div className="cr-row" style={{ marginBottom: 6, flexWrap: "wrap", alignItems: "center" }}>
              <label className="cr-sub" style={{ margin: 0 }}>Início</label>
              <input type="time" className="cr-input" style={{ maxWidth: 120 }} value={s.start || ""} onChange={(e) => setTimes(s.id, { start: e.target.value })} />
              <label className="cr-sub" style={{ margin: 0 }}>Término</label>
              <input type="time" className="cr-input" style={{ maxWidth: 120 }} value={s.end || ""} onChange={(e) => setTimes(s.id, { end: e.target.value })} />
              <div style={{ minWidth: 220, flex: 1 }}>
                <ManagedSelect listKey="routineCategory" value={s.category || stepCategoryId(s)} onChange={(v) => updateStep(s.id, "category", v)} />
              </div>
            </div>
            <div className="cr-row" style={{ flexWrap: "wrap", gap: 4 }}>
              {WEEKDAY_LABELS.map((l, d) => (
                <button key={d} type="button" onClick={() => toggleDay(s, d)} className="cr-chip"
                  style={{ cursor: "pointer", border: "none", background: days.includes(d) ? "var(--clay)" : undefined, color: days.includes(d) ? "#fff" : undefined }}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      <button className="cr-btn" style={{ marginBottom: 12 }} onClick={addStep}><Plus size={13} /> Adicionar etapa</button>
      <AutoSaveFooter status={autoStatus} onClose={onClose} />
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/* BELEZA & AUTOCUIDADO                                                    */
/* ---------------------------------------------------------------------- */

function inferBeautyKind(b) {
  if (b.kind) return b.kind;
  const cat = (b.category || "").toLowerCase();
  if (cat.includes("procedimento") || cat.includes("tratamento")) return "procedimento";
  if (["cabelo", "vida organizada", "estilo e imagem pessoal", "olhos e sobrancelhas", "rosto", "corpo e confiança"].includes(cat)) return "objetivo";
  return "produto";
}

const PROC_STATUS_META = [
  { key: "quero", label: "Quero fazer" },
  { key: "vou", label: "Vou fazer" },
  { key: "avaliacao", label: "Comentei / estou avaliando" },
  { key: "jafiz", label: "Já fiz" },
  { key: "novamente", label: "Quero fazer novamente" },
  { key: "pausado", label: "Avaliação pausada" },
  { key: "nunca", label: "Nunca mais vou fazer" },
  { key: "talvez", label: "Talvez mais para frente" },
];

function inferProcStatus(b) {
  if (b.procStatus && b.procStatus !== "recorrente") return b.procStatus;
  if (b.procStatus === "recorrente") return "jafiz";
  const n = ((b.notes || "") + " " + (b.status || "")).toLowerCase();
  if (n.includes("faria de novo")) return "novamente";
  if (n.includes("interrompido")) return "pausado";
  if (n.includes("em andamento") || n.includes("manutenção") || n.includes("feito") || n.includes("comprei")) return "jafiz";
  return "quero";
}

// "Recorrentes" deixou de ser um status (agora é o botão "Procedimento recorrente?").
// Quem estava nele vira "Já fiz" e, se a frequência estava escrita nas observações, ela é aproveitada.
function normalizeProcedureStatuses(beauty) {
  let changed = false;
  const out = beauty.map((b) => {
    if (b.procStatus !== "recorrente") return b;
    changed = true;
    const text = ((b.notes || "") + " " + (b.frequency || "")).toLowerCase();
    const m = text.match(/a cada (\d+)\s*(?:meses|mes|mês)/);
    const next = { ...b, procStatus: "jafiz" };
    if (m && !b.recurring) { next.recurring = true; next.frequencyUnit = "meses"; next.frequencyValue = Number(m[1]); }
    return next;
  });
  return changed ? out : beauty;
}

// Move os itens de "produto/rotina" de Procedimentos Estéticos para a Wishlist
// (rodou uma vez, aditivo — não duplica nem apaga nada)
function migrateBeautyToWishlist(beauty, shopping) {
  const remaining = [];
  const moved = [];
  beauty.forEach((b) => {
    const kind = inferBeautyKind(b);
    if (kind === "produto") {
      moved.push({
        id: uid(), name: b.name, category: b.category || "", store: "", price: Number(b.cost) || 0,
        priority: "media", link: b.link || "", status: "desejado", desiredDate: "", notes: b.notes || "",
      });
    } else {
      remaining.push({ ...b, kind, procStatus: kind === "procedimento" ? inferProcStatus(b) : undefined });
    }
  });
  return { beauty: remaining, shopping: [...moved, ...shopping] };
}

// Move os "objetivos" de Procedimentos Estéticos para Self-Care & Bem-estar —
// Procedimentos Estéticos passa a ser só sobre procedimentos de verdade.
function migrateBeautyObjectivesToSelfcare(beauty, selfcare) {
  const remaining = [];
  const moved = [];
  beauty.forEach((b) => {
    const kind = inferBeautyKind(b);
    if (kind === "objetivo") {
      const content = [b.goal, b.notes].filter(Boolean).join(" — ") || b.name;
      moved.push({ id: uid(), title: b.name, category: b.category || "objetivo estético", content, image: b.image || "" });
    } else {
      remaining.push(b);
    }
  });
  return { beauty: remaining, selfcare: [...moved, ...selfcare] };
}

// Nomes específicos que são produtos, não procedimentos — some pra Wishlist
// mesmo que já estivessem marcados como procedimento (dados antigos importados errado).
const KNOWN_PRODUCT_NAMES = [
  "blush", "mousse de limpeza", "protetor solar neides", "creme ácido glicólico",
  "gel definidor", "creme de cabelo", "tratamento noturno", "leave-in", "leave in",
  "creme de definição",
];
// Palavras que, aparecendo no nome, indicam produto (não procedimento) — usado só
// pra identificar itens antigos/importados sem marcação, nunca bloqueia o que a
// usuária cadastra manualmente daqui pra frente.
const PRODUCT_NAME_HINTS = ["creme", "gel ", "protetor solar", "leave-in", "leave in", "mousse", "blush", "shampoo", "condicionador", "hidratante", "sérum", "serum"];

function looksLikeProductName(name) {
  const n = (name || "").toLowerCase();
  if (KNOWN_PRODUCT_NAMES.includes(n)) return true;
  return PRODUCT_NAME_HINTS.some((hint) => n.includes(hint));
}

function migrateNamedProductsToWishlist(beauty, shopping) {
  const remaining = [];
  const moved = [];
  beauty.forEach((b) => {
    if (looksLikeProductName(b.name)) {
      moved.push({
        id: uid(), name: b.name, category: b.category || "", store: "", price: Number(b.cost) || 0,
        priority: "media", link: b.link || "", status: "desejado", desiredDate: "", notes: b.notes || "",
      });
    } else {
      remaining.push(b);
    }
  });
  return { beauty: remaining, shopping: [...moved, ...shopping] };
}

// Converte procedimentos do formato antigo (frequencyMonths, campos soltos) pro
// novo formato com histórico de realizações e frequência em unidade+valor.
function migrateBeautyToHistoryFormat(beauty) {
  return beauty.map((b) => {
    if (b.history) return b; // já está no formato novo
    const hasOldFrequency = !!b.frequencyMonths;
    const history = b.dateDone
      ? [{ id: uid(), date: b.dateDone, professional: b.professional || "", clinic: "", cost: Number(b.cost) || 0, notes: b.notes || "", result: b.result || "" }]
      : [];
    return {
      ...b,
      recurring: hasOldFrequency,
      frequencyUnit: "meses",
      frequencyValue: hasOldFrequency ? Number(b.frequencyMonths) : "",
      alertDays: DEFAULT_ALERT_DAYS,
      history,
    };
  });
}

// Classificação automática: o que é produto/objetivo (e não procedimento) sai de
// Procedimentos Estéticos. Só mexe em itens vindos do Notion ou sem status de procedimento,
// então nada que você cadastrou como procedimento é movido por engano.
const PRODUCT_CATEGORIES = ["skin care", "hair care", "skincare", "haircare", "maquiagem", "makeup", "produto", "produtos"];
const STRONG_PRODUCT_HINTS = ["protetor solar", "leave-in", "leave in", "mousse", "blush", "balm", "gel definidor", "creme ", "creme(", "creamy", "shampoo", "condicionador", "hidratante", "sérum", "serum", "batom", "tratamento noturno"];

function isProductItem(b) {
  if (!(b.notionImported || !b.procStatus)) return false;
  const name = (b.name || "").trim().toLowerCase();
  const cat = (b.category || "").trim().toLowerCase();
  if (KNOWN_PRODUCT_NAMES.includes(name)) return true;
  if (PRODUCT_CATEGORIES.includes(cat)) return true;
  const procCategory = cat.includes("procedimento") || cat.includes("tratamento est");
  return !procCategory && STRONG_PRODUCT_HINTS.some((h) => (name + " ").includes(h));
}

function rerouteBeautyItems(beauty, shopping, selfcare) {
  const keep = [];
  const toShop = [];
  const toSelf = [];
  beauty.forEach((b) => {
    if (isProductItem(b)) toShop.push(b);
    else if ((b.notionImported || !b.procStatus) && inferBeautyKind(b) === "objetivo") toSelf.push(b);
    else keep.push(b);
  });
  const shopNames = new Set(shopping.map((s) => (s.name || "").trim().toLowerCase()));
  const selfTitles = new Set(selfcare.map((s) => (s.title || "").trim().toLowerCase()));
  const newShop = [];
  toShop.forEach((b) => {
    const key = (b.name || "").trim().toLowerCase();
    if (shopNames.has(key)) return;
    shopNames.add(key);
    newShop.push({
      id: uid(), name: b.name, category: b.category || "", store: "", price: Number(b.cost) || 0,
      priority: "media", link: b.link || "", kind: "rotina", status: parseProductStatus(b.notes) || "ainda tem",
      desiredDate: "", notes: b.notes || "",
    });
  });
  const newSelf = [];
  toSelf.forEach((b) => {
    const key = (b.name || "").trim().toLowerCase();
    if (selfTitles.has(key)) return;
    selfTitles.add(key);
    newSelf.push({
      id: uid(), title: b.name, category: b.category || "objetivo estético",
      content: [b.goal, b.notes].filter(Boolean).join(" · ") || b.name, image: b.image || "",
    });
  });
  return {
    beauty: keep,
    shopping: newShop.length ? [...newShop, ...shopping] : shopping,
    selfcare: newSelf.length ? [...newSelf, ...selfcare] : selfcare,
    changed: toShop.length > 0 || toSelf.length > 0,
  };
}

function addDaysStr(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + Number(days));
  return localDateStr(d);
}

const FREQUENCY_PRESETS = [
  { key: "semanal", label: "Semanal", unit: "dias", value: 7 },
  { key: "quinzenal", label: "Quinzenal", unit: "dias", value: 14 },
  { key: "mensal", label: "Mensal", unit: "meses", value: 1 },
  { key: "2meses", label: "A cada 2 meses", unit: "meses", value: 2 },
  { key: "3meses", label: "A cada 3 meses", unit: "meses", value: 3 },
  { key: "6meses", label: "A cada 6 meses", unit: "meses", value: 6 },
  { key: "anual", label: "Anual", unit: "meses", value: 12 },
  { key: "custom", label: "Personalizada (em dias)", unit: "dias", value: null },
];

const ALERT_DAYS_OPTIONS = [30, 14, 7, 3, 0];
const DEFAULT_ALERT_DAYS = [14, 7, 0];

function nextMaintenanceDate(dateDone, frequencyUnit, frequencyValue) {
  if (!dateDone || !frequencyValue) return null;
  return frequencyUnit === "meses" ? addMonths(dateDone, Number(frequencyValue)) : addDaysStr(dateDone, Number(frequencyValue));
}

// Calcula o status de manutenção com base nos dias de antecedência configurados
// pela usuária (ex: avisar 30/14/7/3/0 dias antes).
function maintenanceStatus(b) {
  if (!b.recurring) return null;
  const next = nextMaintenanceDate(b.dateDone, b.frequencyUnit, b.frequencyValue);
  if (!next) return null;
  const today = todayStr();
  const daysUntil = Math.round((new Date(next + "T00:00:00") - new Date(today + "T00:00:00")) / 86400000);
  if (daysUntil < 0) return { level: "atrasado", date: next, daysUntil };
  const sortedAlerts = (b.alertDays && b.alertDays.length ? b.alertDays : DEFAULT_ALERT_DAYS).slice().sort((x, y) => x - y);
  if (daysUntil === 0) return { level: "hoje", date: next, daysUntil: 0 };
  const closest = sortedAlerts.filter((n) => daysUntil <= n).sort((x, y) => x - y)[0];
  if (closest !== undefined) return { level: "proxima", date: next, daysUntil, threshold: closest };
  return { level: "em dia", date: next, daysUntil };
}

function statusEmoji(level) {
  if (level === "atrasado") return "🔴";
  if (level === "hoje" || level === "proxima") return "🟡";
  if (level === "em dia") return "🟢";
  return "";
}

function statusMessage(m, name) {
  if (!m) return "";
  if (m.level === "atrasado") return `⚠️ Manutenção atrasada: seu(a) ${name} está atrasado(a) desde ${fmtDateShort(m.date)}.`;
  if (m.level === "hoje") return `✨ Está na hora de fazer seu(a) ${name} novamente!`;
  if (m.level === "proxima") return `Seu(a) ${name} está chegando na data de manutenção (${fmtDateShort(m.date)}, faltam ${m.daysUntil}d).`;
  return `Em dia, próxima manutenção em ${fmtDateShort(m.date)}.`;
}

// Gera e baixa um arquivo .ics (compatível com Google Calendar, Apple Calendar etc.)
// pra usuária importar manualmente. Nunca cria evento sozinho, é sempre uma ação dela.
async function downloadICS(title, dateStr, notes) {
  const dt = dateStr.replace(/-/g, "");
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Central//Procedimentos//PT",
    "BEGIN:VEVENT",
    `UID:${uid()}@central`,
    `DTSTART;VALUE=DATE:${dt}`,
    `DTEND;VALUE=DATE:${dt}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${(notes || "").replace(/\n/g, "\\n")}`,
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  try {
    const blob = new Blob([ics], { type: "text/calendar" });
    await shareOrDownloadFile(blob, `${title.replace(/[^a-z0-9]+/gi, "-")}.ics`, title);
  } catch (e) {
    notify("Não consegui gerar o arquivo do calendário. Copie a data manualmente: " + fmtDateShort(dateStr));
  }
}

const REGION_OPTIONS = ["Facial", "Corporal"];
const DEGREE_OPTIONS = ["Invasivo", "Minimamente invasivo", "Não invasivo"];
const PRICE_BANDS = ["Sem valor", "Até R$ 150", "R$ 151 a 400", "R$ 401 a 800", "R$ 801 a 1.500", "Acima de R$ 1.500"];

function priceBand(cost) {
  const c = Number(cost) || 0;
  if (c <= 0) return "Sem valor";
  const bands = getPriceBands();
  const hit = bands.find((b) => b.max !== null && b.max !== undefined && b.max !== "" && c <= Number(b.max)) || bands.find((b) => b.max === null || b.max === undefined || b.max === "");
  return hit ? hit.name : "Sem faixa";
}

// Facial ou corporal: usa o que você marcou; se não marcou, tenta entender pelo nome/área.
function inferRegion(b) {
  if (b.region) return b.region;
  const t = ((b.name || "") + " " + (b.bodyArea || "") + " " + (b.category || "") + " " + (b.goal || "")).toLowerCase();
  const body = ["glúte", "glute", "abdôm", "abdom", "criolip", "drenagem", "depila", "lipo", "coxa", "perna", "braço", "corporal", "celulite", "barriga", "bumbum", "costas", "modelagem", "volumizador"];
  const face = ["facial", "rosto", "lash", "cílio", "cilio", "sobrancelh", "labial", "lábio", "labio", "nariz", "olho", "olheira", "botox", "skinbooster", "testa", "dental", "dente", "nanoblading", "micropigment", "pálpebra", "face", "liplase", "bigode", "ácido hialurônico", "acido hialuronico"];
  if (body.some((k) => t.includes(k))) return "Corporal";
  if (face.some((k) => t.includes(k))) return "Facial";
  return "";
}

function instagramUrl(v) {
  if (!v) return "";
  const t = v.trim();
  if (/^https?:\/\//i.test(t)) return t;
  return "https://instagram.com/" + t.replace(/^@/, "").replace(/\/$/, "");
}
function siteUrl(v) {
  if (!v) return "";
  const t = v.trim();
  return /^https?:\/\//i.test(t) ? t : "https://" + t;
}
function mapsUrl(addr) { return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(addr || ""); }

function placeOf(b, places) {
  return (places || []).find((p) => p.id === b.placeId) || null;
}

function BeautyView({ beauty, setBeauty, places, setPlaces, settings, setSettings }) {
  const ctx = useContext(ListsContext);
  const [section, setSection] = useState("procedimentos");
  const [editing, setEditing] = useState(null);
  const [registering, setRegistering] = useState(null);
  const [f, setF] = useState({ status: "todos", area: "todos", tipo: "todos", preco: "todos", local: "todos" });
  const setFilter = (k) => (v) => setF((cur) => ({ ...cur, [k]: v }));
  const [customize, setCustomize] = useState(false);
  const on = (k) => cardFieldOn(settings || {}, k);
  const liveEditing = editing && editing !== "new" ? (beauty.find((x) => x.id === editing.id) || editing) : null;

  const save = (data) => { setBeauty(upsertById(beauty, { ...data, userEdited: true }, { history: data.history || [] })); };
  const remove = (id) => setBeauty(beauty.filter((x) => x.id !== id));
  const originalOf = (b) => beauty.find((x) => x.id === b.id);

  const saveRealization = (procedureId, entry) => {
    setBeauty(beauty.map((b) => {
      if (b.id !== procedureId) return b;
      const history = [{ ...entry, id: uid() }, ...(b.history || [])].sort((x, y) => y.date.localeCompare(x.date));
      const latest = history[0];
      return {
        ...b, userEdited: true, history, dateDone: latest.date, professional: latest.professional,
        clinic: latest.clinic, cost: latest.cost, notes: latest.notes, result: latest.result,
      };
    }));
    setRegistering(null);
  };

  const statusList = getList("procStatus");
  const procedures = beauty.map((b) => {
    const pl = placeOf(b, places);
    const st = inferProcStatus(b);
    return { ...b, _status: statusList.some((x) => x.id === st) ? st : "", _region: inferRegion(b), _band: priceBand(b.cost), _place: pl ? pl.name : (b.clinic || ""), _placeObj: pl };
  });
  const totalCost = procedures.reduce((sum, x) => sum + Number(x.cost || 0), 0);
  const placeNames = Array.from(new Set(procedures.map((p) => p._place).filter(Boolean)));

  const matches = (p, except) =>
    (except === "status" || f.status === "todos" || (f.status === "nd" ? !p._status : p._status === f.status)) &&
    (except === "area" || f.area === "todos" || (f.area === "nd" ? !p._region : p._region === f.area)) &&
    (except === "tipo" || f.tipo === "todos" || (f.tipo === "nd" ? !p.degree : p.degree === f.tipo)) &&
    (except === "preco" || f.preco === "todos" || p._band === f.preco) &&
    (except === "local" || f.local === "todos" || p._place === f.local);
  const count = (key, pred) => procedures.filter((p) => matches(p, key) && pred(p)).length;
  const filtered = procedures.filter((p) => matches(p));

  const withNd = (opts, key, label, pred) => (count(key, pred) > 0 ? [...opts, { value: "nd", label, count: count(key, pred) }] : opts);
  const groups = [
    { key: "status", label: "Status", value: f.status, onChange: setFilter("status"), onManage: () => ctx.openManager("procStatus"),
      options: withNd(statusList.map((s) => ({ value: s.id, label: s.name, count: count("status", (p) => p._status === s.id) })), "status", "Sem status", (p) => !p._status) },
    { key: "area", label: "Área", value: f.area, onChange: setFilter("area"), onManage: () => ctx.openManager("procRegion"),
      options: withNd(getList("procRegion").map((r) => ({ value: r.id, label: r.name, count: count("area", (p) => p._region === r.id) })), "area", "Não definida", (p) => !p._region) },
    { key: "tipo", label: "Tipo", value: f.tipo, onChange: setFilter("tipo"), onManage: () => ctx.openManager("procDegree"),
      options: withNd(getList("procDegree").map((r) => ({ value: r.id, label: r.name, count: count("tipo", (p) => p.degree === r.id) })), "tipo", "Não definido", (p) => !p.degree) },
    { key: "preco", label: "Preço", value: f.preco, onChange: setFilter("preco"), onManage: () => ctx.openPrices(),
      options: [...getPriceBands().map((b) => ({ value: b.name, label: b.name, count: count("preco", (p) => p._band === b.name) })), { value: "Sem valor", label: "Sem valor", count: count("preco", (p) => p._band === "Sem valor") }] },
    { key: "local", label: "Local", value: f.local, onChange: setFilter("local"), onManage: () => setSection("lugares"),
      options: placeNames.map((n) => ({ value: n, label: n, count: count("local", (p) => p._place === n) })) },
  ];

  const dueAlerts = procedures
    .map((b) => ({ b, m: maintenanceStatus(b) }))
    .filter((x) => x.m && (x.m.level === "atrasado" || x.m.level === "hoje" || x.m.level === "proxima"))
    .sort((a, c) => a.m.date.localeCompare(c.m.date));

  const sections = [...statusList.map((s) => ({ id: s.id, label: s.name })), { id: "", label: "Sem status" }];

  return (
    <div>
      <div className="cr-row" style={{ justifyContent: "space-between" }}>
        <div><h1 className="cr-h1 cr-serif">Procedimentos Estéticos</h1><p className="cr-sub">{fmtBRL(totalCost)} investidos ao todo.</p></div>
        {section === "procedimentos" && (
          <div className="cr-row">
            <button className="cr-btn" onClick={() => setCustomize(true)}><SettingsIcon size={13} /> Personalizar card</button>
            <button className="cr-btn primary" onClick={() => setEditing("new")}><Plus size={14} /> Novo procedimento</button>
          </div>
        )}
      </div>

      <div className="cr-tabbar" style={{ marginTop: 14 }}>
        <button className={`cr-tabbtn ${section === "procedimentos" ? "active" : ""}`} onClick={() => setSection("procedimentos")}>Procedimentos</button>
        <button className={`cr-tabbtn ${section === "lugares" ? "active" : ""}`} onClick={() => setSection("lugares")}>Lugares e profissionais ({places.length})</button>
      </div>

      {section === "lugares" && <PlacesPanel places={places} setPlaces={setPlaces} beauty={beauty} setBeauty={setBeauty} />}

      {section === "procedimentos" && (
        <div>
          <FilterGroups groups={groups} defaultOpen="status" />

          {dueAlerts.length > 0 && (
            <div className="cr-card" style={{ marginBottom: 22, borderColor: "#E3B5AB" }}>
              <h3 className="cr-serif" style={{ margin: "0 0 10px", fontSize: 15, color: "#A1493C" }}>Manutenção</h3>
              {dueAlerts.map(({ b, m }) => (
                <div className="cr-list-row" key={b.id}>
                  <span className="cr-list-title" style={{ flex: 1 }}>{statusEmoji(m.level)} {b.name}</span>
                  <span className="cr-chip" style={m.level === "atrasado" ? { background: "#F6DEDA", color: "#A1493C" } : { background: "#FBEBD4", color: "#96631C" }}>
                    {statusMessage(m, b.name)}
                  </span>
                  <button className="cr-btn ghost" onClick={() => setRegistering(originalOf(b))}>+ Registrar realização</button>
                </div>
              ))}
            </div>
          )}

          {procedures.length === 0 && <p className="cr-empty">Nenhum procedimento registrado ainda.</p>}
          {procedures.length > 0 && filtered.length === 0 && <p className="cr-empty">Nenhum procedimento com esses filtros.</p>}

          {sections.map((sec) => {
            const items = filtered.filter((p) => p._status === sec.id);
            if (items.length === 0) return null;
            return (
              <div key={sec.id || "sem"} style={{ marginBottom: 22 }}>
                <SectionTitle title={sec.label} count={`${items.length} ${items.length === 1 ? "procedimento" : "procedimentos"}`} />
                <div className="cr-grid cr-grid-3">
                  {items.map((b) => (
                    <BeautyCard key={b.id} b={b} on={on} onEdit={() => setEditing(originalOf(b))} onRemove={() => remove(b.id)} onRegister={() => setRegistering(originalOf(b))} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && <BeautyModal key={liveEditing ? liveEditing.id + ":" + (liveEditing.history || []).length : "new"} item={liveEditing} places={places} onSave={save} onClose={() => setEditing(null)} onRegister={() => setRegistering(liveEditing)} />}
      {customize && <CardFieldsModal settings={settings || {}} setSettings={setSettings} onClose={() => setCustomize(false)} />}
      {registering && <RegistrarRealizacaoModal item={registering} onSave={(entry) => saveRealization(registering.id, entry)} onClose={() => setRegistering(null)} />}
    </div>
  );
}

const PROC_CARD_FIELDS = [
  { key: "image", label: "Imagem", def: true },
  { key: "region", label: "Área (facial ou corporal)", def: true },
  { key: "degree", label: "Tipo (invasivo, minimamente invasivo, não invasivo)", def: true },
  { key: "bodyArea", label: "Parte do corpo ou rosto", def: false },
  { key: "dateDone", label: "Última realização", def: true },
  { key: "frequency", label: "Frequência", def: true },
  { key: "maintenance", label: "Próxima manutenção e alerta", def: true },
  { key: "cost", label: "Valor", def: true },
  { key: "place", label: "Local e profissional", def: true },
  { key: "social", label: "Botões de Instagram e agendamento", def: false },
  { key: "goal", label: "Objetivo", def: false },
  { key: "result", label: "Resultado", def: false },
  { key: "notes", label: "Observações", def: false },
  { key: "link", label: "Link de referência", def: false },
  { key: "actions", label: "Botões: registrar realização e histórico", def: true },
];
function cardFieldOn(settings, key) {
  const v = (settings.procCardFields || {})[key];
  if (v !== undefined) return v;
  const f = PROC_CARD_FIELDS.find((x) => x.key === key);
  return f ? f.def : true;
}

function CardFieldsModal({ settings, setSettings, onClose }) {
  const set = (key, val) => setSettings({ ...settings, procCardFields: { ...(settings.procCardFields || {}), [key]: val } });
  return (
    <Modal size="small" title="Personalizar o card dos procedimentos" onClose={onClose}>
      <p className="cr-sub" style={{ marginTop: 0 }}>Escolha o que aparece no card da tela principal. Quem fica oculto continua salvo e aparece ao abrir o procedimento.</p>
      {PROC_CARD_FIELDS.map((f) => (
        <label key={f.key} className="cr-row" style={{ cursor: "pointer", marginBottom: 6, flexWrap: "nowrap" }}>
          <input type="checkbox" checked={cardFieldOn(settings, f.key)} onChange={() => set(f.key, !cardFieldOn(settings, f.key))} />
          <span style={{ fontSize: 14 }}>{f.label}</span>
        </label>
      ))}
      <div className="cr-row" style={{ justifyContent: "space-between", marginTop: 14 }}>
        <div className="cr-row">
          <button className="cr-btn" onClick={() => setSettings({ ...settings, procCardFields: Object.fromEntries(PROC_CARD_FIELDS.map((f) => [f.key, true])) })}>Mostrar tudo</button>
          <button className="cr-btn" onClick={() => setSettings({ ...settings, procCardFields: {} })}>Restaurar padrão</button>
        </div>
        <button className="cr-btn primary" onClick={onClose}>Concluir</button>
      </div>
    </Modal>
  );
}

function FormSection({ title }) {
  return (
    <div style={{ borderBottom: `2px solid ${TITLE_WINE}`, margin: "26px 0 12px", paddingBottom: 6 }}>
      <h3 className="cr-serif" style={{ margin: 0, fontSize: 16, letterSpacing: 2, textTransform: "uppercase", color: TITLE_INK }}>{title}</h3>
    </div>
  );
}

function BeautyCard({ b, on, onEdit, onRemove, onRegister }) {
  const [showHistory, setShowHistory] = useState(false);
  const stop = (fn) => (e) => { if (e && e.stopPropagation) e.stopPropagation(); fn(e); };
  const m = maintenanceStatus(b);
  const freqLabel = b.recurring
    ? (FREQUENCY_PRESETS.find((f) => f.unit === b.frequencyUnit && f.value === Number(b.frequencyValue))?.label
      || (b.frequencyUnit === "meses" ? `A cada ${b.frequencyValue} meses` : `A cada ${b.frequencyValue} dias`))
    : "";
  const pl = b._placeObj;
  const chips = [
    on("region") && b._region && <span className="cr-chip" key="r">{b._region}</span>,
    on("degree") && b.degree && <span className="cr-chip" key="d">{b.degree}</span>,
    on("bodyArea") && b.bodyArea && <span className="cr-chip" key="a">{b.bodyArea}</span>,
    on("dateDone") && b.dateDone && <span className="cr-chip" key="l">última: {fmtDateShort(b.dateDone)}</span>,
    on("frequency") && b.recurring && <span className="cr-chip" key="f">{freqLabel}</span>,
    on("cost") && b.cost > 0 && <span className="cr-chip" key="c">{fmtBRL(b.cost)}</span>,
  ].filter(Boolean);
  return (
    <div className="cr-card" style={{ cursor: "pointer" }} onClick={onEdit} title="Clique para abrir o procedimento completo">
      {on("image") && (b.image ? (
        <img src={b.image} alt="" style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 10, marginBottom: 8 }} />
      ) : (
        <div style={{
          width: "100%", height: 70, borderRadius: 10, marginBottom: 8, border: "1.5px dashed var(--line)",
          background: "#FBF8F4", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 3, color: "var(--ink-soft)",
        }}>
          <ImageIcon size={16} />
          <span style={{ fontSize: 11 }}>Adicionar imagem</span>
        </div>
      ))}
      <div className="cr-row" style={{ justifyContent: "space-between" }}>
        <h3 className="cr-serif" style={{ margin: 0, fontSize: 15 }}>{m && on("maintenance") ? `${statusEmoji(m.level)} ` : ""}{b.name}</h3>
        <button className="cr-btn ghost danger" title="Excluir" onClick={stop(onRemove)}><Trash2 size={13} /></button>
      </div>
      {chips.length > 0 && <div className="cr-row" style={{ margin: "6px 0", flexWrap: "wrap" }}>{chips}</div>}
      {on("goal") && b.goal && <p style={{ fontSize: 13, margin: "4px 0" }}><strong>Objetivo:</strong> {b.goal}</p>}
      {on("place") && (b._place || b.professional) && (
        <p className="cr-sub" style={{ margin: "4px 0" }}>{[b.professional, b._place].filter(Boolean).join(" · ")}</p>
      )}
      {on("social") && pl && (pl.instagram || pl.booking) && (
        <div className="cr-row" style={{ gap: 6, margin: "4px 0" }}>
          {pl.instagram && <button className="cr-btn" style={{ padding: "4px 8px" }} onClick={stop(() => openExternalLink(instagramUrl(pl.instagram)))}>Instagram</button>}
          {pl.booking && <button className="cr-btn" style={{ padding: "4px 8px" }} onClick={stop(() => openExternalLink(siteUrl(pl.booking)))}>Agendar</button>}
        </div>
      )}
      {on("result") && b.result && <p style={{ fontSize: 13, color: "var(--ink-soft)" }}>{b.result}</p>}
      {on("maintenance") && m && (
        <div className="cr-row" style={{ marginTop: 6, flexWrap: "wrap" }}>
          <span className="cr-chip" style={
            m.level === "atrasado" ? { background: "#F6DEDA", color: "#A1493C" }
              : (m.level === "proxima" || m.level === "hoje") ? { background: "#FBEBD4", color: "#96631C" }
              : { background: "#E3EBDF", color: "#4F6B49" }
          }>
            Próxima: {fmtDateShort(m.date)}
          </span>
          <button className="cr-btn ghost" style={{ padding: "4px 8px" }} onClick={stop(() => downloadICS(b.name, m.date, b.notes))}>
            <CalendarDays size={12} /> Adicionar ao calendário
          </button>
        </div>
      )}
      {on("notes") && b.notes && <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 4 }}>{b.notes}</p>}
      {(on("actions") || (on("link") && b.link)) && (
        <div className="cr-row" style={{ marginTop: 8, flexWrap: "wrap" }}>
          {on("actions") && <button className="cr-btn" style={{ padding: "4px 8px" }} onClick={stop(onRegister)}>+ Registrar realização</button>}
          {on("actions") && b.history && b.history.length > 0 && (
            <button className="cr-btn ghost" style={{ padding: "4px 8px" }} onClick={stop(() => setShowHistory(!showHistory))}>
              {showHistory ? "Ocultar histórico" : `Ver histórico (${b.history.length})`}
            </button>
          )}
          {on("link") && b.link && <button className="cr-btn ghost" style={{ padding: "4px 8px" }} onClick={stop(() => openExternalLink(b.link))}><Link2 size={12} /> Abrir link</button>}
        </div>
      )}
      {showHistory && b.history && (
        <div style={{ marginTop: 8, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
          {b.history.map((h) => (
            <div key={h.id} style={{ fontSize: 12.5, marginBottom: 6 }}>
              <strong>{fmtDateShort(h.date)}</strong>{[h.professional, h.clinic].filter(Boolean).length ? ", " + [h.professional, h.clinic].filter(Boolean).join(" · ") : ""}
              {h.cost > 0 && `, ${fmtBRL(h.cost)}`}
              {h.result && <div className="cr-sub" style={{ margin: 0 }}>{h.result}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RegistrarRealizacaoModal({ item, onSave, onClose }) {
  const [form, setForm] = useState({
    date: todayStr(), professional: item.professional || "", clinic: item.clinic || "",
    cost: item.cost || "", notes: "", result: item.result || "",
  });
  return (
    <Modal title={`Registrar realização: ${item.name}`} onClose={onClose}>
      <div className="cr-field"><label className="cr-label">Data</label>
        <input type="date" className="cr-input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
      <div className="cr-row">
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Profissional</label>
          <input className="cr-input" value={form.professional} onChange={(e) => setForm({ ...form, professional: e.target.value })} /></div>
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Clínica</label>
          <input className="cr-input" value={form.clinic} onChange={(e) => setForm({ ...form, clinic: e.target.value })} /></div>
      </div>
      <div className="cr-field"><label className="cr-label">Valor (R$)</label>
        <input type="number" className="cr-input" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></div>
      <div className="cr-field"><label className="cr-label">Resultado</label>
        <input className="cr-input" value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })} /></div>
      <div className="cr-field"><label className="cr-label">Observações</label>
        <textarea className="cr-textarea" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      <button className="cr-btn primary" style={{ width: "100%", justifyContent: "center" }}
        onClick={() => onSave({ ...form, cost: Number(form.cost) || 0 })}>Registrar realização</button>
    </Modal>
  );
}

function BeautyModal({ item, places, onSave, onClose, onRegister }) {
  const [form, setForm] = useState(item || {
    procStatus: "quero", region: "", degree: "", placeId: "", bodyArea: "", category: "", goal: "",
    image: "", professional: "", clinic: "", cost: "", dateDone: "",
    recurring: false, frequencyUnit: "meses", frequencyValue: "", alertDays: DEFAULT_ALERT_DAYS,
    result: "", notes: "", link: "", name: "", history: [],
  });
  const autoStatus = useAutoSave(form, onSave, (f) => ({
    ...f, cost: Number(f.cost) || 0, frequencyValue: f.recurring ? Number(f.frequencyValue) || "" : "",
  }));
  const preview = form.recurring ? nextMaintenanceDate(form.dateDone, form.frequencyUnit, form.frequencyValue) : null;
  const matchedPresetKey = FREQUENCY_PRESETS.find((f) => f.key !== "custom" && f.unit === form.frequencyUnit && f.value === Number(form.frequencyValue))?.key;
  const selectedKey = matchedPresetKey || (form.frequencyValue ? "custom" : "");

  const toggleAlertDay = (d) => {
    const has = (form.alertDays || []).includes(d);
    const next = has ? form.alertDays.filter((x) => x !== d) : [...(form.alertDays || []), d];
    setForm({ ...form, alertDays: next });
  };

  return (
    <Modal title={item ? (item.name || "Procedimento") : "Novo procedimento"} onClose={onClose}>
      <FormSection title="Resumo" />
      <div className="cr-field"><label className="cr-label">Nome</label>
        <input className="cr-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>

      <div className="cr-field"><label className="cr-label">Status</label>
        <ManagedSelect listKey="procStatus" value={inferProcStatus(form)} onChange={(v) => setForm({ ...form, procStatus: v })} /></div>

      <ImagePickerField label="Imagem" value={form.image} onChange={(v) => setForm({ ...form, image: v })} />

      <FormSection title="Classificação" />
      <div className="cr-row">
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Área</label>
          <ManagedSelect listKey="procRegion" value={form.region || inferRegion(form)} emptyLabel="Não definida" onChange={(v) => setForm({ ...form, region: v })} /></div>
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Tipo de procedimento</label>
          <ManagedSelect listKey="procDegree" value={form.degree || ""} emptyLabel="Não definido" onChange={(v) => setForm({ ...form, degree: v })} /></div>
      </div>
      <div className="cr-row">
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Parte do corpo/rosto</label>
          <ManagedSelect listKey="procBodyArea" value={form.bodyArea} emptyLabel="Não definida" onChange={(v) => setForm({ ...form, bodyArea: v })} /></div>
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Categoria</label>
          <ManagedSelect listKey="procCategory" value={form.category} emptyLabel="Sem categoria" onChange={(v) => setForm({ ...form, category: v })} /></div>
      </div>
      <div className="cr-field"><label className="cr-label">Objetivo</label>
        <input className="cr-input" value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} /></div>

      <FormSection title="Local e profissional" />
      <div className="cr-field"><label className="cr-label">Local (da aba Lugares e profissionais)</label>
        <select className="cr-select" value={form.placeId || ""} onChange={(e) => setForm({ ...form, placeId: e.target.value })}>
          <option value="">Nenhum local escolhido</option>
          {places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></div>
      <div className="cr-row">
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Profissional</label>
          <input className="cr-input" value={form.professional} onChange={(e) => setForm({ ...form, professional: e.target.value })} /></div>
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Clínica (texto livre)</label>
          <input className="cr-input" value={form.clinic} onChange={(e) => setForm({ ...form, clinic: e.target.value })} /></div>
      </div>
      <FormSection title="Valores e datas" />
      <div className="cr-row">
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Custo (R$)</label>
          <input type="number" className="cr-input" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></div>
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Data da última realização</label>
          <input type="date" className="cr-input" value={form.dateDone || ""} onChange={(e) => setForm({ ...form, dateDone: e.target.value })} /></div>
      </div>

      <FormSection title="Recorrência e alertas" />
      <div className="cr-field">
        <label className="cr-row" style={{ cursor: "pointer" }}>
          <div className={`cr-checkbox ${form.recurring ? "checked" : ""}`} onClick={() => setForm({ ...form, recurring: !form.recurring })}>
            {form.recurring && <Check size={13} />}
          </div>
          <span className="cr-label" style={{ margin: 0 }}>Procedimento recorrente?</span>
        </label>
      </div>

      {form.recurring && (
        <>
          <div className="cr-field"><label className="cr-label">Frequência</label>
            <select className="cr-select" value={selectedKey}
              onChange={(e) => {
                const key = e.target.value;
                if (key === "custom") setForm({ ...form, frequencyUnit: "dias", frequencyValue: form.frequencyValue || 30 });
                else {
                  const preset = FREQUENCY_PRESETS.find((f) => f.key === key);
                  setForm({ ...form, frequencyUnit: preset ? preset.unit : "meses", frequencyValue: preset ? preset.value : "" });
                }
              }}>
              <option value="">Selecione…</option>
              {FREQUENCY_PRESETS.filter((f) => f.key !== "custom").map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              <option value="custom">Personalizada (em dias)</option>
            </select>
            {selectedKey === "custom" && (
              <input type="number" min="1" className="cr-input" style={{ marginTop: 6 }}
                value={form.frequencyValue || ""} placeholder="quantos dias?"
                onChange={(e) => setForm({ ...form, frequencyUnit: "dias", frequencyValue: Number(e.target.value) })} />
            )}
            {preview && <p className="cr-sub" style={{ marginTop: 4 }}>Próxima manutenção calculada: {fmtDateShort(preview)}</p>}
          </div>
          <div className="cr-field"><label className="cr-label">Avisar com quanto tempo de antecedência?</label>
            <div className="cr-row" style={{ flexWrap: "wrap" }}>
              {ALERT_DAYS_OPTIONS.map((d) => (
                <label key={d} className="cr-chip" style={{ cursor: "pointer", background: (form.alertDays || []).includes(d) ? "var(--clay)" : undefined, color: (form.alertDays || []).includes(d) ? "#fff" : undefined }}>
                  <input type="checkbox" checked={(form.alertDays || []).includes(d)} onChange={() => toggleAlertDay(d)} style={{ marginRight: 4 }} />
                  {d === 0 ? "no dia" : `${d} dias antes`}
                </label>
              ))}
            </div>
          </div>
        </>
      )}

      <FormSection title="Resultado e observações" />
      <div className="cr-field"><label className="cr-label">Resultado (esperado / obtido)</label>
        <input className="cr-input" value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })} /></div>
      <div className="cr-field"><label className="cr-label">Link (referência, vídeo, post…)</label>
        <input className="cr-input" value={form.link || ""} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="https://…" /></div>
      <div className="cr-field"><label className="cr-label">Observações</label>
        <textarea className="cr-textarea" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      {item && (
        <>
          <FormSection title="Histórico de realizações" />
          {(form.history || []).length === 0 && <p className="cr-sub" style={{ marginTop: 0 }}>Nenhuma realização registrada ainda.</p>}
          {(form.history || []).map((h) => (
            <div className="cr-list-row" key={h.id}>
              <span className="cr-chip">{fmtDateShort(h.date)}</span>
              <span className="cr-list-title" style={{ flex: 1 }}>{[h.professional, h.clinic].filter(Boolean).join(" · ") || "Realizado"}{h.result ? `: ${h.result}` : ""}</span>
              {h.cost > 0 && <strong>{fmtBRL(h.cost)}</strong>}
            </div>
          ))}
          <button className="cr-btn primary" style={{ marginTop: 8 }} onClick={onRegister}>+ Registrar realização</button>
        </>
      )}
      <AutoSaveFooter status={autoStatus} onClose={onClose} />
    </Modal>
  );
}

function PlacesPanel({ places, setPlaces, beauty, setBeauty }) {
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);

  const savePlace = (data) => {
    const { procedureIds, ...place } = data;
    setPlaces(upsertById(places, place));
    if (Array.isArray(procedureIds)) {
      let changed = false;
      const next = beauty.map((b) => {
        if (procedureIds.includes(b.id) && b.placeId !== place.id) { changed = true; return { ...b, placeId: place.id }; }
        if (!procedureIds.includes(b.id) && b.placeId === place.id) { changed = true; return { ...b, placeId: "" }; }
        return b;
      });
      if (changed) setBeauty(next);
    }
  };
  const removePlace = (id) => {
    setPlaces(places.filter((p) => p.id !== id));
    setBeauty(beauty.map((b) => (b.placeId === id ? { ...b, placeId: "" } : b)));
    setConfirmDel(null);
  };

  return (
    <div>
      <div className="cr-row" style={{ margin: "14px 0", justifyContent: "space-between" }}>
        <p className="cr-sub" style={{ margin: 0 }}>Os locais e profissionais que você já conheceu ou quer conhecer.</p>
        <button className="cr-btn primary" onClick={() => setEditing("new")}><Plus size={14} /> Novo lugar</button>
      </div>
      {places.length === 0 && <p className="cr-empty">Nenhum lugar cadastrado ainda. Clique em "Novo lugar" para começar.</p>}
      <div className="cr-grid cr-grid-3">
        {places.map((p) => {
          const procs = beauty.filter((b) => b.placeId === p.id || (!b.placeId && b.clinic && b.clinic.trim().toLowerCase() === (p.name || "").trim().toLowerCase()));
          return (
            <div className="cr-card" key={p.id}>
              <div className="cr-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <h3 className="cr-serif" style={{ margin: 0, fontSize: 16 }}>{p.name}</h3>
                <div className="cr-row" style={{ gap: 2 }}>
                  <button className="cr-btn ghost" onClick={() => setEditing(p)}><Pencil size={13} /></button>
                  <button className="cr-btn ghost danger" onClick={() => setConfirmDel(p)}><Trash2 size={13} /></button>
                </div>
              </div>
              {Number(p.rating) > 0 && (
                <p style={{ margin: "4px 0", color: "#C9962E", letterSpacing: 2 }}>{"★".repeat(Number(p.rating))}<span style={{ color: "#D9D2C5" }}>{"★".repeat(5 - Number(p.rating))}</span></p>
              )}
              {p.professional && <p className="cr-sub" style={{ margin: "4px 0" }}>Profissional: {p.professional}</p>}
              {p.address && (
                <button className="cr-btn ghost" style={{ padding: "2px 0", textAlign: "left", height: "auto" }} onClick={() => openExternalLink(mapsUrl(p.address))}>
                  📍 {p.address}
                </button>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 6, margin: "10px 0" }}>
                {p.instagram && <button className="cr-btn primary" style={{ justifyContent: "center" }} onClick={() => openExternalLink(instagramUrl(p.instagram))}>Instagram {p.instagram.startsWith("http") ? "" : p.instagram.startsWith("@") ? p.instagram : "@" + p.instagram}</button>}
                {p.booking && <button className="cr-btn primary" style={{ justifyContent: "center" }} onClick={() => openExternalLink(siteUrl(p.booking))}>Agendar</button>}
                {p.site && <button className="cr-btn" style={{ justifyContent: "center" }} onClick={() => openExternalLink(siteUrl(p.site))}>Site</button>}
              </div>
              {procs.length > 0 && (
                <div>
                  <p className="cr-label" style={{ marginBottom: 4 }}>Procedimentos</p>
                  <div className="cr-row" style={{ flexWrap: "wrap", gap: 4 }}>{procs.map((b) => <span className="cr-chip" key={b.id}>{b.name}</span>)}</div>
                </div>
              )}
              {p.notes && <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 8 }}>{p.notes}</p>}
            </div>
          );
        })}
      </div>
      {editing && <PlaceModal item={editing === "new" ? null : editing} beauty={beauty} onSave={savePlace} onClose={() => setEditing(null)} />}
      {confirmDel && (
        <ConfirmModal title="Excluir lugar" message={`Excluir "${confirmDel.name}"? Os procedimentos continuam salvos, só perdem o vínculo com esse lugar.`}
          onConfirm={() => removePlace(confirmDel.id)} onCancel={() => setConfirmDel(null)} />
      )}
    </div>
  );
}

function PlaceModal({ item, beauty, onSave, onClose }) {
  const [form, setForm] = useState(item
    ? { ...item, procedureIds: beauty.filter((b) => b.placeId === item.id).map((b) => b.id) }
    : { name: "", address: "", instagram: "", site: "", booking: "", professional: "", notes: "", rating: 0, procedureIds: [] });
  const autoStatus = useAutoSave(form, onSave);
  const toggleProc = (id) => {
    const has = form.procedureIds.includes(id);
    setForm({ ...form, procedureIds: has ? form.procedureIds.filter((x) => x !== id) : [...form.procedureIds, id] });
  };
  return (
    <Modal title={item ? "Editar lugar" : "Novo lugar"} onClose={onClose}>
      <div className="cr-field"><label className="cr-label">Nome do estabelecimento</label>
        <input className="cr-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
      <div className="cr-field"><label className="cr-label">Endereço</label>
        <input className="cr-input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
      <div className="cr-row">
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Instagram</label>
          <input className="cr-input" value={form.instagram} onChange={(e) => setForm({ ...form, instagram: e.target.value })} placeholder="@perfil ou link" /></div>
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Profissional</label>
          <input className="cr-input" value={form.professional} onChange={(e) => setForm({ ...form, professional: e.target.value })} /></div>
      </div>
      <div className="cr-row">
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Site</label>
          <input className="cr-input" value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })} placeholder="https://…" /></div>
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Link de agendamento</label>
          <input className="cr-input" value={form.booking} onChange={(e) => setForm({ ...form, booking: e.target.value })} placeholder="https://…" /></div>
      </div>
      <div className="cr-field"><label className="cr-label">Avaliação pessoal</label>
        <div className="cr-row" style={{ gap: 2 }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" onClick={() => setForm({ ...form, rating: Number(form.rating) === n ? 0 : n })}
              style={{ border: "none", background: "none", cursor: "pointer", fontSize: 24, color: n <= Number(form.rating) ? "#C9962E" : "#D9D2C5", padding: 2 }}>★</button>
          ))}
        </div></div>
      {beauty.length > 0 && (
        <div className="cr-field"><label className="cr-label">Procedimentos feitos ou planejados aqui</label>
          <div style={{ maxHeight: 160, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 10, padding: 8 }}>
            {beauty.map((b) => (
              <label key={b.id} className="cr-row" style={{ cursor: "pointer", marginBottom: 4 }}>
                <input type="checkbox" checked={form.procedureIds.includes(b.id)} onChange={() => toggleProc(b.id)} />
                <span style={{ fontSize: 13 }}>{b.name}</span>
              </label>
            ))}
          </div></div>
      )}
      <div className="cr-field"><label className="cr-label">Observações</label>
        <textarea className="cr-textarea" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      <AutoSaveFooter status={autoStatus} onClose={onClose} />
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/* VISION BOARD                                                            */
/* ---------------------------------------------------------------------- */

function VisionView({ vision, setVision }) {
  const [editing, setEditing] = useState(null);
  const [zoom, setZoom] = useState(null);
  const save = (data) => { setVision(upsertById(vision, data)); };
  const remove = (id) => setVision(vision.filter((x) => x.id !== id));
  const move = (id, dir) => {
    const idx = vision.findIndex((x) => x.id === id);
    const to = idx + dir;
    if (to < 0 || to >= vision.length) return;
    const copy = [...vision];
    [copy[idx], copy[to]] = [copy[to], copy[idx]];
    setVision(copy);
  };

  return (
    <div>
      <div className="cr-row" style={{ justifyContent: "space-between" }}>
        <div><h1 className="cr-h1 cr-serif">Vision Board</h1><p className="cr-sub">Imagens e frases que representam onde você quer chegar. Clique numa imagem para ver em tela cheia.</p></div>
        <button className="cr-btn primary" onClick={() => setEditing("new")}><Plus size={14} /> Adicionar imagem ou frase</button>
      </div>
      {vision.length === 0 && <p className="cr-empty">Seu quadro de inspiração está vazio. Clique em "Adicionar imagem ou frase" para começar.</p>}
      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 380px), 1fr))", gap: 20 }}>
        {vision.map((v, i) => (
          <div className="cr-card" key={v.id} style={{ padding: 12 }}>
            {v.type === "image" && v.content && (
              <img src={v.content} alt="" onClick={() => setZoom(v.content)}
                style={{ width: "100%", height: 420, maxHeight: "60vh", objectFit: "cover", borderRadius: 12, marginBottom: 10, cursor: "zoom-in", display: "block" }} />
            )}
            {v.type === "quote" && (
              <p className="cr-serif" style={{ fontSize: 22, lineHeight: 1.35, fontStyle: "italic", margin: "18px 8px 22px", textAlign: "center" }}>"{v.content}"</p>
            )}
            <div className="cr-row" style={{ justifyContent: "space-between" }}>
              <span className="cr-chip">{v.category}</span>
              <div className="cr-row" style={{ gap: 2 }}>
                <button className="cr-btn ghost" disabled={i === 0} onClick={() => move(v.id, -1)}>↑</button>
                <button className="cr-btn ghost" disabled={i === vision.length - 1} onClick={() => move(v.id, 1)}>↓</button>
                <button className="cr-btn ghost" onClick={() => setEditing(v)}><Pencil size={13} /></button>
                <button className="cr-btn ghost danger" onClick={() => remove(v.id)}><Trash2 size={13} /></button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {zoom && (
        <div className="cr-modal-backdrop" onClick={() => setZoom(null)} style={{ cursor: "zoom-out" }}>
          <img src={zoom} alt="" style={{ maxWidth: "94vw", maxHeight: "92vh", borderRadius: 12, objectFit: "contain" }} />
        </div>
      )}
      {editing && <VisionModal item={editing === "new" ? null : editing} onSave={save} onClose={() => setEditing(null)} />}
    </div>
  );
}

function VisionModal({ item, onSave, onClose }) {
  const [form, setForm] = useState(item || { type: "image", content: "", category: "pessoal" });
  const [fileError, setFileError] = useState("");
  const autoStatus = useAutoSave(form, onSave, undefined);
  const [fileInfo, setFileInfo] = useState("");

  const handleFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setFileInfo(`Selecionado: ${file.name} (${(file.size / 1024).toFixed(0)}KB)`);
    // Alguns dispositivos não informam o tipo do arquivo — só bloqueia se
    // o tipo vier preenchido E não for imagem (nunca bloqueia por tipo vazio).
    if (file.type && !file.type.startsWith("image/")) { setFileError("Escolha um arquivo de imagem."); return; }
    if (file.size > 1.5 * 1024 * 1024) { setFileError("Imagem grande demais (máx. 1,5MB) — todas as imagens do quadro dividem o mesmo espaço de armazenamento, então fotos menores cabem mais."); return; }
    setFileError("");
    const reader = new FileReader();
    reader.onload = async () => {
      // confirma que este ambiente consegue guardar a imagem de verdade antes de aceitá-la
      const stored = await verifyStorageWrite(reader.result);
      if (!stored) {
        setFileError("Não consegui guardar essa imagem aqui (o navegador ou o armazenamento bloqueou). Tente uma imagem menor ou use o campo de link (URL).");
        return;
      }
      setForm((f) => ({ ...f, content: reader.result }));
    };
    reader.onerror = () => setFileError("Não consegui ler esse arquivo. Tente outra imagem.");
    reader.readAsDataURL(file);
  };

  return (
    <Modal title={item ? "Editar item" : "Adicionar ao vision board"} onClose={onClose}>
      <div className="cr-field"><label className="cr-label">Tipo</label>
        <select className="cr-select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, content: "" })}>
          <option value="image">imagem</option><option value="quote">frase</option>
        </select></div>

      {form.type === "image" ? (
        <>
          <div className="cr-field">
            <label className="cr-label">Enviar imagem do dispositivo</label>
            <input type="file" accept="image/*" className="cr-input" onChange={handleFile} />
            {fileInfo && !fileError && <p className="cr-sub" style={{ margin: "4px 0 0" }}>{fileInfo}</p>}
            {fileError && <p className="cr-sub" style={{ color: "#A1493C", margin: "4px 0 0" }}>{fileError}</p>}
          </div>
          <div className="cr-field">
            <label className="cr-label">ou link de imagem (URL)</label>
            <input className="cr-input" value={form.content && form.content.startsWith("data:") ? "" : form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="https://…" />
          </div>
          {form.content && (
            <div className="cr-field">
              <img src={form.content} alt="" style={{ width: "100%", maxHeight: 160, objectFit: "cover", borderRadius: 10 }} />
            </div>
          )}
        </>
      ) : (
        <div className="cr-field"><label className="cr-label">Frase</label>
          <textarea className="cr-textarea" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} /></div>
      )}

      <div className="cr-field"><label className="cr-label">Categoria</label>
        <ManagedSelect listKey="visionCategory" value={form.category} emptyLabel="Sem categoria" onChange={(v) => setForm({ ...form, category: v })} /></div>
      <AutoSaveFooter status={autoStatus} onClose={onClose} />
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/* DIÁRIO / JOURNAL                                                        */
/* ---------------------------------------------------------------------- */

function JournalView({ journal, setJournal }) {
  const [editing, setEditing] = useState(null);
  const save = (data) => { setJournal(upsertById(journal, data)); };
  const remove = (id) => setJournal(journal.filter((x) => x.id !== id));

  return (
    <div>
      <div className="cr-row" style={{ justifyContent: "space-between" }}>
        <div><h1 className="cr-h1 cr-serif">Diário</h1><p className="cr-sub">Reflexões, gratidão e revisão dos dias.</p></div>
        <button className="cr-btn primary" onClick={() => setEditing("new")}><Plus size={14} /> Nova entrada</button>
      </div>
      <div className="cr-card" style={{ marginTop: 16 }}>
        {journal.length === 0 && <p className="cr-empty">Nenhuma entrada ainda.</p>}
        {journal.slice().sort((a, b) => b.date.localeCompare(a.date)).map((j) => (
          <div key={j.id} style={{ borderBottom: "1px solid var(--line)", padding: "12px 4px" }}>
            <div className="cr-row" style={{ justifyContent: "space-between" }}>
              <div className="cr-row"><span style={{ fontSize: 18 }}>{j.mood}</span><span className="cr-chip">{fmtDateShort(j.date)}</span></div>
              <div className="cr-row" style={{ gap: 2 }}>
                <button className="cr-btn ghost" onClick={() => setEditing(j)}><Pencil size={13} /></button>
                <button className="cr-btn ghost danger" onClick={() => remove(j.id)}><Trash2 size={13} /></button>
              </div>
            </div>
            {j.gratitude && <p style={{ fontSize: 13, margin: "6px 0 2px", fontStyle: "italic", color: "var(--ink-soft)" }}>Gratidão: {j.gratitude}</p>}
            <p style={{ fontSize: 13.5, margin: "4px 0 0" }}>{j.content}</p>
          </div>
        ))}
      </div>
      {editing && <JournalModal entry={editing === "new" ? null : editing} onSave={save} onClose={() => setEditing(null)} />}
    </div>
  );
}

function JournalModal({ entry, onSave, onClose }) {
  const [form, setForm] = useState(entry || { date: todayStr(), mood: "😊", gratitude: "", content: "" });
  const autoStatus = useAutoSave(form, onSave, undefined);
  return (
    <Modal title={entry ? "Editar entrada" : "Nova entrada de diário"} onClose={onClose}>
      <div className="cr-row">
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Data</label>
          <input type="date" className="cr-input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Humor</label>
          <select className="cr-select" value={form.mood} onChange={(e) => setForm({ ...form, mood: e.target.value })}>
            <option value="😊">😊 bem</option><option value="😐">😐 neutro</option><option value="😔">😔 difícil</option><option value="🤩">🤩 ótimo</option>
          </select></div>
      </div>
      <div className="cr-field"><label className="cr-label">Gratidão do dia</label>
        <input className="cr-input" value={form.gratitude} onChange={(e) => setForm({ ...form, gratitude: e.target.value })} /></div>
      <div className="cr-field"><label className="cr-label">Reflexão</label>
        <textarea className="cr-textarea" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} /></div>
      <AutoSaveFooter status={autoStatus} onClose={onClose} />
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/* BUSCA GLOBAL                                                            */
/* ---------------------------------------------------------------------- */

function GlobalSearchView({ query, setQuery, all, goTo }) {
  const results = useMemo(() => {
    if (!query || query.length < 2) return [];
    const q = query.toLowerCase();
    const out = [];
    all.tasks.forEach((x) => x.title.toLowerCase().includes(q) && out.push({ label: x.title, kind: "Tarefa", tab: "tasks" }));
    all.goals.forEach((x) => x.name.toLowerCase().includes(q) && out.push({ label: x.name, kind: "Meta", tab: "goals" }));
    all.habits.forEach((x) => x.name.toLowerCase().includes(q) && out.push({ label: x.name, kind: "Hábito", tab: "habits" }));
    all.finance.forEach((x) => (x.desc || x.category || "").toLowerCase().includes(q) && out.push({ label: x.desc || x.category, kind: "Finanças", tab: "finance" }));
    all.notes.forEach((x) => (x.title + x.content).toLowerCase().includes(q) && out.push({ label: x.title, kind: "Nota", tab: "notes" }));
    all.study.forEach((x) => (x.title + x.subject).toLowerCase().includes(q) && out.push({ label: x.title, kind: "Estudos", tab: "study" }));
    all.career.forEach((x) => x.title.toLowerCase().includes(q) && out.push({ label: x.title, kind: "Carreira", tab: "career" }));
    all.beauty.forEach((x) => x.name.toLowerCase().includes(q) && out.push({ label: x.name, kind: "Beleza", tab: "beauty" }));
    all.apps.forEach((x) => x.name.toLowerCase().includes(q) && out.push({ label: x.name, kind: "App", tab: "apps" }));
    all.shopping.forEach((x) => x.name.toLowerCase().includes(q) && out.push({ label: x.name, kind: "Wishlist", tab: "shopping" }));
    all.hobbies.forEach((x) => x.name.toLowerCase().includes(q) && out.push({ label: x.name, kind: "Hobby", tab: "hobbies" }));
    all.personaldev.forEach((x) => x.criterio.toLowerCase().includes(q) && out.push({ label: x.criterio, kind: "Desenvolvimento Pessoal", tab: "personaldev" }));
    all.selfcare.forEach((x) => (x.title + x.content).toLowerCase().includes(q) && out.push({ label: x.title, kind: "Self-Care", tab: "selfcare" }));
    return out;
  }, [query, all]);

  return (
    <div>
      <h1 className="cr-h1 cr-serif">Busca global</h1>
      <p className="cr-sub">Encontre qualquer coisa em qualquer área do sistema.</p>
      <input className="cr-input" style={{ maxWidth: 320, margin: "10px 0 18px" }} placeholder="ex: dentista, Paris, skincare…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
      <div className="cr-card">
        {query.length < 2 && <p className="cr-empty">Digite ao menos 2 letras para buscar.</p>}
        {query.length >= 2 && results.length === 0 && <p className="cr-empty">Nada encontrado para "{query}".</p>}
        {results.map((r, i) => (
          <div className="cr-list-row" key={i}>
            <span className="cr-chip">{r.kind}</span>
            <span className="cr-list-title" style={{ flex: 1 }}>{r.label}</span>
            <button className="cr-btn ghost" onClick={() => goTo(r.tab)}>abrir <ChevronRight size={13} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* CASA                                                                    */
/* ---------------------------------------------------------------------- */

function HouseView({ house, setHouse }) {
  const [editing, setEditing] = useState(null);
  const save = (data) => { setHouse(upsertById(house, data)); };
  const remove = (id) => setHouse(house.filter((x) => x.id !== id));

  return (
    <div>
      <div className="cr-row" style={{ justifyContent: "space-between" }}>
        <div><h1 className="cr-h1 cr-serif">Casa</h1><p className="cr-sub">Manutenção, organização e pendências domésticas.</p></div>
        <button className="cr-btn primary" onClick={() => setEditing("new")}><Plus size={14} /> Novo item</button>
      </div>
      <div className="cr-card" style={{ marginTop: 16 }}>
        {house.length === 0 && <p className="cr-empty">Nada registrado ainda.</p>}
        {house.map((h) => (
          <div className="cr-list-row" key={h.id}>
            <div className={`cr-checkbox ${h.done ? "checked" : ""}`} onClick={() => setHouse(house.map((x) => x.id === h.id ? { ...x, done: !x.done } : x))}>
              {h.done && <Check size={13} />}
            </div>
            <span className="cr-list-title" style={{ flex: 1, textDecoration: h.done ? "line-through" : "none" }}>{h.item}</span>
            <span className="cr-chip">{h.room}</span>
            <span className="cr-chip">{h.type}</span>
            {h.dueDate && <span className="cr-chip">{fmtDateShort(h.dueDate)}</span>}
            <button className="cr-btn ghost" onClick={() => setEditing(h)}><Pencil size={14} /></button>
            <button className="cr-btn ghost danger" onClick={() => remove(h.id)}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
      {editing && <HouseModal item={editing === "new" ? null : editing} onSave={save} onClose={() => setEditing(null)} />}
    </div>
  );
}

function HouseModal({ item, onSave, onClose }) {
  const [form, setForm] = useState(item || { item: "", room: "", type: "manutencao", dueDate: todayStr(), done: false, notes: "" });
  const autoStatus = useAutoSave(form, onSave, undefined);
  return (
    <Modal title={item ? "Editar item" : "Novo item da casa"} onClose={onClose}>
      <div className="cr-field"><label className="cr-label">O que precisa ser feito</label>
        <input className="cr-input" value={form.item} onChange={(e) => setForm({ ...form, item: e.target.value })} /></div>
      <div className="cr-row">
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Cômodo</label>
          <input className="cr-input" value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} placeholder="ex: cozinha" /></div>
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Tipo</label>
          <select className="cr-select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="manutencao">manutenção</option><option value="organizacao">organização</option>
            <option value="compra">compra doméstica</option><option value="conta">conta</option>
          </select></div>
      </div>
      <div className="cr-field"><label className="cr-label">Data</label>
        <input type="date" className="cr-input" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></div>
      <div className="cr-field"><label className="cr-label">Notas</label>
        <textarea className="cr-textarea" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      <AutoSaveFooter status={autoStatus} onClose={onClose} />
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/* COMPRAS / WISHLIST                                                      */
/* ---------------------------------------------------------------------- */

function parseProductStatus(notes) {
  const n = (notes || "").toLowerCase();
  if (n.includes("acabou")) return "acabou";
  if (n.includes("ainda tem")) return "ainda tem";
  if (n.includes("comprei") || n.includes("comprado")) return "comprado";
  return "";
}

function inferShoppingKind(s) {
  if (s.kind) return s.kind;
  const cat = (s.category || "").trim().toLowerCase();
  if (cat === "skin care" || cat === "hair care" || cat === "skincare" || cat === "haircare") return "rotina";
  if ((s.notes || "").toLowerCase().includes("status:") && looksLikeProductName(s.name)) return "rotina";
  return "desejo";
}

function productStatus(s) {
  const st = s.status;
  if (!st || st === "desejado") return parseProductStatus(s.notes) || "ainda tem";
  return st;
}

function ShoppingView({ shopping, setShopping }) {
  const ctx = useContext(ListsContext);
  const [editing, setEditing] = useState(null);
  const [tab, setTab] = useState("desejo");
  const [filter, setFilter] = useState("todos");
  const [filterCategory, setFilterCategory] = useState("todas");
  const [viewAll, setViewAll] = useState(false);

  const save = (data) => { setShopping(upsertById(shopping, data)); };
  const remove = (id) => setShopping(shopping.filter((x) => x.id !== id));

  const withKind = shopping.map((s) => {
    const kind = inferShoppingKind(s);
    return { ...s, _kind: kind, _status: kind === "rotina" ? productStatus(s) : s.status };
  });
  const inTab = withKind.filter((s) => s._kind === tab);
  const filtered = inTab.filter((s) => (filter === "todos" || s._status === filter) && (filterCategory === "todas" || s.category === filterCategory));
  const categories = Array.from(new Set(inTab.map((s) => s.category).filter(Boolean)));
  const totalDesejado = withKind.filter((s) => s._kind === "desejo" && !isClosedItem("wishStatus", s.status)).reduce((sum, s) => sum + Number(s.price || 0), 0);
  const toRebuy = withKind.filter((s) => s._kind === "rotina" && isClosedItem("productStatus", s._status)).length;
  const originalOf = (s) => shopping.find((x) => x.id === s.id);

  const byCategory = () => {
    const map = {};
    filtered.forEach((s) => {
      const key = s.category || "Sem categoria";
      map[key] = map[key] || [];
      map[key].push(s);
    });
    return Object.entries(map);
  };

  const statusKey = tab === "rotina" ? "productStatus" : "wishStatus";
  const statusOptions = getList(statusKey);

  return (
    <div>
      <div className="cr-row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1 className="cr-h1 cr-serif">Wishlist</h1>
          <p className="cr-sub">
            {tab === "desejo" ? `${fmtBRL(totalDesejado)} em itens desejados.` : `${inTab.length} produtos na rotina${toRebuy ? `, ${toRebuy} para recomprar` : ""}.`}
          </p>
        </div>
        <button className="cr-btn primary" onClick={() => setEditing("new")}><Plus size={14} /> Novo item</button>
      </div>

      <div className="cr-tabbar" style={{ marginTop: 14 }}>
        <button className={`cr-tabbtn ${tab === "desejo" ? "active" : ""}`} onClick={() => { setTab("desejo"); setFilter("todos"); setFilterCategory("todas"); }}>Desejos</button>
        <button className={`cr-tabbtn ${tab === "rotina" ? "active" : ""}`} onClick={() => { setTab("rotina"); setFilter("todos"); setFilterCategory("todas"); }}>Produtos e rotina</button>
      </div>

      <div className="cr-row" style={{ margin: "14px 0", flexWrap: "wrap" }}>
        <select className="cr-select" style={{ maxWidth: 190 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="todos">Todos os status</option>
          {statusOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <button className="cr-btn" title="Gerenciar opções (criar, renomear, excluir, reordenar)" onClick={() => ctx.openManager(statusKey)}><SettingsIcon size={13} /> Gerenciar status</button>
        <select className="cr-select" style={{ maxWidth: 200 }} value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
          <option value="todas">Todas as categorias</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button className="cr-btn" title="Gerenciar opções (criar, renomear, excluir, reordenar)" onClick={() => ctx.openManager("wishCategory")}><SettingsIcon size={13} /> Gerenciar categorias</button>
        <button className="cr-btn ghost" onClick={() => setViewAll(!viewAll)}>{viewAll ? "Ver por categoria" : "Visualizar todos"}</button>
      </div>

      {filtered.length === 0 && <p className="cr-empty">Nenhum item encontrado.</p>}

      {viewAll || filterCategory !== "todas" ? (
        <div className="cr-grid cr-grid-3">
          {filtered.map((s) => <ShoppingCard key={s.id} s={s} onEdit={() => setEditing(originalOf(s))} onRemove={() => remove(s.id)} />)}
        </div>
      ) : (
        byCategory().map(([cat, items]) => (
          <div key={cat} style={{ marginBottom: 22 }}>
            <SectionTitle title={cat} count={`${items.length} ${items.length === 1 ? "item" : "itens"}`} />
            <div className="cr-grid cr-grid-3">
              {items.map((s) => <ShoppingCard key={s.id} s={s} onEdit={() => setEditing(originalOf(s))} onRemove={() => remove(s.id)} />)}
            </div>
          </div>
        ))
      )}

      {editing && <ShoppingModal item={editing === "new" ? null : editing} defaultKind={tab} onSave={save} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ShoppingCard({ s, onEdit, onRemove }) {
  const isRoutine = s._kind === "rotina";
  const st = s._status || s.status;
  const chipStyle = isRoutine
    ? (isClosedItem("productStatus", st) ? { background: "#F6DEDA", color: "#A1493C" } : { background: "#E3EBDF", color: "#4F6B49" })
    : { background: isClosedItem("wishStatus", st) ? "#E3EBDF" : undefined };
  return (
    <div className="cr-card">
      <div className="cr-row" style={{ justifyContent: "space-between" }}>
        <h3 className="cr-serif" style={{ margin: 0, fontSize: 15 }}>{s.name}</h3>
        <div className="cr-row" style={{ gap: 2 }}>
          <button className="cr-btn ghost" onClick={onEdit}><Pencil size={13} /></button>
          <button className="cr-btn ghost danger" onClick={onRemove}><Trash2 size={13} /></button>
        </div>
      </div>
      <div className="cr-row" style={{ margin: "6px 0", flexWrap: "wrap" }}>
        {!isRoutine && <PriorityChip id={s.priority} />}
        <span className="cr-chip" style={chipStyle}>{listName(isRoutine ? "productStatus" : "wishStatus", st)}</span>
      </div>
      {isRoutine && s.notes && <p className="cr-sub" style={{ margin: "4px 0" }}>{s.notes}</p>}
      {s.price > 0 && <p style={{ fontSize: 15, fontWeight: 600, margin: "4px 0" }}>{fmtBRL(s.price)}</p>}
      <div className="cr-row" style={{ justifyContent: "space-between", marginTop: 6 }}>
        <span className="cr-sub" style={{ margin: 0 }}>{s.store}</span>
        {s.link && <button className="cr-btn ghost" style={{ padding: "4px 8px" }} onClick={() => openExternalLink(s.link)}>abrir loja</button>}
      </div>
    </div>
  );
}

function ShoppingModal({ item, defaultKind, onSave, onClose }) {
  const [form, setForm] = useState(item
    ? { ...item, kind: inferShoppingKind(item), status: inferShoppingKind(item) === "rotina" ? productStatus(item) : item.status }
    : { name: "", category: "", store: "", price: "", priority: "media", link: "", kind: defaultKind || "desejo", status: (defaultKind === "rotina" ? "ainda tem" : "desejado"), desiredDate: "", notes: "" });
  const autoStatus = useAutoSave(form, onSave, (form) => ({ ...form, price: Number(form.price) || 0 }));
  const isRoutine = form.kind === "rotina";
  const changeKind = (k) => setForm({ ...form, kind: k, status: k === "rotina" ? "ainda tem" : "desejado" });
  return (
    <Modal title={item ? "Editar item" : "Novo item"} onClose={onClose}>
      <div className="cr-field"><label className="cr-label">Tipo</label>
        <select className="cr-select" value={form.kind} onChange={(e) => changeKind(e.target.value)}>
          <option value="desejo">Desejo (quero comprar)</option>
          <option value="rotina">Produto de rotina (uso ou quero usar)</option>
        </select></div>
      <div className="cr-field"><label className="cr-label">Produto</label>
        <input className="cr-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
      <div className="cr-row">
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Categoria</label>
          <ManagedSelect listKey="wishCategory" value={form.category} emptyLabel="Sem categoria" onChange={(v) => setForm({ ...form, category: v })} /></div>
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Loja</label>
          <input className="cr-input" value={form.store} onChange={(e) => setForm({ ...form, store: e.target.value })} placeholder="ex: Amazon, Shopee…" /></div>
      </div>
      <div className="cr-row">
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Preço (R$)</label>
          <input type="number" className="cr-input" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
        {!isRoutine && (
          <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Prioridade</label>
            <ManagedSelect listKey="priority" value={form.priority} onChange={(v) => setForm({ ...form, priority: v })} /></div>
        )}
      </div>
      <div className="cr-field"><label className="cr-label">Link do produto</label>
        <input className="cr-input" value={form.link || ""} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="https://…" /></div>
      <div className="cr-field"><label className="cr-label">Status</label>
        <ManagedSelect listKey={isRoutine ? "productStatus" : "wishStatus"} value={form.status} onChange={(v) => setForm({ ...form, status: v })} /></div>
      <div className="cr-field"><label className="cr-label">Observações (marca, tom, como uso…)</label>
        <textarea className="cr-textarea" value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      <AutoSaveFooter status={autoStatus} onClose={onClose} />
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/* HOBBIES                                                                 */
/* ---------------------------------------------------------------------- */

function HobbiesView({ hobbies, setHobbies }) {
  const ctx = useContext(ListsContext);
  const [editing, setEditing] = useState(null);
  const [filterCategory, setFilterCategory] = useState("todas");
  const [viewAll, setViewAll] = useState(false);
  const save = (data) => { setHobbies(upsertById(hobbies, data)); };
  const remove = (id) => setHobbies(hobbies.filter((x) => x.id !== id));

  const catList = getList("hobbyCategory");
  const extraCats = Array.from(new Set(hobbies.map((h) => h.category).filter((c) => c && !catList.some((x) => x.id === c))));
  const order = [...catList.map((c) => c.id), ...extraCats];
  const filtered = filterCategory === "todas" ? hobbies : hobbies.filter((h) => h.category === filterCategory);

  return (
    <div>
      <div className="cr-row" style={{ justifyContent: "space-between" }}>
        <div><h1 className="cr-h1 cr-serif">Hobbies</h1><p className="cr-sub">Suas atividades por prazer: o que você pratica e o que quer experimentar.</p></div>
        <button className="cr-btn primary" onClick={() => setEditing("new")}><Plus size={14} /> Novo hobby</button>
      </div>

      <div className="cr-row" style={{ margin: "14px 0", flexWrap: "wrap" }}>
        <select className="cr-select" style={{ maxWidth: 220 }} value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
          <option value="todas">Todas as categorias</option>
          {order.map((c) => <option key={c} value={c}>{listName("hobbyCategory", c)}</option>)}
        </select>
        <button className="cr-btn" title="Gerenciar opções (criar, renomear, excluir, reordenar)" onClick={() => ctx.openManager("hobbyCategory")}><SettingsIcon size={13} /> Gerenciar categorias</button>
        <button className="cr-btn ghost" onClick={() => setViewAll(!viewAll)}>{viewAll ? "Ver por categoria" : "Visualizar todos"}</button>
      </div>

      {filtered.length === 0 && <p className="cr-empty">Nenhum hobby encontrado.</p>}

      {viewAll || filterCategory !== "todas" ? (
        <div className="cr-grid cr-grid-3">
          {filtered.map((h) => <HobbyCard key={h.id} h={h} onEdit={() => setEditing(h)} onRemove={() => remove(h.id)} />)}
        </div>
      ) : (
        [...order, ""].map((cat) => {
          const items = filtered.filter((h) => (h.category || "") === cat);
          if (items.length === 0) return null;
          return (
            <div key={cat || "sem"} style={{ marginBottom: 36 }}>
              <SectionTitle title={cat ? listName("hobbyCategory", cat) : "Sem categoria"} count={`${items.length} ${items.length === 1 ? "hobby" : "hobbies"}`} />
              <div className="cr-grid cr-grid-3">
                {items.map((h) => <HobbyCard key={h.id} h={h} onEdit={() => setEditing(h)} onRemove={() => remove(h.id)} />)}
              </div>
            </div>
          );
        })
      )}

      {editing && <HobbyModal item={editing === "new" ? null : editing} onSave={save} onClose={() => setEditing(null)} />}
    </div>
  );
}

function HobbyCard({ h, onEdit, onRemove }) {
  return (
    <div className="cr-card">
      {h.image ? (
        <img src={h.image} alt="" style={{ width: "100%", height: 130, objectFit: "cover", borderRadius: 10, marginBottom: 8 }} />
      ) : (
        <button onClick={onEdit} style={{
          width: "100%", height: 90, borderRadius: 10, marginBottom: 8, border: "1.5px dashed var(--line)",
          background: "#FBF8F4", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 4, cursor: "pointer", color: "var(--ink-soft)",
        }}>
          <ImageIcon size={18} />
          <span style={{ fontSize: 11.5 }}>Adicionar imagem</span>
        </button>
      )}
      <div className="cr-row" style={{ justifyContent: "space-between" }}>
        <h3 className="cr-serif" style={{ margin: 0, fontSize: 15 }}>{h.name}</h3>
        <div className="cr-row" style={{ gap: 2 }}>
          <button className="cr-btn ghost" onClick={onEdit}><Pencil size={13} /></button>
          <button className="cr-btn ghost danger" onClick={onRemove}><Trash2 size={13} /></button>
        </div>
      </div>
      <div className="cr-row" style={{ margin: "6px 0", flexWrap: "wrap" }}>
        <span className="cr-chip">{listName("hobbyStatus", h.status || "quero experimentar")}</span>
        {h.frequency && <span className="cr-chip">{h.frequency}</span>}
        {h.level && <span className="cr-chip">nível: {h.level}</span>}
      </div>
      {h.description && <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "4px 0" }}>{h.description}</p>}
      {h.goal && <p style={{ fontSize: 13, margin: "4px 0" }}><strong>Objetivo:</strong> {h.goal}</p>}
      {typeof h.progress === "number" && (
        <>
          <div className="cr-progress-track" style={{ marginTop: 6 }}><div className="cr-progress-fill" style={{ width: `${h.progress}%`, background: progressColor(h.progress) }} /></div>
          <p className="cr-sub" style={{ margin: "4px 0 0" }}>{h.progress}%</p>
        </>
      )}
      <div className="cr-row" style={{ justifyContent: "space-between", marginTop: 8 }}>
        <span className="cr-sub" style={{ margin: 0 }}>{h.timeSpent ? `${h.timeSpent}h dedicadas` : ""}{h.cost ? ` · ${fmtBRL(h.cost)}` : ""}</span>
        {h.link && <button className="cr-btn ghost" style={{ padding: "4px 8px" }} onClick={() => openExternalLink(h.link)}><Link2 size={12} /> Abrir link</button>}
      </div>
    </div>
  );
}

function HobbyModal({ item, onSave, onClose }) {
  const [form, setForm] = useState(item || {
    name: "", category: "", image: "", description: "", goal: "", frequency: "", level: "",
    status: "quero experimentar", progress: 0, timeSpent: "", materials: "", cost: "", link: "", notes: "",
  });
  const autoStatus = useAutoSave(form, onSave, (form) => ({ ...form, timeSpent: Number(form.timeSpent) || 0, cost: Number(form.cost) || 0 }));
  return (
    <Modal title={item ? "Editar hobby" : "Novo hobby"} onClose={onClose}>
      <div className="cr-field"><label className="cr-label">Nome</label>
        <input className="cr-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
      <ImagePickerField label="Imagem representativa" value={form.image} onChange={(v) => setForm({ ...form, image: v })} />
      <div className="cr-row">
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Categoria</label>
          <ManagedSelect listKey="hobbyCategory" value={form.category} emptyLabel="Sem categoria" onChange={(v) => setForm({ ...form, category: v })} /></div>
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Status</label>
          <ManagedSelect listKey="hobbyStatus" value={form.status} onChange={(v) => setForm({ ...form, status: v })} /></div>
      </div>
      <div className="cr-field"><label className="cr-label">Descrição</label>
        <textarea className="cr-textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
      <div className="cr-field"><label className="cr-label">Objetivo</label>
        <input className="cr-input" value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} /></div>
      <div className="cr-row">
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Frequência</label>
          <ManagedSelect listKey="hobbyFrequency" value={form.frequency} emptyLabel="Não definida" onChange={(v) => setForm({ ...form, frequency: v })} /></div>
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Nível</label>
          <ManagedSelect listKey="hobbyLevel" value={form.level} emptyLabel="Não definido" onChange={(v) => setForm({ ...form, level: v })} /></div>
      </div>
      <div className="cr-field"><label className="cr-label">Progresso: {form.progress}%</label>
        <input type="range" min="0" max="100" value={form.progress} onChange={(e) => setForm({ ...form, progress: Number(e.target.value) })} style={{ width: "100%" }} /></div>
      <div className="cr-row">
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Tempo dedicado (h)</label>
          <input type="number" className="cr-input" value={form.timeSpent} onChange={(e) => setForm({ ...form, timeSpent: e.target.value })} /></div>
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Custo (R$)</label>
          <input type="number" className="cr-input" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></div>
      </div>
      <div className="cr-field"><label className="cr-label">Materiais necessários</label>
        <input className="cr-input" value={form.materials} onChange={(e) => setForm({ ...form, materials: e.target.value })} /></div>
      <div className="cr-field"><label className="cr-label">Link (tutorial, comunidade, aula…)</label>
        <input className="cr-input" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="https://…" /></div>
      <div className="cr-field"><label className="cr-label">Notas</label>
        <textarea className="cr-textarea" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      <AutoSaveFooter status={autoStatus} onClose={onClose} />
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/* SELF-CARE & BEM-ESTAR (separado de Procedimentos Estéticos)            */
/* ---------------------------------------------------------------------- */

function parseSelfcareStatus(item) {
  const t = ((item.content || "") + " " + (item.category || "")).toLowerCase();
  const m = t.match(/status:\s*([a-zçãáéíóú ]+)/);
  if (!m) return "";
  const v = m[1].trim();
  if (v.startsWith("cuid")) return "cuidando";
  if (v.startsWith("plan")) return "planejado";
  if (v.startsWith("conclu")) return "concluido";
  if (v.startsWith("paus")) return "pausado";
  return "";
}
function normalizeSelfcareStatus(list) {
  let changed = false;
  const out = list.map((i) => {
    if (i.status) return i;
    const st = parseSelfcareStatus(i);
    if (!st) return i;
    changed = true;
    return { ...i, status: st };
  });
  return changed ? out : list;
}
// Tira "status: cuidando" e o "Plano: ..." do texto; o plano vira o campo Plano de Ação (aparece só no detalhe)
function migrateSelfcareContent(list) {
  let changed = false;
  const out = list.map((it) => {
    let next = it;
    if (!it.planMigrated) {
      let c = it.content || "", status = it.status || "", steps = it.planSteps || [];
      const sm = c.match(/status:\s*([a-zçãáéíóú]+)/i);
      if (sm) {
        const v = sm[1].toLowerCase();
        const mapped = v.startsWith("cuid") ? "cuidando" : v.startsWith("plan") ? "planejado" : v.startsWith("conclu") ? "concluido" : v.startsWith("paus") ? "pausado" : "";
        if (!status && mapped) status = mapped;
        c = c.replace(/\s*·?\s*status:\s*[a-zçãáéíóú]+/ig, "");
      }
      const pm = c.match(/(?:^|·\s*)plano(?: de a[cç][aã]o)?:\s*([^·]+)/i);
      if (pm) {
        steps = [...steps, ...pm[1].split(",").map((x) => x.trim()).filter(Boolean).map((t) => ({ id: uid(), text: t, done: false }))];
        c = c.replace(pm[0], "");
      }
      c = c.replace(/^\s*·\s*|\s*·\s*$/g, "").replace(/\s*·\s*·\s*/g, " · ").trim();
      next = { ...it, content: c, status, planSteps: steps, actionPlan: it.actionPlan || "", planMigrated: true };
      changed = true;
    }
    return next;
  });
  return changed ? out : list;
}

function SelfCareView({ selfcare, setSelfcare }) {
  const ctx = useContext(ListsContext);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [fStatus, setFStatus] = useState("todos");
  const save = (data) => { setSelfcare(upsertById(selfcare, data)); };
  const remove = (id) => setSelfcare(selfcare.filter((x) => x.id !== id));

  const statusList = getList("selfcareStatus");
  const items = selfcare.map((x) => ({ ...x, _status: statusList.some((st) => st.id === x.status) ? x.status : "" }));
  const filtered = items.filter((x) => fStatus === "todos" || (fStatus === "nd" ? !x._status : x._status === fStatus));
  const countOf = (pred) => items.filter(pred).length;
  const options = statusList.map((st) => ({ value: st.id, label: st.name, count: countOf((x) => x._status === st.id) }));
  if (countOf((x) => !x._status) > 0) options.push({ value: "nd", label: "Sem status", count: countOf((x) => !x._status) });
  const sections = [...statusList.map((st) => ({ id: st.id, label: st.name })), { id: "", label: "Sem status" }];

  const card = (s) => (
    <div className="cr-card" key={s.id} style={{ display: "flex", flexDirection: "column" }}>
      {s.image ? (
        <div style={{ marginBottom: 10 }}>
          <img src={s.image} alt="" style={{ width: "100%", height: 150, objectFit: "cover", borderRadius: 10, display: "block" }} />
          <div className="cr-row" style={{ gap: 4, marginTop: 4 }}>
            <button className="cr-btn ghost" style={{ padding: "2px 8px", fontSize: 11.5 }} onClick={() => setEditing(s)}>Trocar imagem</button>
            <button className="cr-btn ghost danger" style={{ padding: "2px 8px", fontSize: 11.5 }} onClick={() => save({ ...s, image: "" })}>Remover imagem</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setEditing(s)} style={{
          width: "100%", height: 90, borderRadius: 10, marginBottom: 10, border: "1.5px dashed var(--line)",
          background: "#FBF8F4", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 3, cursor: "pointer", color: "var(--ink-soft)",
        }}>
          <ImageIcon size={18} />
          <span style={{ fontSize: 11.5 }}>Adicionar imagem</span>
        </button>
      )}
      <div className="cr-row" style={{ justifyContent: "space-between" }}>
        <h3 className="cr-serif" style={{ margin: 0, fontSize: 16 }}>{s.title}</h3>
        <div className="cr-row" style={{ gap: 2 }}>
          <button className="cr-btn ghost" onClick={() => setEditing(s)}><Pencil size={13} /></button>
          <button className="cr-btn ghost danger" onClick={() => remove(s.id)}><Trash2 size={13} /></button>
        </div>
      </div>
      <div className="cr-row" style={{ marginTop: 6, flexWrap: "wrap" }}>
        {s._status && <span className="cr-chip" style={{ background: "var(--clay)", color: "#fff" }}>{listName("selfcareStatus", s._status)}</span>}
        {s.category && <span className="cr-chip">{s.category}</span>}
      </div>
      {(s.content || "").trim() ? (
        <p style={{ fontSize: 13.5, color: "var(--ink-soft)", margin: "10px 0", flex: 1 }}>
          {(s.content || "").length > 160 ? s.content.slice(0, 160) + "…" : s.content}
        </p>
      ) : <div style={{ flex: 1, minHeight: 8 }} />}
      <button className="cr-btn ghost" style={{ alignSelf: "flex-start" }} onClick={() => setViewing(s)}>Ver detalhes</button>
    </div>
  );

  return (
    <div>
      <div className="cr-row" style={{ justifyContent: "space-between" }}>
        <div><h1 className="cr-h1 cr-serif">Self-Care & Bem-estar</h1><p className="cr-sub">Relaxamento e bem-estar, separado de procedimentos estéticos.</p></div>
        <button className="cr-btn primary" onClick={() => setEditing("new")}><Plus size={14} /> Novo item</button>
      </div>
      <FilterGroups defaultOpen="status" groups={[{ key: "status", label: "Status", value: fStatus, onChange: setFStatus, onManage: () => ctx.openManager("selfcareStatus"), options }]} />
      {selfcare.length === 0 && <p className="cr-empty">Nada registrado ainda.</p>}
      {selfcare.length > 0 && filtered.length === 0 && <p className="cr-empty">Nenhum item com esse status.</p>}
      {(() => {
        const used = sections.filter((sec) => filtered.some((x) => x._status === sec.id));
        return used.length === 1 && used[0].id === "" ? <div className="cr-grid cr-grid-3" style={{ marginTop: 14 }}>{filtered.map(card)}</div> : null;
      })()}
      {sections.map((sec) => {
        const list = filtered.filter((x) => x._status === sec.id);
        const used = sections.filter((sc) => filtered.some((x) => x._status === sc.id));
        if (list.length === 0 || (used.length === 1 && used[0].id === "")) return null;
        return (
          <div key={sec.id || "sem"} style={{ marginBottom: 26 }}>
            <SectionTitle title={sec.label} count={`${list.length} ${list.length === 1 ? "item" : "itens"}`} />
            <div className="cr-grid cr-grid-3">{list.map(card)}</div>
          </div>
        );
      })}
      {editing && <SelfCareModal item={editing === "new" ? null : editing} onSave={save} onClose={() => setEditing(null)} />}
      {viewing && (
        <Modal title={viewing.title} onClose={() => setViewing(null)}>
          {viewing.image && <img src={viewing.image} alt="" style={{ width: "100%", maxHeight: 340, objectFit: "cover", borderRadius: 12, marginBottom: 12 }} />}
          <div className="cr-row" style={{ marginBottom: 10 }}>
            {viewing.status && <span className="cr-chip" style={{ background: "var(--clay)", color: "#fff" }}>{listName("selfcareStatus", viewing.status)}</span>}
            {viewing.category && <span className="cr-chip">{viewing.category}</span>}
          </div>
          {(viewing.content || "").trim() && <p style={{ fontSize: 14.5, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{viewing.content}</p>}
          {((viewing.planSteps || []).length > 0 || (viewing.actionPlan || "").trim()) && (
            <div>
              <FormSection title="Plano de Ação" />
              {(viewing.actionPlan || "").trim() && <p style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>{viewing.actionPlan}</p>}
              {(viewing.planSteps || []).map((st) => (
                <div className="cr-list-row" key={st.id}>
                  <div className={`cr-checkbox ${st.done ? "checked" : ""}`} onClick={() => { const upd = { ...viewing, planSteps: viewing.planSteps.map((x) => x.id === st.id ? { ...x, done: !x.done } : x) }; setViewing(upd); save(upd); }}>{st.done && <Check size={13} />}</div>
                  <span className="cr-list-title" style={{ flex: 1, textDecoration: st.done ? "line-through" : "none" }}>{st.text}</span>
                  {st.due && <span className="cr-chip">até {fmtDateShort(st.due)}</span>}
                </div>
              ))}
            </div>
          )}
          <button className="cr-btn" style={{ marginTop: 16 }} onClick={() => { const v = viewing; setViewing(null); setEditing(v); }}><Pencil size={13} /> Editar</button>
        </Modal>
      )}
    </div>
  );
}

function SelfCareModal({ item, onSave, onClose }) {
  const [form, setForm] = useState(item || { title: "", content: "", category: "", status: "planejado", image: "", actionPlan: "", planSteps: [], planMigrated: true });
  const autoStatus = useAutoSave(form, onSave, undefined);
  const steps = form.planSteps || [];
  const setStep = (id, patch) => setForm({ ...form, planSteps: steps.map((x) => x.id === id ? { ...x, ...patch } : x) });
  return (
    <Modal title={item ? "Editar item" : "Novo item de self-care"} onClose={onClose}>
      <div className="cr-field"><label className="cr-label">Título</label>
        <input className="cr-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
      <ImagePickerField label="Imagem" value={form.image} onChange={(v) => setForm({ ...form, image: v })} />
      <div className="cr-field"><label className="cr-label">Status</label>
        <ManagedSelect listKey="selfcareStatus" value={form.status || ""} emptyLabel="Sem status" onChange={(v) => setForm({ ...form, status: v })} /></div>
      <div className="cr-field"><label className="cr-label">Categoria</label>
        <ManagedSelect listKey="selfcareCategory" value={form.category} emptyLabel="Sem categoria" onChange={(v) => setForm({ ...form, category: v })} /></div>
      <div className="cr-field"><label className="cr-label">Conteúdo</label>
        <textarea className="cr-textarea" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} style={{ minHeight: 120 }} /></div>

      <FormSection title="Plano de Ação" />
      <p className="cr-sub" style={{ marginTop: 0 }}>O que você vai fazer e como acompanhar. Fica guardado aqui e só aparece quando você abre o item (não ocupa espaço na tela principal).</p>
      <div className="cr-field"><label className="cr-label">O que vou fazer</label>
        <textarea className="cr-textarea" value={form.actionPlan || ""} onChange={(e) => setForm({ ...form, actionPlan: e.target.value })} placeholder="Descreva o plano…" /></div>
      <div className="cr-field"><label className="cr-label">Ações para acompanhar</label>
        {steps.map((st) => (
          <div className="cr-row" key={st.id} style={{ marginBottom: 6, flexWrap: "nowrap" }}>
            <div className={`cr-checkbox ${st.done ? "checked" : ""}`} onClick={() => setStep(st.id, { done: !st.done })}>{st.done && <Check size={13} />}</div>
            <input className="cr-input" placeholder="Ação (ex: agendar dentista)" value={st.text} onChange={(e) => setStep(st.id, { text: e.target.value })} />
            <input type="date" className="cr-input" style={{ maxWidth: 160 }} value={st.due || ""} onChange={(e) => setStep(st.id, { due: e.target.value })} />
            <button className="cr-btn ghost danger" onClick={() => setForm({ ...form, planSteps: steps.filter((x) => x.id !== st.id) })}><Trash2 size={13} /></button>
          </div>
        ))}
        <button className="cr-btn" onClick={() => setForm({ ...form, planSteps: [...steps, { id: uid(), text: "", due: "", done: false }] })}><Plus size={13} /> Adicionar ação</button>
      </div>
      <AutoSaveFooter status={autoStatus} onClose={onClose} />
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/* DESENVOLVIMENTO PESSOAL — Roda da Vida (autoavaliação)                  */
/* ---------------------------------------------------------------------- */

const WHEEL_PILARES = ["Qualidade de vida", "Profissional", "Pessoal", "Relacionamentos"];

function wheelPoint(cx, cy, r, angle) {
  return [cx + r * Math.cos(angle - Math.PI / 2), cy + r * Math.sin(angle - Math.PI / 2)];
}

function wheelDataBySetor(personaldev) {
  const map = {};
  personaldev.forEach((p) => {
    const key = p.setor || "Outros";
    map[key] = map[key] || { sum: 0, count: 0 };
    map[key].sum += Number(p.score || 0);
    map[key].count += 1;
  });
  return Object.entries(map).map(([label, v]) => ({ label, value: v.sum / v.count }));
}

function WheelChart({ data, size = 400 }) {
  const cx = size / 2, cy = size / 2;
  const maxR = size / 2 - 76;
  const n = data.length;
  if (n === 0) return null;
  const angleStep = (2 * Math.PI) / n;
  const rings = [2, 4, 6, 8, 10];
  const points = data.map((d, i) => wheelPoint(cx, cy, (Math.max(0, Math.min(10, d.value)) / 10) * maxR, i * angleStep));
  const polygon = points.map((p) => p.join(",")).join(" ");
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {rings.map((r, i) => {
        const ringPoints = data.map((_, j) => wheelPoint(cx, cy, (r / 10) * maxR, j * angleStep).join(",")).join(" ");
        return <polygon key={i} points={ringPoints} fill="none" stroke="#EFE8DE" strokeWidth={1} />;
      })}
      {data.map((d, i) => {
        const [x, y] = wheelPoint(cx, cy, maxR, i * angleStep);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#EFE8DE" strokeWidth={1} />;
      })}
      <polygon points={polygon} fill="var(--clay)" fillOpacity={0.32} stroke="var(--clay)" strokeWidth={2} />
      {points.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={3} fill="var(--clay)" />)}
      {data.map((d, i) => {
        const [x, y] = wheelPoint(cx, cy, maxR + 24, i * angleStep);
        return (
          <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="middle" style={{ fontSize: 9.5, fill: "var(--ink-soft)" }}>
            {d.label.length > 16 ? d.label.slice(0, 15) + "…" : d.label}
          </text>
        );
      })}
    </svg>
  );
}

const WHEEL_PALETTE = ["#C9A57E", "#D9A79A", "#97A587", "#A99BC0", "#9DB4BE", "#D6A98C", "#B7A6C9", "#E0AFA6", "#BDA37F", "#8FA396"];

function WheelBarChart({ data }) {
  const sorted = [...data].sort((a, b) => b.value - a.value);
  return (
    <div>
      {sorted.map((d, i) => (
        <div key={d.label} style={{ marginBottom: 9 }}>
          <div className="cr-row" style={{ justifyContent: "space-between", marginBottom: 3 }}>
            <span style={{ fontSize: 12.5 }}>{d.label}</span>
            <span className="cr-sub" style={{ margin: 0 }}>{d.value.toFixed(1)}/10</span>
          </div>
          <div className="cr-progress-track">
            <div className="cr-progress-fill" style={{ width: `${(d.value / 10) * 100}%`, background: progressColor((d.value / 10) * 100) }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function WheelPieChart({ data }) {
  const donutData = data.map((d, i) => ({ label: d.label, value: Math.max(0.1, d.value), color: WHEEL_PALETTE[i % WHEEL_PALETTE.length] }));
  return <DonutChart data={donutData} />;
}

function ChartTypeToggle({ value, onChange }) {
  return (
    <div className="cr-row" style={{ gap: 4 }}>
      <button className={`cr-tabbtn ${value === "radar" ? "active" : ""}`} onClick={() => onChange("radar")}>Roda</button>
      <button className={`cr-tabbtn ${value === "pizza" ? "active" : ""}`} onClick={() => onChange("pizza")}>Pizza</button>
      <button className={`cr-tabbtn ${value === "barra" ? "active" : ""}`} onClick={() => onChange("barra")}>Barra</button>
    </div>
  );
}

function WheelOfLifeChart({ data, type, size }) {
  if (data.length === 0) return null;
  if (type === "pizza") return <div style={{ display: "flex", justifyContent: "center" }}><WheelPieChart data={data} /></div>;
  if (type === "barra") return <WheelBarChart data={data} />;
  return <div style={{ display: "flex", justifyContent: "center" }}><WheelChart data={data} size={size} /></div>;
}

function PersonalDevView({ personaldev, setPersonaldev, settings, setSettings }) {
  const [editing, setEditing] = useState(null);
  const chartType = settings.wheelChartType || "radar";
  const setChartType = (t) => setSettings({ ...settings, wheelChartType: t });

  const save = (data) => { setPersonaldev(upsertById(personaldev, data)); };
  const remove = (id) => setPersonaldev(personaldev.filter((x) => x.id !== id));

  const avg = personaldev.length
    ? Math.round(personaldev.reduce((s, x) => s + Number(x.score || 0), 0) / personaldev.length * 10)
    : 0;

  const byPilar = {};
  personaldev.forEach((p) => {
    const key = p.pilar || "Outros";
    byPilar[key] = byPilar[key] || {};
    const setorKey = p.setor || "Geral";
    byPilar[key][setorKey] = byPilar[key][setorKey] || [];
    byPilar[key][setorKey].push(p);
  });
  const pilarOrder = [...WHEEL_PILARES, ...Object.keys(byPilar).filter((p) => !WHEEL_PILARES.includes(p))];

  return (
    <div>
      <div className="cr-row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1 className="cr-h1 cr-serif">Desenvolvimento Pessoal</h1>
          <p className="cr-sub">Sua Roda da Vida — autoavaliação por área, nota de 0 a 10. Média geral: {avg}%.</p>
        </div>
        <button className="cr-btn primary" onClick={() => setEditing("new")}><Plus size={14} /> Novo critério</button>
      </div>

      <div className="cr-progress-track" style={{ margin: "14px 0" }}><div className="cr-progress-fill" style={{ width: `${avg}%`, background: progressColor(avg) }} /></div>

      {personaldev.length > 0 && (
        <div className="cr-card" style={{ marginBottom: 22 }}>
          <div className="cr-row" style={{ justifyContent: "flex-end", marginBottom: 12 }}>
            <ChartTypeToggle value={chartType} onChange={setChartType} />
          </div>
          <WheelOfLifeChart data={wheelDataBySetor(personaldev)} type={chartType} size={400} />
        </div>
      )}

      {personaldev.length === 0 && <p className="cr-empty">Nenhum critério cadastrado ainda.</p>}

      {pilarOrder.filter((pilar) => byPilar[pilar]).map((pilar) => (
        <div key={pilar} style={{ marginBottom: 26 }}>
          <SectionTitle title={pilar} count={`${Object.values(byPilar[pilar]).reduce((n, arr) => n + arr.length, 0)} critérios`} />
          <div className="cr-grid cr-grid-2">
            {Object.entries(byPilar[pilar]).map(([setor, items]) => (
              <div className="cr-card" key={setor}>
                <h4 className="cr-serif" style={{ fontSize: 14, margin: "0 0 10px", color: "var(--ink-soft)" }}>{setor}</h4>
                {items.map((p) => (
                  <div key={p.id} style={{ marginBottom: 10 }}>
                    <div className="cr-row" style={{ justifyContent: "space-between" }}>
                      <span style={{ fontSize: 13.5 }}>{p.criterio}</span>
                      <div className="cr-row" style={{ gap: 4 }}>
                        <span className="cr-chip">{p.score}/10</span>
                        <button className="cr-btn ghost" style={{ padding: 3 }} onClick={() => setEditing(p)}><Pencil size={12} /></button>
                        <button className="cr-btn ghost danger" style={{ padding: 3 }} onClick={() => remove(p.id)}><Trash2 size={12} /></button>
                      </div>
                    </div>
                    <div className="cr-progress-track" style={{ marginTop: 4 }}>
                      <div className="cr-progress-fill" style={{ width: `${p.score * 10}%`, background: progressColor(p.score * 10) }} />
                    </div>
                    {p.notes && <p className="cr-sub" style={{ margin: "4px 0 0" }}>{p.notes}</p>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}

      {editing && <PersonalDevModal item={editing === "new" ? null : editing} onSave={save} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PersonalDevModal({ item, onSave, onClose }) {
  const [form, setForm] = useState(item || { criterio: "", pilar: "Pessoal", setor: "", score: 5, notes: "", link: "" });
  const autoStatus = useAutoSave(form, onSave, (form) => ({ ...form, score: Number(form.score) }));
  return (
    <Modal title={item ? "Editar critério" : "Novo critério"} onClose={onClose}>
      <div className="cr-field"><label className="cr-label">Critério</label>
        <input className="cr-input" value={form.criterio} onChange={(e) => setForm({ ...form, criterio: e.target.value })} placeholder="ex: Meditação, Networking…" /></div>
      <div className="cr-row">
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Pilar</label>
          <ManagedSelect listKey="wheelPilar" value={form.pilar} onChange={(v) => setForm({ ...form, pilar: v })} />
        </div>
        <div className="cr-field" style={{ flex: 1 }}><label className="cr-label">Setor</label>
          <ManagedSelect listKey="wheelSetor" value={form.setor} emptyLabel="Selecione…" onChange={(v) => setForm({ ...form, setor: v })} /></div>
      </div>
      <div className="cr-field"><label className="cr-label">Nota: {form.score}/10</label>
        <input type="range" min="0" max="10" value={form.score} onChange={(e) => setForm({ ...form, score: Number(e.target.value) })} style={{ width: "100%" }} /></div>
      <div className="cr-field"><label className="cr-label">Notas</label>
        <textarea className="cr-textarea" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      <div className="cr-field"><label className="cr-label">Link (opcional)</label>
        <input className="cr-input" value={form.link || ""} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="https://…" /></div>
      <AutoSaveFooter status={autoStatus} onClose={onClose} />
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/* APP ROOT                                                                */
/* ---------------------------------------------------------------------- */

const NAV = [
  { id: "dashboard", label: "Dashboard", icon: Home },
  { id: "search", label: "Buscar", icon: SearchCheck },
  { id: "tasks", label: "Planejamento e Rotinas", icon: CalendarDays },
  { id: "goals", label: "Metas", icon: Target },
  { id: "habits", label: "Hábitos", icon: Repeat },
  { id: "finance", label: "Finanças", icon: Wallet },
  { id: "study", label: "Estudos", icon: GraduationCap },
  { id: "career", label: "Carreira", icon: Briefcase },
  { id: "beauty", label: "Procedimentos Estéticos", icon: Sparkles },
  { id: "selfcare", label: "Self-Care & Bem-estar", icon: Flame },
  { id: "hobbies", label: "Hobbies", icon: Sparkle },
  { id: "personaldev", label: "Desenvolvimento Pessoal", icon: Compass },
  { id: "shopping", label: "Wishlist", icon: Wallet },
  { id: "notes", label: "Notas", icon: NotebookPen },
  { id: "vision", label: "Vision Board", icon: ImageIcon },
  { id: "apps", label: "Meus Apps", icon: Link2 },
  { id: "settings", label: "Configurações", icon: SettingsIcon },
];

const TAB_ROUTES = {
  dashboard: "dashboard", search: "buscar", tasks: "planejamento", goals: "metas",
  habits: "habitos", finance: "financas", study: "estudos", career: "carreira",
  beauty: "procedimentos", selfcare: "bem-estar", hobbies: "hobbies",
  personaldev: "desenvolvimento-pessoal", shopping: "wishlist", notes: "notas",
  vision: "vision-board", apps: "apps", settings: "configuracoes",
  routines: "rotinas", house: "casa", journal: "diario",
};
const ROUTE_TABS = Object.fromEntries(Object.entries(TAB_ROUTES).map(([tab, route]) => [route, tab]));

function tabFromHash(hash) {
  let route = hash.replace(/^#\/?/, "");
  try { route = decodeURIComponent(route); } catch { /* Use the literal route if it is malformed. */ }
  if (route.startsWith("pagina-")) return `page:${route.slice("pagina-".length)}`;
  return ROUTE_TABS[route] || route || "dashboard";
}

function hashForTab(tab) {
  if (tab.startsWith("page:")) return `#/pagina-${encodeURIComponent(tab.slice(5))}`;
  return `#/${TAB_ROUTES[tab] || tab}`;
}

export default function App({ onSignOut }) {
  const [tab, setTabState] = useState(() => tabFromHash(window.location.hash));
  const setTab = useCallback((nextTab) => {
    setTabState(nextTab);
    const nextHash = hashForTab(nextTab);
    if (window.location.hash !== nextHash) window.history.pushState(null, "", nextHash);
  }, []);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [tasks, setTasksState] = useState([]);
  const [goals, setGoalsState] = useState([]);
  const [habits, setHabitsState] = useState([]);
  const [finance, setFinanceState] = useState([]);
  const [notes, setNotesState] = useState([]);
  const [areas, setAreasState] = useState([]);
  const [apps, setAppsState] = useState([]);
  const [settings, setSettingsState] = useState(DEFAULT_SETTINGS);
  const [study, setStudyState] = useState([]);
  const [career, setCareerState] = useState([]);
  const [routines, setRoutinesState] = useState([]);
  const [beauty, setBeautyState] = useState([]);
  const [vision, setVisionState] = useState([]);
  const [journal, setJournalState] = useState([]);
  const [shopping, setShoppingState] = useState([]);
  const [house, setHouseState] = useState([]);
  const [hobbies, setHobbiesState] = useState([]);
  const [personaldev, setPersonaldevState] = useState([]);
  const [selfcare, setSelfcareState] = useState([]);
  const [accounts, setAccountsState] = useState([]);
  const [cards, setCardsState] = useState([]);
  const [pages, setPagesState] = useState([]);
  const [places, setPlacesState] = useState([]);
  const [investments, setInvestmentsState] = useState([]);
  const [studyAreas, setStudyAreasState] = useState([]);
  const [gcal, setGcalState] = useState({ calendars: [], updatedAt: "" });
  const [manager, setManager] = useState(null);
  const [navEdit, setNavEdit] = useState(false);
  const [pageModal, setPageModal] = useState(null);
  const [confirmPage, setConfirmPage] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileMore, setMobileMore] = useState(false);

  const loadAllData = useCallback(async () => {
    setLoadError("");
    try {
      const withTimeout = (promise, _fallback, ms = 15000) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("A leitura dos dados demorou demais. Verifique sua conexão e tente novamente.")), ms);
        Promise.resolve(promise).then(
          (value) => { clearTimeout(timer); resolve(value); },
          (error) => { clearTimeout(timer); reject(error); }
        );
      });

      await reloadUserData();
      const [tk, gl, hb, fn, nt, ar, ap, st, sd, cr, rt, bt, vs, jr, sh, hs, hby, scr, acc, crd, pdv, structureFlag, procWishlistFlag, personaldevFlag, dashLayoutV2Flag, beautyObjFlag, beautyProdFlag, beautyHistFlag, pgs, plc, inv, sar, notesGoneFlag, gcalSaved] = await Promise.all([
        withTimeout(storageGet(KEYS.tasks, DEFAULT_TASKS), DEFAULT_TASKS),
        withTimeout(storageGet(KEYS.goals, DEFAULT_GOALS), DEFAULT_GOALS),
        withTimeout(storageGet(KEYS.habits, DEFAULT_HABITS), DEFAULT_HABITS),
        withTimeout(storageGet(KEYS.finance, DEFAULT_FINANCE), DEFAULT_FINANCE),
        withTimeout(storageGet(KEYS.notes, DEFAULT_NOTES), DEFAULT_NOTES),
        withTimeout(storageGet(KEYS.areas, DEFAULT_AREAS), DEFAULT_AREAS),
        withTimeout(storageGet(KEYS.apps, DEFAULT_APPS), DEFAULT_APPS),
        withTimeout(storageGet(KEYS.settings, DEFAULT_SETTINGS), DEFAULT_SETTINGS),
        withTimeout(storageGet(KEYS.study, DEFAULT_STUDY), DEFAULT_STUDY),
        withTimeout(storageGet(KEYS.career, DEFAULT_CAREER), DEFAULT_CAREER),
        withTimeout(storageGet(KEYS.routines, DEFAULT_ROUTINES), DEFAULT_ROUTINES),
        withTimeout(storageGet(KEYS.beauty, DEFAULT_BEAUTY), DEFAULT_BEAUTY),
        withTimeout(storageGet(KEYS.vision, DEFAULT_VISION), DEFAULT_VISION),
        withTimeout(storageGet(KEYS.journal, DEFAULT_JOURNAL), DEFAULT_JOURNAL),
        withTimeout(storageGet(KEYS.shopping, DEFAULT_SHOPPING), DEFAULT_SHOPPING),
        withTimeout(storageGet(KEYS.house, DEFAULT_HOUSE), DEFAULT_HOUSE),
        withTimeout(storageGet(KEYS.hobbies, DEFAULT_HOBBIES), DEFAULT_HOBBIES),
        withTimeout(storageGet(KEYS.selfcare, DEFAULT_SELFCARE), DEFAULT_SELFCARE),
        withTimeout(storageGet(KEYS.accounts, DEFAULT_ACCOUNTS), DEFAULT_ACCOUNTS),
        withTimeout(storageGet(KEYS.cards, DEFAULT_CARDS), DEFAULT_CARDS),
        withTimeout(storageGet(KEYS.personaldev, DEFAULT_PERSONALDEV), DEFAULT_PERSONALDEV),
        withTimeout(storageGet(STRUCTURE_MIGRATION_FLAG_KEY, false), false),
        withTimeout(storageGet(PROC_WISHLIST_MIGRATION_FLAG_KEY, false), false),
        withTimeout(storageGet(PERSONALDEV_MIGRATION_FLAG_KEY, false), false),
        withTimeout(storageGet(DASHBOARD_LAYOUT_V2_FLAG_KEY, false), false),
        withTimeout(storageGet(BEAUTY_OBJECTIVES_MIGRATION_FLAG_KEY, false), false),
        withTimeout(storageGet(BEAUTY_PRODUCTS_MIGRATION_FLAG_KEY, false), false),
        withTimeout(storageGet(BEAUTY_HISTORY_FORMAT_FLAG_KEY, false), false),
        withTimeout(storageGet(KEYS.pages, []), []),
        withTimeout(storageGet(KEYS.places, []), []),
        withTimeout(storageGet(KEYS.investments, []), []),
        withTimeout(storageGet(KEYS.studyareas, []), []),
        withTimeout(storageGet(NOTES_PAGE_REMOVED_FLAG_KEY, false), false),
        withTimeout(storageGet(KEYS.gcal, null), null),
      ]);
      let finalTasks = tk, finalGoals = gl, finalRoutines = rt, finalStudy = sd, finalShopping = sh, finalVision = vs;
      let finalHabits = hb, finalBeauty = bt, finalNotes = nt, finalApps = ap;
      let finalHobbies = hby, finalSelfcare = scr, finalPersonaldev = pdv;

      // A partir daqui, qualquer gravação de fundo é "dispara e esquece":
      // nunca bloqueia a tela, mesmo se o armazenamento estiver lento.
      const bg = (p) => { Promise.resolve(p).catch((error) => console.error("Falha ao salvar dados de inicialização", error)); };

      // Reorganização estrutural: tira Hobbies / Análise facial-corporal / Atividades relaxantes de Notas
      if (!structureFlag) {
        const migrated = runStructureMigration(finalNotes, finalHobbies, finalSelfcare);
        finalNotes = migrated.notes; finalHobbies = migrated.hobbies; finalSelfcare = migrated.selfcare;
        bg(storageSet(KEYS.notes, finalNotes)); bg(storageSet(KEYS.hobbies, finalHobbies)); bg(storageSet(KEYS.selfcare, finalSelfcare));
        bg(storageSet(STRUCTURE_MIGRATION_FLAG_KEY, true));
      }
      // Move produtos/rotina de Procedimentos Estéticos para a Wishlist
      if (!procWishlistFlag) {
        const movedProc = migrateBeautyToWishlist(finalBeauty, finalShopping);
        finalBeauty = movedProc.beauty; finalShopping = movedProc.shopping;
        bg(storageSet(KEYS.beauty, finalBeauty)); bg(storageSet(KEYS.shopping, finalShopping));
        bg(storageSet(PROC_WISHLIST_MIGRATION_FLAG_KEY, true));
      }
      // Move a Roda da Vida (autoavaliação) de Metas para a nova aba Desenvolvimento Pessoal
      if (!personaldevFlag) {
        const movedDev = migrateWheelOfLifeToPersonalDev(finalGoals, finalPersonaldev);
        finalGoals = movedDev.goals; finalPersonaldev = movedDev.personaldev;
        bg(storageSet(KEYS.goals, finalGoals)); bg(storageSet(KEYS.personaldev, finalPersonaldev));
        bg(storageSet(PERSONALDEV_MIGRATION_FLAG_KEY, true));
      }
      // Garante que widgets novos do dashboard (ex: Roda da Vida, Gráfico de Finanças)
      // apareçam também pra quem já tinha uma lista de widgets salva antes deles existirem.
      let finalSettings = st;
      let reconciled = reconcileWidgets(st.dashboardWidgets);
      // Ajuste pedido: some Hábitos/Distribuição do dashboard por padrão (continuam
      // disponíveis pra ligar de novo em Configurações, só não vêm mais visíveis).
      if (!dashLayoutV2Flag) {
        reconciled = reconciled.map((w) => (w.id === "habits" || w.id === "distribution") ? { ...w, visible: false } : w);
        bg(storageSet(DASHBOARD_LAYOUT_V2_FLAG_KEY, true));
      }
      if (reconciled !== st.dashboardWidgets) {
        finalSettings = { ...st, dashboardWidgets: reconciled };
        bg(storageSet(KEYS.settings, finalSettings));
      }
      // Atualiza pro novo tema de cores (vermelho/preto/off-white), só pra quem
      // ainda estava com algum tema padrão anterior — não sobrescreve quem já personalizou.
      const OLD_DEFAULT_THEMES = [
        { clay: "#C9A57E", rose: "#D9A79A", sage: "#97A587" }, // tema original (dourado/rosa/sálvia)
        { clay: "#810100", rose: "#630000", sage: "#480001" }, // primeira tentativa vermelha
      ];
      const currentTheme = finalSettings.theme || {};
      const stillOnOldDefault = OLD_DEFAULT_THEMES.some((t) =>
        currentTheme.clay === t.clay && currentTheme.rose === t.rose && currentTheme.sage === t.sage);
      if (!currentTheme.clay || stillOnOldDefault) {
        finalSettings = { ...finalSettings, theme: DEFAULT_SETTINGS.theme };
        bg(storageSet(KEYS.settings, finalSettings));
      }
      // Tira os "objetivos" de Procedimentos Estéticos e coloca em Self-Care & Bem-estar
      if (!beautyObjFlag) {
        const movedObj = migrateBeautyObjectivesToSelfcare(finalBeauty, finalSelfcare);
        finalBeauty = movedObj.beauty; finalSelfcare = movedObj.selfcare;
        bg(storageSet(KEYS.beauty, finalBeauty)); bg(storageSet(KEYS.selfcare, finalSelfcare));
        bg(storageSet(BEAUTY_OBJECTIVES_MIGRATION_FLAG_KEY, true));
      }
      // Tira produtos (creme, blush, protetor solar etc.) de Procedimentos Estéticos,
      // manda pra Wishlist — Procedimentos Estéticos passa a ter só procedimento de verdade.
      if (!beautyProdFlag) {
        const movedProd = migrateNamedProductsToWishlist(finalBeauty, finalShopping);
        finalBeauty = movedProd.beauty; finalShopping = movedProd.shopping;
        bg(storageSet(KEYS.beauty, finalBeauty)); bg(storageSet(KEYS.shopping, finalShopping));
        bg(storageSet(BEAUTY_PRODUCTS_MIGRATION_FLAG_KEY, true));
      }
      // Converte procedimentos pro novo formato com histórico de realizações e frequência em dias
      if (!beautyHistFlag) {
        finalBeauty = migrateBeautyToHistoryFormat(finalBeauty);
        bg(storageSet(KEYS.beauty, finalBeauty));
        bg(storageSet(BEAUTY_HISTORY_FORMAT_FLAG_KEY, true));
      }
      // Autolimpeza: produtos e objetivos que voltarem para Procedimentos Estéticos
      // (por exemplo, numa reimportação do Notion) vão para Wishlist e Self-Care.
      {
        const rr = rerouteBeautyItems(finalBeauty, finalShopping, finalSelfcare);
        const formatted = migrateBeautyToHistoryFormat(rr.beauty);
        const formatChanged = formatted.some((b, i) => b !== rr.beauty[i]);
        if (rr.changed || formatChanged) {
          finalBeauty = formatted; finalShopping = rr.shopping; finalSelfcare = rr.selfcare;
          bg(storageSet(KEYS.beauty, finalBeauty)); bg(storageSet(KEYS.shopping, finalShopping)); bg(storageSet(KEYS.selfcare, finalSelfcare));
        }
      }
      // Procedimentos: "Recorrentes" virou o botão de recorrência
      finalBeauty = (() => { const n = normalizeProcedureStatuses(finalBeauty); if (n !== finalBeauty) bg(storageSet(KEYS.beauty, n)); return n; })();
      // Exemplos de demonstração não existem mais: tira o que sobrou e nunca recria
      let finalFinance = fn, finalCareer = cr, finalJournal = jr, finalHouse = hs;
      {
        const dropDemo = (arr, key) => { const out = (arr || []).filter((x) => !x.demo); if (out.length !== (arr || []).length) bg(storageSet(key, out)); return out; };
        finalTasks = dropDemo(finalTasks, KEYS.tasks); finalGoals = dropDemo(finalGoals, KEYS.goals); finalHabits = dropDemo(finalHabits, KEYS.habits);
        finalFinance = dropDemo(finalFinance, KEYS.finance); finalNotes = dropDemo(finalNotes, KEYS.notes); finalStudy = dropDemo(finalStudy, KEYS.study);
        finalCareer = dropDemo(finalCareer, KEYS.career); finalRoutines = dropDemo(finalRoutines, KEYS.routines); finalBeauty = dropDemo(finalBeauty, KEYS.beauty);
        finalVision = dropDemo(finalVision, KEYS.vision); finalJournal = dropDemo(finalJournal, KEYS.journal); finalShopping = dropDemo(finalShopping, KEYS.shopping);
        finalHouse = dropDemo(finalHouse, KEYS.house);
      }
      // Estudos: cada assunto vira uma área e os cursos ficam dentro dela
      let finalStudyAreas = sar || [];
      { const ms = migrateStudyToAreas(finalStudy, finalStudyAreas);
        if (ms.changed) { finalStudy = ms.study; finalStudyAreas = ms.areas; bg(storageSet(KEYS.study, finalStudy)); bg(storageSet(KEYS.studyareas, finalStudyAreas)); } }
      { const ns = migrateSelfcareContent(normalizeSelfcareStatus(finalSelfcare));
        if (ns !== finalSelfcare) { finalSelfcare = ns; bg(storageSet(KEYS.selfcare, finalSelfcare)); } }
      // A página Notas foi excluída a pedido (os dados ficam guardados e podem voltar em Configurações)
      if (!notesGoneFlag) {
        finalSettings = { ...finalSettings, deletedPages: Array.from(new Set([...(finalSettings.deletedPages || []), "notes"])) };
        bg(storageSet(KEYS.settings, finalSettings)); bg(storageSet(NOTES_PAGE_REMOVED_FLAG_KEY, true));
      }
      // Valores que já existem nos dados entram nas listas editáveis, assim nada some da tela
      { const rs = reconcileLists(finalSettings, { goals: finalGoals, beauty: finalBeauty, selfcare: finalSelfcare, hobbies: finalHobbies, career: finalCareer, study: finalStudy, tasks: finalTasks, shopping: finalShopping, habits: finalHabits });
        if (rs !== finalSettings) { finalSettings = rs; bg(storageSet(KEYS.settings, finalSettings)); } }
      // Dá um status editável às tarefas antigas sem alterar seu estado de conclusão.
      { const statuses = Array.isArray(finalSettings.lists?.taskStatus) ? finalSettings.lists.taskStatus : LIST_REGISTRY.taskStatus.defaults;
        let changed = false;
        finalTasks = finalTasks.map((task) => {
          if (typeof task.status === "string") return task;
          const status = statuses.find((item) => !!item.closed === !!task.done) || statuses[0];
          if (!status) return task;
          changed = true;
          return { ...task, status: status.id };
        });
        if (changed) bg(storageSet(KEYS.tasks, finalTasks)); }
      // Google Agenda: converte o formato antigo (uma agenda) para a lista de agendas
      setGcalState(normalizeGcal(gcalSaved));
      setStudyAreasState(finalStudyAreas);
      setPagesState(pgs || []); setPlacesState(plc || []); setInvestmentsState(inv || []);
      setTasksState(finalTasks); setGoalsState(finalGoals); setHabitsState(finalHabits); setFinanceState(finalFinance);
      setNotesState(finalNotes); setAreasState(ar); setAppsState(finalApps); setSettingsState(finalSettings);
      setStudyState(finalStudy); setCareerState(finalCareer); setRoutinesState(finalRoutines); setBeautyState(finalBeauty);
      setVisionState(finalVision); setJournalState(finalJournal); setShoppingState(finalShopping); setHouseState(finalHouse);
      setHobbiesState(finalHobbies); setSelfcareState(finalSelfcare);
      setAccountsState(acc); setCardsState(crd);
      setPersonaldevState(finalPersonaldev);
      } catch (e) {
        console.error("Erro ao carregar dados do Supabase.", e);
        const errorMessage = e && typeof e === "object" && typeof e.message === "string"
          ? [e.message, e.code && `Código: ${e.code}`, e.details, e.hint].filter(Boolean).join(" ")
          : e instanceof Error ? e.message : "Não foi possível carregar seus dados.";
        setLoadError(errorMessage);
      } finally {
        setLoaded(true);
      }
  }, []);

  useEffect(() => { loadAllData(); }, [loadAllData]);

  useEffect(() => {
    const onHashChange = () => setTabState(tabFromHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const deleted = settings.deletedPages || [];
    const builtinPageExists = NAV.some((item) => item.id === tab && !deleted.includes(tab));
    const customPageExists = tab.startsWith("page:")
      && pages.some((page) => `page:${page.id}` === tab);
    if (!builtinPageExists && !customPageExists && !["routines", "house", "journal"].includes(tab)) {
      setTab("dashboard");
    }
  }, [loaded, pages, settings.deletedPages, setTab, tab]);

  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAllData();
    setRefreshing(false);
  }, [loadAllData]);

  const setTasks = useCallback((v) => { setTasksState(v); return storageSet(KEYS.tasks, v); }, []);
  const setGoals = useCallback((v) => { setGoalsState(v); return storageSet(KEYS.goals, v); }, []);
  const setHabits = useCallback((v) => { setHabitsState(v); return storageSet(KEYS.habits, v); }, []);
  const setFinance = useCallback((v) => { setFinanceState(v); return storageSet(KEYS.finance, v); }, []);
  const setNotes = useCallback((v) => { setNotesState(v); return storageSet(KEYS.notes, v); }, []);
  const setAreas = useCallback((v) => { setAreasState(v); return storageSet(KEYS.areas, v); }, []);
  const setApps = useCallback((v) => { setAppsState(v); return storageSet(KEYS.apps, v); }, []);
  const setSettings = useCallback((v) => { setSettingsState(v); return storageSet(KEYS.settings, v); }, []);
  const setStudy = useCallback((v) => { setStudyState(v); return storageSet(KEYS.study, v); }, []);
  const setCareer = useCallback((v) => { setCareerState(v); return storageSet(KEYS.career, v); }, []);
  const setRoutines = useCallback((v) => { setRoutinesState(v); return storageSet(KEYS.routines, v); }, []);
  const setBeauty = useCallback((v) => { setBeautyState(v); return storageSet(KEYS.beauty, v); }, []);
  const setVision = useCallback((v) => { setVisionState(v); return storageSet(KEYS.vision, v); }, []);
  const setJournal = useCallback((v) => { setJournalState(v); return storageSet(KEYS.journal, v); }, []);
  const setShopping = useCallback((v) => { setShoppingState(v); return storageSet(KEYS.shopping, v); }, []);
  const setHouse = useCallback((v) => { setHouseState(v); return storageSet(KEYS.house, v); }, []);
  const setHobbies = useCallback((v) => { setHobbiesState(v); return storageSet(KEYS.hobbies, v); }, []);
  const setPersonaldev = useCallback((v) => { setPersonaldevState(v); return storageSet(KEYS.personaldev, v); }, []);
  const setSelfcare = useCallback((v) => { setSelfcareState(v); return storageSet(KEYS.selfcare, v); }, []);
  const setAccounts = useCallback((v) => { setAccountsState(v); return storageSet(KEYS.accounts, v); }, []);
  const setCards = useCallback((v) => { setCardsState(v); return storageSet(KEYS.cards, v); }, []);
  const setGcal = useCallback((v) => { setGcalState(v); return storageSet(KEYS.gcal, v); }, []);
  const automaticCalendarRefresh = useRef(false);
  useEffect(() => {
    if (!loaded || automaticCalendarRefresh.current || !gcal.calendars.some(canRefreshCalendar)) return;
    automaticCalendarRefresh.current = true;
    const refresh = async () => {
      try {
        const next = await refreshAllCalendars(gcal);
        const saved = await setGcal(next);
        if (saved === false) throw new Error("As agendas foram atualizadas, mas não foi possível salvar a cópia. Confira a conexão.");
        const failed = next.calendars.filter((c) => c.lastError).length;
        if (failed) notify(`${failed} agenda(s) não atualizaram. Abra "Gerenciar agendas" para ver o motivo.`);
      } catch (error) {
        notify(error instanceof Error ? error.message : "Não foi possível atualizar as agendas.");
      }
    };
    void refresh();
  }, [gcal, loaded, setGcal]);
  const setStudyAreas = useCallback((v) => { setStudyAreasState(v); return storageSet(KEYS.studyareas, v); }, []);
  const setPages = useCallback((v) => { setPagesState(v); return storageSet(KEYS.pages, v); }, []);
  const setPlaces = useCallback((v) => { setPlacesState(v); return storageSet(KEYS.places, v); }, []);
  const setInvestments = useCallback((v) => { setInvestmentsState(v); return storageSet(KEYS.investments, v); }, []);

  const restoreBackup = async (backup) => {
    if (!backup || typeof backup !== "object" || Array.isArray(backup)) {
      throw new Error("O arquivo não contém um backup válido da Central.");
    }
    const writes = [];
    if (backup.tasks) writes.push(setTasks(backup.tasks));
    if (backup.goals) writes.push(setGoals(backup.goals));
    if (backup.habits) writes.push(setHabits(backup.habits));
    if (backup.finance) writes.push(setFinance(backup.finance));
    if (backup.notes) writes.push(setNotes(backup.notes));
    if (backup.areas) writes.push(setAreas(backup.areas));
    if (backup.apps) writes.push(setApps(backup.apps));
    if (backup.settings) writes.push(setSettings(backup.settings));
    if (backup.study) writes.push(setStudy(backup.study));
    if (backup.career) writes.push(setCareer(backup.career));
    if (backup.routines) writes.push(setRoutines(backup.routines));
    if (backup.beauty) writes.push(setBeauty(backup.beauty));
    if (backup.vision) writes.push(setVision(backup.vision));
    if (backup.journal) writes.push(setJournal(backup.journal));
    if (backup.shopping) writes.push(setShopping(backup.shopping));
    if (backup.house) writes.push(setHouse(backup.house));
    if (backup.hobbies) writes.push(setHobbies(backup.hobbies));
    if (backup.selfcare) writes.push(setSelfcare(backup.selfcare));
    if (backup.accounts) writes.push(setAccounts(backup.accounts));
    if (backup.cards) writes.push(setCards(backup.cards));
    if (backup.personaldev) writes.push(setPersonaldev(backup.personaldev));
    if (backup.pages) writes.push(setPages(backup.pages));
    if (backup.places) writes.push(setPlaces(backup.places));
    if (backup.investments) writes.push(setInvestments(backup.investments));
    if (backup.studyAreas) writes.push(setStudyAreas(backup.studyAreas));
    if (backup.gcal) writes.push(setGcal(normalizeGcal(backup.gcal)));
    if (writes.length === 0) {
      throw new Error("O arquivo não contém dados reconhecidos da Central.");
    }
    const results = await Promise.all(writes);
    if (results.some((saved) => !saved)) {
      throw new Error("Uma ou mais partes do backup não foram salvas. Verifique a conexão e tente importar novamente.");
    }
  };

  const allData = { tasks, goals, habits, finance, notes, areas, apps, settings, study, career, routines, beauty, vision, journal, shopping, house, hobbies, selfcare, accounts, cards, personaldev, pages, places, investments, studyAreas, gcal };

  // se a página aberta foi excluída, vai para a primeira que sobrou
  useEffect(() => {
    const gone = (settings.deletedPages || []);
    if (loaded && gone.includes(tab)) {
      const first = NAV.find((n) => !gone.includes(n.id));
      setTab(first ? first.id : "settings");
    }
  }, [loaded, settings, tab]);

  if (!loaded) {
    return (
      <div className="central-root" style={{ alignItems: "center", justifyContent: "center" }}>
        <GlobalStyle />
        <p className="cr-sub">Carregando sua central…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="central-root" style={{ alignItems: "center", justifyContent: "center", padding: 24 }}>
        <GlobalStyle />
        <div className="cr-card" role="alert" style={{ maxWidth: 520 }}>
          <h1 className="cr-serif">Não foi possível carregar seus dados</h1>
          <p className="cr-sub">{loadError}</p>
          <button className="cr-btn primary" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? "Tentando novamente…" : "Tentar novamente"}
          </button>
        </div>
      </div>
    );
  }

  setActiveSettings(settings);
  const theme = settings.theme || DEFAULT_SETTINGS.theme;
  const pageNames = settings.pageNames || {};
  const deletedPages = settings.deletedPages || [];
  const labelOf = (n) => pageNames[n.id] || n.label;
  const builtin = NAV.filter((n) => n.id !== "settings" && !deletedPages.includes(n.id)).map((n) => ({ ...n, label: labelOf(n) }));
  const settingsNav = NAV.filter((n) => n.id === "settings").map((n) => ({ ...n, label: labelOf(n) }));
  const customNav = pages.map((pg) => ({ id: "page:" + pg.id, pageId: pg.id, label: pg.name || "Sem nome", icon: FileText, custom: true }));
  const pageOrder = settings.pageOrder || [];
  const middle = [...builtin, ...customNav].sort((x, y) => {
    const ix = pageOrder.indexOf(x.id), iy = pageOrder.indexOf(y.id);
    return (ix < 0 ? 9999 : ix) - (iy < 0 ? 9999 : iy);
  });
  const navItems = [...middle, ...settingsNav];
  const movePage = (id, dir) => {
    const ids = middle.map((x) => x.id);
    const i = ids.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setSettings({ ...settings, pageOrder: ids });
  };
  const currentPage = tab.startsWith("page:") ? pages.find((pg) => "page:" + pg.id === tab) : null;
  const savePageName = (data) => {
    if (data.builtin) { setSettings({ ...settings, pageNames: { ...pageNames, [data.id]: data.name } }); return; }
    if (pages.some((pg) => pg.id === data.id)) setPages(pages.map((pg) => pg.id === data.id ? { ...pg, name: data.name } : pg));
    else { setPages([...pages, { id: data.id, name: data.name, notes: "", checklist: [], links: [] }]); setTab("page:" + data.id); }
  };
  const firstVisible = () => (middle[0] ? middle[0].id : "settings");
  const wipePageData = (id) => {
    const map = { notes: () => setNotes([]), goals: () => setGoals([]), habits: () => setHabits([]), finance: () => { setFinance([]); setInvestments([]); },
      study: () => { setStudy([]); setStudyAreas([]); }, career: () => setCareer([]), beauty: () => { setBeauty([]); setPlaces([]); }, selfcare: () => setSelfcare([]),
      hobbies: () => setHobbies([]), personaldev: () => setPersonaldev([]), shopping: () => setShopping([]), vision: () => setVision([]), apps: () => setApps([]),
      tasks: () => { setTasks([]); setRoutines([]); } };
    if (map[id]) map[id]();
  };
  const deletePage = (target, wipe) => {
    if (target.custom) setPages(pages.filter((pg) => pg.id !== target.pageId));
    else {
      setSettings({ ...settings, deletedPages: Array.from(new Set([...deletedPages, target.id])) });
      if (wipe) wipePageData(target.id);
    }
    if (tab === target.id) setTab(firstVisible());
    setConfirmPage(null);
  };
  const restorePage = (id) => setSettings({ ...settings, deletedPages: deletedPages.filter((x) => x !== id) });
  const pageOf = (id) => (NAV.find((n) => n.id === id) || {}).label || id;
  // páginas excluídas também somem da busca
  const hiddenKeys = { notes: ["notes"], goals: ["goals"], habits: ["habits"], finance: ["finance"], study: ["study"], career: ["career"], beauty: ["beauty"], selfcare: ["selfcare"], hobbies: ["hobbies"], personaldev: ["personaldev"], shopping: ["shopping"], vision: ["vision"], apps: ["apps"], tasks: ["tasks", "routines"] };
  const searchData = { ...allData };
  deletedPages.forEach((id) => (hiddenKeys[id] || []).forEach((k) => { searchData[k] = []; }));

  const collectionsMap = { vision: [vision, setVision], accounts: [accounts, setAccounts], personaldev: [personaldev, setPersonaldev], tasks: [tasks, setTasks], shopping: [shopping, setShopping], habits: [habits, setHabits], goals: [goals, setGoals], beauty: [beauty, setBeauty], selfcare: [selfcare, setSelfcare], hobbies: [hobbies, setHobbies], career: [career, setCareer], study: [study, setStudy], finance: [finance, setFinance] };
  const listsCtx = { openManager: (key) => setManager({ kind: "list", key }), openAreas: () => setManager({ kind: "areas" }), openPrices: () => setManager({ kind: "prices" }) };
  const renderManager = () => {
    if (!manager) return null;
    if (manager.kind === "prices") return <PriceBandsManager bands={getPriceBands()} setBands={(arr) => setSettings({ ...settings, priceBands: arr })} onClose={() => setManager(null)} />;
    if (manager.kind === "areas") {
      const usage = (id) => [tasks, goals, habits, notes].reduce((n, arr) => n + arr.filter((x) => x.area === id).length, 0);
      return <AreaManagerModal areas={areas} setAreas={setAreas} usageCount={usage} onClose={() => setManager(null)} />;
    }
    const key = manager.key; const reg = LIST_REGISTRY[key];
    const setItems = (arr) => {
      if (reg.kind === "strings") setSettings({ ...settings, [reg.settingsKey]: arr.map((x) => x.name) });
      else setSettings({ ...settings, lists: { ...(settings.lists || {}), [key]: arr } });
    };
    const usage = (id) => (reg.usedBy || []).reduce((n, [coll, field, pred]) => n + ((collectionsMap[coll] || [[]])[0]).filter((it) => it[field] === id && (!pred || pred(it))).length, 0);
    const onDeleteItem = (id) => {
      if (reg.kind === "strings") return;
      (reg.usedBy || []).forEach(([coll, field, pred]) => { const [arr, setter] = collectionsMap[coll]; if (arr.some((it) => it[field] === id && (!pred || pred(it)))) setter(arr.map((it) => it[field] === id && (!pred || pred(it)) ? { ...it, [field]: "" } : it)); });
    };
    const onRename = (oldName, newName) => {
      (reg.usedBy || []).forEach(([coll, field, pred]) => { const [arr, setter] = collectionsMap[coll]; if (arr.some((it) => it[field] === oldName && (!pred || pred(it)))) setter(arr.map((it) => it[field] === oldName && (!pred || pred(it)) ? { ...it, [field]: newName } : it)); });
    };
    return <ListManagerModal key={key} listKey={key} items={getList(key)} setItems={setItems} usageCount={usage} onDeleteItem={onDeleteItem} onRename={onRename} onClose={() => setManager(null)} />;
  };
  const renderNavItem = (n) => {
    const Icon = n.icon;
    return (
      <div className="cr-navrow" key={n.id}>
        <button className={`cr-navitem ${tab === n.id ? "active" : ""}`} aria-current={tab === n.id ? "page" : undefined}
          onClick={() => { setTab(n.id); setMobileMore(false); }}>
          <Icon size={16} /> {n.label}
        </button>
        {navEdit && n.id !== "settings" && (
          <>
            <button className="cr-btn ghost" style={{ padding: "4px 5px" }} title="Subir" onClick={() => movePage(n.id, -1)}>↑</button>
            <button className="cr-btn ghost" style={{ padding: "4px 5px" }} title="Descer" onClick={() => movePage(n.id, 1)}>↓</button>
          </>
        )}
        {navEdit && (
          <button className="cr-btn ghost" style={{ padding: "4px 6px" }} title="Renomear"
            onClick={() => setPageModal({ id: n.custom ? n.pageId : n.id, name: n.label, builtin: !n.custom })}><Pencil size={12} /></button>
        )}
        {navEdit && n.id !== "settings" && (
          <button className="cr-btn ghost danger" style={{ padding: "4px 6px" }} title="Excluir página"
            onClick={() => setConfirmPage(n)}><Trash2 size={12} /></button>
        )}
      </div>
    );
  };
  const mobileShortcutIds = ["dashboard", "tasks", "finance", "search"];
  const mobileShortcuts = mobileShortcutIds.map((id) => navItems.find((item) => item.id === id)).filter(Boolean);
  return (
    <ListsContext.Provider value={listsCtx}>
    <div className="central-root" style={{ "--clay": theme.clay, "--rose": theme.rose, "--sage": theme.sage }}>
      <GlobalStyle />
      <div className="cr-sidebar">
        <button className="cr-brand cr-serif" title="Ir para o Dashboard" onClick={() => setTab(navItems.some((n) => n.id === "dashboard") ? "dashboard" : firstVisible())}
          style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", textAlign: "left", width: "100%" }}>✦ Central</button>
        <div className="cr-navtools">
          <button className="cr-btn ghost" onClick={() => setPageModal("new")} title="Criar uma nova página"><Plus size={13} /> Página</button>
          <button className="cr-btn ghost" onClick={() => setNavEdit(!navEdit)} title="Renomear ou excluir páginas"><Pencil size={12} /> {navEdit ? "Pronto" : "Editar"}</button>
        </div>
        {navItems.map(renderNavItem)}
        <button className="cr-navitem" style={{ marginTop: "auto", fontSize: 12 }} onClick={handleRefresh} disabled={refreshing}>
          <Download size={14} /> {refreshing ? "Atualizando…" : "Atualizar dados"}
        </button>
        <button className="cr-navitem" style={{ fontSize: 12 }} onClick={onSignOut}>Sair da conta Google</button>
        <p className="cr-sub" style={{ margin: "4px 10px 0", fontSize: 11, opacity: 0.8 }}>Central, {APP_BUILD}</p>
      </div>
      <nav className="cr-mobile-nav" aria-label="Navegação principal">
        {mobileShortcuts.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id} type="button" className={`cr-mobile-tab ${tab === item.id ? "active" : ""}`}
              aria-current={tab === item.id ? "page" : undefined} onClick={() => setTab(item.id)}>
              <Icon size={19} /><span>{item.id === "tasks" ? "Planejamento" : item.label}</span>
            </button>
          );
        })}
        <button type="button" className={`cr-mobile-tab ${mobileMore || !mobileShortcutIds.includes(tab) ? "active" : ""}`}
          aria-expanded={mobileMore} onClick={() => setMobileMore((open) => !open)}>
          <ListChecks size={19} /><span>Mais</span>
        </button>
      </nav>
      {mobileMore && (
        <div className="cr-mobile-drawer-backdrop" onClick={() => setMobileMore(false)}>
          <section className="cr-mobile-drawer" role="dialog" aria-modal="true" aria-label="Mais páginas"
            onClick={(event) => event.stopPropagation()}>
            <div className="cr-row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <h2 className="cr-serif" style={{ margin: 0, fontSize: 20 }}>✦ Central</h2>
              <button className="cr-btn ghost" type="button" onClick={() => setMobileMore(false)} aria-label="Fechar menu"><X size={18} /></button>
            </div>
            <div className="cr-mobile-drawer-actions">
              <button className="cr-btn ghost" type="button" onClick={() => { setPageModal("new"); setMobileMore(false); }}><Plus size={14} /> Página</button>
              <button className="cr-btn ghost" type="button" onClick={() => setNavEdit((edit) => !edit)}><Pencil size={14} /> {navEdit ? "Concluir edição" : "Editar páginas"}</button>
            </div>
            {navItems.map(renderNavItem)}
            <button className="cr-navitem" type="button" onClick={handleRefresh} disabled={refreshing}>
              <Download size={14} /> {refreshing ? "Atualizando…" : "Atualizar dados"}
            </button>
            <button className="cr-navitem" type="button" onClick={onSignOut}>Sair da conta Google</button>
          </section>
        </div>
      )}
      <div className="cr-main">
        {tab === "dashboard" && <Dashboard tasks={tasks} goals={goals} habits={habits} finance={finance} notes={notes} areas={areas} settings={settings} personaldev={personaldev} setTasks={setTasks} setHabits={setHabits} setSettings={setSettings} goTo={setTab} />}
        {tab === "search" && <GlobalSearchView query={searchQuery} setQuery={setSearchQuery} all={searchData} goTo={setTab} />}
        {tab === "tasks" && <PlanningHub tasks={tasks} setTasks={setTasks} routines={routines} setRoutines={setRoutines} areas={areas} initial="tarefas" gcal={gcal} setGcal={setGcal} />}
        {tab === "routines" && <PlanningHub key="routines" tasks={tasks} setTasks={setTasks} routines={routines} setRoutines={setRoutines} areas={areas} initial="rotinas" gcal={gcal} setGcal={setGcal} />}
        {currentPage && <CustomPageView key={currentPage.id} page={currentPage} setPage={(updated) => setPages(pages.map((pg) => pg.id === updated.id ? updated : pg))} />}
        {tab === "goals" && <GoalsView goals={goals} setGoals={setGoals} areas={areas} />}
        {tab === "habits" && <HabitsView habits={habits} setHabits={setHabits} areas={areas} />}
        {tab === "finance" && <FinanceView finance={finance} setFinance={setFinance} accounts={accounts} setAccounts={setAccounts} cards={cards} setCards={setCards} settings={settings} setSettings={setSettings} investments={investments} setInvestments={setInvestments} />}
        {tab === "study" && <StudyView study={study} setStudy={setStudy} studyAreas={studyAreas} setStudyAreas={setStudyAreas} />}
        {tab === "career" && <CareerView career={career} setCareer={setCareer} />}
        {tab === "beauty" && <BeautyView beauty={beauty} setBeauty={setBeauty} places={places} setPlaces={setPlaces} settings={settings} setSettings={setSettings} />}
        {tab === "selfcare" && <SelfCareView selfcare={selfcare} setSelfcare={setSelfcare} />}
        {tab === "hobbies" && <HobbiesView hobbies={hobbies} setHobbies={setHobbies} />}
        {tab === "personaldev" && <PersonalDevView personaldev={personaldev} setPersonaldev={setPersonaldev} settings={settings} setSettings={setSettings} />}
        {tab === "house" && <HouseView house={house} setHouse={setHouse} />}
        {tab === "shopping" && <ShoppingView shopping={shopping} setShopping={setShopping} />}
        {tab === "notes" && <NotesView notes={notes} setNotes={setNotes} areas={areas} />}
        {tab === "journal" && <JournalView journal={journal} setJournal={setJournal} />}
        {tab === "vision" && <VisionView vision={vision} setVision={setVision} />}
        {tab === "apps" && <AppsView apps={apps} setApps={setApps} />}
        {tab === "settings" && <SettingsView areas={areas} setAreas={setAreas} settings={settings} setSettings={setSettings} allData={allData} restoreBackup={restoreBackup} deletedPages={deletedPages} pageOf={pageOf} onRestorePage={restorePage} onRefresh={handleRefresh} refreshing={refreshing} />}
      </div>
      {pageModal && <PageNameModal item={pageModal === "new" ? null : pageModal} onSave={savePageName} onClose={() => setPageModal(null)} />}
      {confirmPage && <PageDeleteModal name={confirmPage.label} builtin={!confirmPage.custom} onConfirm={(wipe) => deletePage(confirmPage, wipe)} onCancel={() => setConfirmPage(null)} />}
      {renderManager()}
    </div>
    </ListsContext.Provider>
  );
}
