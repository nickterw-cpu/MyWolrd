import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders as supabaseCorsHeaders } from "npm:@supabase/supabase-js@2/cors";

const corsHeaders = {
  ...supabaseCorsHeaders,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

function calendarEvent(item: Record<string, unknown>) {
  const start = item.start as Record<string, string> | undefined;
  const end = item.end as Record<string, string> | undefined;
  if (!start || !end || (!start.date && !start.dateTime) || (!end.date && !end.dateTime)) return null;
  const allDay = Boolean(start.date);
  const startValue = allDay ? start.date : start.dateTime.slice(0, 16);
  const endValue = allDay ? end.date : end.dateTime.slice(0, 16);
  const description = typeof item.description === "string" ? item.description : "";
  const meet = typeof item.hangoutLink === "string"
    ? item.hangoutLink
    : description.match(/https:\/\/meet\.google\.com\/[a-z0-9-]+/i)?.[0] || "";
  return {
    id: String(item.id || crypto.randomUUID()),
    t: typeof item.summary === "string" ? item.summary : "(sem título)",
    s: startValue,
    e: endValue,
    ad: allDay,
    loc: typeof item.location === "string" ? item.location : "",
    meet,
    url: typeof item.htmlLink === "string" ? item.htmlLink : "",
  };
}

function validateIcsUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(value);
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

async function handleRequest(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Método não permitido." }, 405);

  const authorization = request.headers.get("Authorization") || "";
  const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return jsonResponse({ error: "Entre novamente para acessar a agenda." }, 401);

  let body: { icsUrl?: unknown };
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
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("As credenciais de runtime do Supabase não estão configuradas.");
    return jsonResponse({ error: "A função de agenda não está configurada corretamente." }, 500);
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authError } = await authClient.auth.getUser(accessToken);
  if (authError || !user) return jsonResponse({ error: "Sua sessão expirou. Entre novamente." }, 401);

  if (body.icsUrl !== undefined) {
    const icsUrl = validateIcsUrl(body.icsUrl);
    if (!icsUrl) return jsonResponse({ error: "Informe um link .ics privado válido do Google Agenda." }, 400);
    try {
      const response = await fetch(icsUrl, { redirect: "error" });
      if (!response.ok) {
        return jsonResponse({ error: `O Google não conseguiu fornecer o arquivo .ics (HTTP ${response.status}).` }, 502);
      }
      const text = await response.text();
      if (text.length > 5_000_000) return jsonResponse({ error: "O arquivo .ics é grande demais para importar." }, 413);
      return jsonResponse({ ics: text });
    } catch (error) {
      console.error("Falha ao buscar a agenda .ics do Google.", error);
      return jsonResponse({ error: "Não foi possível buscar o link .ics. Confira o endereço e tente novamente." }, 502);
    }
  }

  if (!clientId || !clientSecret) {
    console.error("Os secrets OAuth do Google não estão configurados na Edge Function.");
    return jsonResponse({ error: "A conexão Google ainda não está configurada no servidor." }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: tokenRow, error: tokenError } = await admin
    .from("google_tokens")
    .select("refresh_token")
    .eq("user_id", user.id)
    .maybeSingle();
  if (tokenError) {
    console.error("Não foi possível carregar a autorização Google do usuário.", tokenError);
    return jsonResponse({ error: "Não foi possível acessar a autorização da agenda." }, 500);
  }
  if (!tokenRow?.refresh_token) {
    return jsonResponse({ error: "Reconecte sua conta Google para autorizar o acesso à agenda.", reconnect: true }, 409);
  }

  const refreshResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokenRow.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const refreshResult = await refreshResponse.json();
  if (!refreshResponse.ok || typeof refreshResult.access_token !== "string") {
    if (refreshResult.error === "invalid_grant") {
      return jsonResponse({ error: "A autorização Google expirou ou foi revogada. Reconecte sua conta.", reconnect: true }, 401);
    }
    console.error("O Google recusou a renovação da autorização.", { status: refreshResponse.status, error: refreshResult.error });
    return jsonResponse({ error: "Não foi possível renovar a autorização Google. Tente novamente." }, 502);
  }

  const now = new Date();
  const timeMin = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 30)).toISOString();
  const timeMax = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 365)).toISOString();
  const events: ReturnType<typeof calendarEvent>[] = [];
  let pageToken: string | undefined;
  const seenPageTokens = new Set<string>();
  do {
    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "2500");
    url.searchParams.set("timeMin", timeMin);
    url.searchParams.set("timeMax", timeMax);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${refreshResult.access_token}` },
    });
    const result = await response.json();
    if (!response.ok) {
      console.error("A Google Calendar API recusou a solicitação.", { status: response.status });
      return jsonResponse({
        error: response.status === 401
          ? "A autorização Google expirou. Reconecte sua conta."
          : "Não foi possível carregar os eventos da agenda Google.",
        reconnect: response.status === 401,
      }, response.status === 401 ? 401 : 502);
    }
    for (const item of result.items || []) {
      if (item.status === "cancelled") continue;
      const event = calendarEvent(item);
      if (event) events.push(event);
    }
    pageToken = result.nextPageToken;
    if (pageToken && seenPageTokens.has(pageToken)) {
      console.error("A API Google Calendar retornou um cursor de paginação repetido.");
      return jsonResponse({ error: "A paginação da agenda retornou uma resposta inválida." }, 502);
    }
    if (pageToken) seenPageTokens.add(pageToken);
  } while (pageToken);

  return jsonResponse({ events, updatedAt: new Date().toISOString() });
}

Deno.serve(async (request) => {
  try {
    return await handleRequest(request);
  } catch (error) {
    console.error("Erro inesperado na Edge Function google-calendar.", error);
    return jsonResponse({ error: "Ocorreu um erro interno ao acessar a agenda Google." }, 500);
  }
});
