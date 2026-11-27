// Opções de listas editáveis (status etc.) com nome único: sem diferenciar maiúsculas, acentos e espaços nas pontas.

export function normalizeOptionName(name) {
  return String(name ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().replace(/\s+/g, " ").toLowerCase();
}

// Outro item da lista (diferente da linha `ownIndex`) já tem esse nome?
export function findDuplicateName(rows, name, ownIndex = -1) {
  const key = normalizeOptionName(name);
  if (!key) return false;
  return (rows || []).some((row, index) => index !== ownIndex && normalizeOptionName(row.name) === key);
}

// Junta opções com o mesmo nome em uma só. A principal é a do sistema (quando existe), senão a primeira.
// alignSystem: uma opção criada à mão com o nome de uma opção do sistema passa a usar o identificador do sistema.
// Devolve as opções, o mapa id antigo → id principal e o resumo do que foi unido.
export function unifyListOptions(options, systemDefaults = [], { alignSystem = false } = {}) {
  const list = Array.isArray(options) ? options : [];
  const systemByName = new Map((systemDefaults || []).map((option) => [normalizeOptionName(option.name), option]));
  const systemIds = new Set((systemDefaults || []).map((option) => option.id));
  const groups = new Map();
  list.forEach((option) => {
    const key = normalizeOptionName(option.name) || `id:${option.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(option);
  });
  const remap = {};
  const merged = [];
  let changed = false;
  const result = [];
  groups.forEach((members, key) => {
    const system = alignSystem ? systemByName.get(key) : null;
    const principal = members.find((option) => systemIds.has(option.id) && (!system || option.id === system.id))
      || (system ? { ...members[0], id: system.id, name: system.name } : members[0]);
    const from = [...new Set(members.map((option) => option.id).filter((id) => id !== principal.id))];
    from.forEach((id) => { remap[id] = principal.id; });
    if (members.length > 1 || principal !== members[0]) changed = true;
    if (from.length) merged.push({ name: principal.name, from, to: principal.id });
    result.push(principal);
  });
  return { options: changed ? result : list, remap, merged };
}

const getPath = (item, path) => path.split(".").reduce((value, key) => (value == null ? value : value[key]), item);
function setPath(item, [key, ...rest], value) {
  return { ...item, [key]: rest.length ? setPath(item?.[key] || {}, rest, value) : value };
}

// Troca, nos itens, o valor do campo (pode ser "a.b") conforme o mapa. Só mexe em quem precisa.
export function remapField(items, field, remap, pred) {
  const list = Array.isArray(items) ? items : [];
  let moved = 0;
  const out = list.map((item) => {
    if (!item || (pred && !pred(item))) return item;
    const value = getPath(item, field);
    if (typeof value !== "string" || !Object.prototype.hasOwnProperty.call(remap, value)) return item;
    moved += 1;
    return setPath(item, field.split("."), remap[value]);
  });
  return { items: moved ? out : list, moved };
}
