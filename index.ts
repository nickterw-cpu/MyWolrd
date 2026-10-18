import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders as supabaseCorsHeaders } from "npm:@supabase/supabase-js@2/cors";

const MAX_LINKS_PER_USER = 30;
const MAX_ICS_CHARS = 5_000_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const corsHeaders = {
  ...supabaseCorsHeaders,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

class HttpError extends Error {
  status: number;
  extra: Record<string, unknown>;
  constructor(status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function validateIcsUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:"
    || url.hostname !== "calendar.google.com"
    || url.port
    || url.username
    || url.password
    || !/^\/calendar\/ical\/[^/]+\/(?:public|private-[^/]+)\/basic\.ics$/.test(url.pathname)
  ) return null;
  return url;
}

function getKeyFromEnvironment(value: string | undefined, name: string): string | null {
  if (!value) return null;
  let keys: Record<string, unknown>;
  try {
    keys = JSON.parse(value);
  } catch (error) {
    console.error(`A variável ${name} não contém um mapa JSON válido.`, error);
    return null;
  }
  const key = keys.default;
  return typeof key === "string" && key.length > 0 ? key : null;
}

async function downloadIcs(url: URL): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, { redirect: "error" });
  } catch (error) {
    console.error("Falha ao buscar a agenda .ics do Google.", error);
    throw new HttpError(502, "Não foi possível buscar o link .ics. Confira o endereço e tente novamente.");
  }
  if (!response.ok) {
    throw new HttpError(502, `O Google não conseguiu fornecer o arquivo .ics (HTTP ${response.status}).`);
  }
  const text = await response.text();
  if (text.length > MAX_ICS_CHARS) throw new HttpError(413, "O arquivo .ics é grande demais para importar.");
  if (!text.includes("BEGIN:VCALENDAR")) {
    throw new HttpError(422, "O endereço não retornou uma agenda válida. Copie o \"Endereço secreto no formato iCal\".");
  }
  return text;
}

async function handleRequest(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Método não permitido." }, 405);

  const authorization = request.headers.get("Authorization") || "";
  const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return jsonResponse({ error: "Entre novamente para acessar a agenda." }, 401);

  let body: { action?: unknown; icsUrl?: unknown; linkId?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "A solicitação está inválida." }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ error: "A solicitação está inválida." }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = request.headers.get("apikey")
    || Deno.env.get("SUPABASE_ANON_KEY")
    || getKeyFromEnvironment(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"), "SUPABASE_PUBLISHABLE_KEYS");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    || getKeyFromEnvironment(Deno.env.get("SUPABASE_SECRET_KEYS"), "SUPABASE_SECRET_KEYS");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("As credenciais de runtime do Supabase não estão configuradas.");
    return jsonResponse({ error: "A função de agenda não está configurada corretamente." }, 500);
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authError } = await authClient.auth.getUser(accessToken);
  if (authError || !user) return jsonResponse({ error: "Sua sessão expirou. Entre novamente." }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // Salva o link secreto no Supabase (se já existir para este usuário, reaproveita o registro).
    if (body.action === "add-link") {
      const icsUrl = validateIcsUrl(body.icsUrl);
      if (!icsUrl) return jsonResponse({ error: "Informe um link .ics secreto válido do Google Agenda." }, 400);
      const href = icsUrl.toString();
      const ics = await downloadIcs(icsUrl);

      const { data: existing, error: findError } = await admin
        .from("calendar_links")
        .select("id")
        .eq("user_id", user.id)
        .eq("ics_url", href)
        .maybeSingle();
      if (findError) {
        console.error("Não foi possível consultar os links de agenda.", findError);
        return jsonResponse({ error: "Não foi possível salvar o link da agenda." }, 500);
      }
      if (existing) return jsonResponse({ id: existing.id, ics, existing: true });

      const { count, error: countError } = await admin
        .from("calendar_links")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id);
      if (countError) {
        console.error("Não foi possível contar os links de agenda.", countError);
        return jsonResponse({ error: "Não foi possível salvar o link da agenda." }, 500);
      }
      if ((count ?? 0) >= MAX_LINKS_PER_USER) {
        return jsonResponse({ error: `O limite é de ${MAX_LINKS_PER_USER} agendas. Remova alguma antes de adicionar mais.` }, 409);
      }

      const { data: inserted, error: insertError } = await admin
        .from("calendar_links")
        .insert({ user_id: user.id, ics_url: href })
        .select("id")
        .single();
      if (insertError || !inserted) {
        console.error("Não foi possível guardar o link da agenda.", insertError);
        return jsonResponse({ error: "Não foi possível salvar o link da agenda." }, 500);
      }
      return jsonResponse({ id: inserted.id, ics, existing: false });
    }

    // Busca de novo o conteúdo de um link já salvo (o navegador só conhece o id).
    if (body.action === "fetch-link") {
      if (typeof body.linkId !== "string" || !UUID_PATTERN.test(body.linkId)) {
        return jsonResponse({ error: "A solicitação está inválida." }, 400);
      }
      const { data: row, error } = await admin
        .from("calendar_links")
        .select("ics_url")
        .eq("id", body.linkId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) {
        console.error("Não foi possível carregar o link da agenda.", error);
        return jsonResponse({ error: "Não foi possível acessar o link da agenda." }, 500);
      }
      if (!row) return jsonResponse({ error: "Este link não está mais salvo no servidor.", missing: true }, 404);
      const icsUrl = validateIcsUrl(row.ics_url);
      if (!icsUrl) return jsonResponse({ error: "O link salvo é inválido. Remova a agenda e adicione de novo." }, 422);
      return jsonResponse({ ics: await downloadIcs(icsUrl) });
    }

    if (body.action === "remove-link") {
      if (typeof body.linkId !== "string" || !UUID_PATTERN.test(body.linkId)) {
        return jsonResponse({ error: "A solicitação está inválida." }, 400);
      }
      const { error } = await admin
        .from("calendar_links")
        .delete()
        .eq("id", body.linkId)
        .eq("user_id", user.id);
      if (error) {
        console.error("Não foi possível remover o link da agenda.", error);
        return jsonResponse({ error: "Não foi possível remover o link da agenda." }, 500);
      }
      return jsonResponse({ removed: true });
    }

    return jsonResponse({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    if (error instanceof HttpError) return jsonResponse({ error: error.message, ...error.extra }, error.status);
    throw error;
  }
}

Deno.serve(async (request) => {
  try {
    return await handleRequest(request);
  } catch (error) {
    console.error("Erro inesperado na Edge Function google-calendar.", error);
    return jsonResponse({ error: "Ocorreu um erro interno ao acessar a agenda." }, 500);
  }
});
