(function () {
  const STORAGE_KEY = "edj-zero-state-v1";
  const app = document.getElementById("app");
  const modalRoot = document.getElementById("modalRoot");
  const printArea = document.getElementById("printArea");
  const SUPABASE_CONFIG = window.EDJ_SUPABASE_CONFIG || {};
  const supabaseConfigured = Boolean(SUPABASE_CONFIG.url && SUPABASE_CONFIG.anonKey);
  const supabaseApi = supabaseConfigured ? createSupabaseApi(SUPABASE_CONFIG) : null;
  let supabaseReady = false;
  let cloudSaveTimer = null;
  let cloudSaving = false;
  let cloudSavePending = false;
  let routeHistory = [];

  const statusLabels = {
    pendente: "Pendente",
    aguardando_aprovacao: "Aguardando aprovação",
    aprovado: "Aprovado",
    em_andamento: "Em andamento",
    aguardando_pagamento: "Aguardando pagamento",
    concluido: "Concluído",
    cancelado: "Cancelado",
  };

  const statusOrder = Object.keys(statusLabels);

  const defaultState = {
    logged: false,
    companyId: null,
    theme: "dark",
    currentUserEmail: "",
    route: "dashboard",
    activeClientId: null,
    activeQuoteId: null,
    activeProjectId: null,
    activeQuoteTab: "summary",
    activeStatus: null,
    quotesStatusOpen: false,
    financePeriod: "month",
    financeStart: "",
    financeEnd: "",
    clients: [],
    materials: [],
    quotes: [],
    projects: [],
    receivables: [],
    expenses: [],
    employees: [],
    timeEntries: [],
    holidays: [],
    users: [
      { id: uid(), name: "Administrador", email: "admin@serralheria.com", role: "admin", active: true },
    ],
    settings: {
      companyName: "EDJ Soluções em Manutenção",
      document: "61.354.596/0001-12",
      email: "edjsolucoes@hotmail.com",
      phone: "+55 (81) 98269-1798",
      address: "Belo Jardim - PE",
      pix: "",
      pixType: "Chave PIX",
      bank: "",
      agency: "",
      account: "",
      holder: "",
      acceptsCreditCard: "false",
      cardInstallments: "3",
      cardFeePct: "0",
      defaultTerms: "Orçamento válido conforme prazo informado.",
    },
    costSettings: {
      defaultMarginPct: 30,
      paintPriceM2: 0,
      laborRoles: [
        { id: uid(), role: "Serralheiro", dailyRate: 0 },
        { id: uid(), role: "Soldador", dailyRate: 0 },
        { id: uid(), role: "Pedreiro", dailyRate: 0 },
        { id: uid(), role: "Servente", dailyRate: 0 },
        { id: uid(), role: "Ajudante de serralheria", dailyRate: 0 },
        { id: uid(), role: "Encarregado", dailyRate: 0 },
      ],
      workday: {
        morningStart: "07:00",
        morningEnd: "11:30",
        afternoonStart: "13:00",
        afternoonEnd: "17:00",
        weekdayExtraPct: 50,
        saturdayExtraPct: 50,
        sundayHolidayExtraPct: 100,
      },
    },
  };

  let state = loadState();
  normalizeState();
  if (!supabaseConfigured) applyEmbeddedImport();

  function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createSupabaseApi(config) {
    const baseUrl = String(config.url || "").replace(/\/+$/, "");
    const anonKey = config.anonKey;
    const sessionKey = "edj-supabase-session";

    function readSession() {
      try {
        return JSON.parse(localStorage.getItem(sessionKey) || "null");
      } catch (_) {
        return null;
      }
    }

    function writeSession(session) {
      localStorage.setItem(sessionKey, JSON.stringify(session));
    }

    function clearSession() {
      localStorage.removeItem(sessionKey);
    }

    async function request(path, options = {}) {
      const session = readSession();
      const headers = {
        apikey: anonKey,
        ...(session && session.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      };
      const response = await fetch(`${baseUrl}${path}`, {
        method: options.method || "GET",
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      if (!response.ok) throw await readSupabaseError(response);
      if (response.status === 204) return null;
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    }

    async function readSupabaseError(response) {
      try {
        const body = await response.json();
        return new Error(body.message || body.error_description || body.error || response.statusText);
      } catch (_) {
        return new Error(response.statusText || "Erro no Supabase");
      }
    }

    function storeAuthSession(data) {
      const session = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Date.now() + Number(data.expires_in || 3600) * 1000,
        user: data.user,
      };
      writeSession(session);
      return session;
    }

    async function refreshSession(session) {
      if (!session || !session.refresh_token) return null;
      const response = await fetch(`${baseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: {
          apikey: anonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      });
      if (!response.ok) {
        clearSession();
        return null;
      }
      return storeAuthSession(await response.json());
    }

    async function getSession() {
      const session = readSession();
      if (!session || !session.access_token) return null;
      if (session.expires_at && Date.now() > session.expires_at - 60000) {
        return refreshSession(session);
      }
      return session;
    }

    async function getUser() {
      const session = await getSession();
      if (!session) return null;
      try {
        const user = await request("/auth/v1/user");
        return user || session.user || null;
      } catch (_) {
        clearSession();
        return null;
      }
    }

    async function signInWithPassword(email, password) {
      const response = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: {
          apikey: anonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) throw await readSupabaseError(response);
      return storeAuthSession(await response.json());
    }

    async function signOut() {
      try {
        await request("/auth/v1/logout", { method: "POST" });
      } catch (_) {
        // A sessão local deve ser encerrada mesmo que a rede falhe.
      }
      clearSession();
    }

    async function select(table, options = {}) {
      const params = new URLSearchParams();
      params.set("select", options.columns || "*");
      Object.entries(options.filters || {}).forEach(([key, value]) => {
        params.append(key, `eq.${value}`);
      });
      if (options.limit) params.set("limit", String(options.limit));
      return request(`/rest/v1/${table}?${params.toString()}`);
    }

    async function maybeSingle(table, options = {}) {
      const rows = await select(table, { ...options, limit: 1 });
      return rows && rows.length ? rows[0] : null;
    }

    async function upsert(table, row, conflictKey) {
      const query = conflictKey ? `?on_conflict=${encodeURIComponent(conflictKey)}` : "";
      return request(`/rest/v1/${table}${query}`, {
        method: "POST",
        headers: {
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: row,
      });
    }

    return { getSession, getUser, signInWithPassword, signOut, select, maybeSingle, upsert };
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return saved ? mergeDefaults(defaultState, saved) : clone(defaultState);
    } catch (_) {
      return clone(defaultState);
    }
  }

  function mergeDefaults(base, saved) {
    if (Array.isArray(base)) return Array.isArray(saved) ? saved : base;
    if (base && typeof base === "object") {
      const out = { ...base, ...(saved || {}) };
      Object.keys(base).forEach((key) => {
        out[key] = mergeDefaults(base[key], saved ? saved[key] : undefined);
      });
      return out;
    }
    return saved === undefined ? base : saved;
  }

  function normalizeState() {
    state.clients = state.clients || [];
    state.materials = state.materials || [];
    state.quotes = state.quotes || [];
    state.projects = state.projects || [];
    state.receivables = state.receivables || [];
    state.expenses = state.expenses || [];
    state.employees = state.employees || [];
    state.timeEntries = state.timeEntries || [];
    state.holidays = state.holidays || [];
    state.users = state.users && state.users.length ? state.users : clone(defaultState.users);
    state.costSettings = mergeDefaults(defaultState.costSettings, state.costSettings || {});
    state.settings = mergeDefaults(defaultState.settings, state.settings || {});
    ensureDefaultLaborRoles();
    state.financePeriod = state.financePeriod || "month";
  }

  function ensureDefaultLaborRoles() {
    const requiredRoles = ["Serralheiro", "Soldador", "Pedreiro", "Servente", "Ajudante de serralheria", "Encarregado"];
    state.costSettings.laborRoles = Array.isArray(state.costSettings.laborRoles) ? state.costSettings.laborRoles : [];
    requiredRoles.forEach((role) => {
      const exists = state.costSettings.laborRoles.some((item) => String(item.role || "").toLowerCase() === role.toLowerCase());
      if (!exists) state.costSettings.laborRoles.push({ id: uid(), role, dailyRate: 0 });
    });
  }

  function applyEmbeddedImport() {
    const imported = window.EDJ_LEGACY_IMPORT;
    if (!imported || state.legacyImportVersion === imported.version) return;

    mergeImportedCollection("clients", imported.clients);
    mergeImportedCollection("materials", imported.materials);
    mergeImportedCollection("quotes", imported.quotes);
    mergeImportedCollection("projects", imported.projects);
    mergeImportedCollection("receivables", imported.receivables);

    state.legacyImportVersion = imported.version;
    state.legacyImportSummary = imported.summary || {};
    save();
  }

  function mergeImportedCollection(key, rows = []) {
    state[key] = state[key] || [];
    rows.forEach((row) => {
      const exists = state[key].some((item) => {
        if (row.legacyId && item.legacyId === row.legacyId) return true;
        return item.id === row.id;
      });
      if (!exists) state[key].push(row);
    });
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {
      // Browsers can block localStorage for file:// pages. The app should
      // still work in-memory so the local prototype remains testable.
    }
    scheduleCloudSave();
  }

  function scheduleCloudSave() {
    if (!supabaseReady || !supabaseApi || !state.logged || !state.companyId) return;
    clearTimeout(cloudSaveTimer);
    cloudSaveTimer = setTimeout(() => {
      syncStateToSupabase();
    }, 450);
  }

  async function syncStateToSupabase() {
    if (!supabaseReady || !supabaseApi || !state.companyId) return;
    if (cloudSaving) {
      cloudSavePending = true;
      return;
    }
    cloudSaving = true;
    try {
      const user = await supabaseApi.getUser();
      const payload = {
        company_id: state.companyId,
        state: sanitizeStateForCloud(),
        updated_by: user ? user.id : null,
        updated_at: new Date().toISOString(),
      };
      await supabaseApi.upsert("company_app_state", payload, "company_id");
    } catch (error) {
      console.error("Erro ao salvar no Supabase:", error);
    } finally {
      cloudSaving = false;
      if (cloudSavePending) {
        cloudSavePending = false;
        scheduleCloudSave();
      }
    }
  }

  function sanitizeStateForCloud() {
    return {
      theme: state.theme,
      clients: state.clients || [],
      materials: state.materials || [],
      quotes: state.quotes || [],
      projects: state.projects || [],
      receivables: state.receivables || [],
      expenses: state.expenses || [],
      employees: state.employees || [],
      timeEntries: state.timeEntries || [],
      holidays: state.holidays || [],
      users: state.users || [],
      settings: state.settings || {},
      costSettings: state.costSettings || {},
    };
  }

  function renderBoot(message) {
    document.documentElement.classList.toggle("dark", state.theme === "dark");
    app.innerHTML = `
      <section class="login">
        <div class="login-card">
          <img class="login-logo" src="./assets/logo-edj.png" alt="EDJ Soluções em Manutenção" />
          <p class="eyebrow">Controle operacional</p>
          <h1>EDJ</h1>
          <p>${esc(message || "Carregando sistema...")}</p>
        </div>
      </section>
    `;
  }

  async function boot() {
    if (!supabaseConfigured) {
      render();
      return;
    }
    if (!supabaseApi) {
      state = mergeDefaults(defaultState, { theme: state.theme, logged: false });
      normalizeState();
      render();
      window.alert("A configuração do Supabase não carregou. Verifique o arquivo supabase-config.js antes de publicar.");
      return;
    }
    renderBoot("Conectando ao Supabase...");
    const session = await supabaseApi.getSession();
    if (session && session.user) {
      await loadSupabaseWorkspace(session.user);
    } else {
      state = mergeDefaults(defaultState, { theme: state.theme, logged: false });
      normalizeState();
      supabaseReady = false;
    }
    render();
  }

  async function loadSupabaseWorkspace(user) {
    supabaseReady = false;
    let memberships = [];
    try {
      memberships = await supabaseApi.select("company_users", {
        filters: { user_id: user.id, active: true },
        limit: 1,
      });
    } catch (error) {
      console.error(error);
      window.alert("Não foi possível carregar o usuário da empresa no Supabase.");
      return;
    }
    const membership = memberships && memberships[0];
    if (!membership) {
      window.alert("Seu usuário existe no Auth, mas ainda não está vinculado a uma empresa.");
      return;
    }

    const companyId = membership.company_id;
    let company = null;
    let settings = null;
    let costs = null;
    let appStateRow = null;
    let users = [];
    try {
      [company, settings, costs, appStateRow, users] = await Promise.all([
        supabaseApi.maybeSingle("companies", { filters: { id: companyId } }),
        supabaseApi.maybeSingle("company_settings", { filters: { company_id: companyId } }),
        supabaseApi.maybeSingle("cost_settings", { filters: { company_id: companyId } }),
        supabaseApi.maybeSingle("company_app_state", { columns: "state", filters: { company_id: companyId } }),
        supabaseApi.select("company_users", { filters: { company_id: companyId, active: true } }),
      ]);
    } catch (error) {
      console.error(error);
      window.alert("Falta criar a tabela company_app_state no Supabase. Rode o próximo SQL que eu vou te passar.");
      return;
    }

    const cloudState = appStateRow && appStateRow.state ? appStateRow.state : {};
    state = mergeDefaults(defaultState, cloudState);
    state.logged = true;
    state.companyId = companyId;
    state.currentUserEmail = user.email || membership.email;
    state.route = state.route || "dashboard";
    state.activeClientId = null;
    state.activeQuoteId = null;
    state.activeStatus = null;

    applyCompanyRowsToState(company, settings, costs);
    state.users = (users || [membership]).map((item) => ({
      id: item.id,
      name: item.name,
      email: item.email,
      role: item.role,
      active: item.active,
      logoUrl: item.logo_url || "",
    }));
    normalizeState();
    supabaseReady = true;
    if (!appStateRow) save();
  }

  function applyCompanyRowsToState(company, settings, costs) {
    if (company) {
      state.settings.companyName = company.name || state.settings.companyName;
      state.settings.document = company.document || state.settings.document;
      state.settings.email = company.email || state.settings.email;
      state.settings.phone = company.phone || state.settings.phone;
      state.settings.address = company.address || state.settings.address;
      state.settings.logoUrl = company.logo_url || state.settings.logoUrl || "";
      state.settings.brandColor = company.brand_color || state.settings.brandColor || "#ff7a1a";
    }
    if (settings) {
      state.settings.defaultTerms = settings.default_terms || state.settings.defaultTerms;
      state.settings.defaultObservations = settings.default_observations || state.settings.defaultObservations || "";
      state.settings.bank = settings.bank || state.settings.bank || "";
      state.settings.agency = settings.agency || state.settings.agency || "";
      state.settings.account = settings.account || state.settings.account || "";
      state.settings.holder = settings.holder || state.settings.holder || "";
      state.settings.pix = settings.pix || state.settings.pix || "";
      state.settings.pixType = settings.pix_type || state.settings.pixType || "";
      state.settings.quotePrefix = settings.quote_prefix || state.settings.quotePrefix || "ORC";
      state.settings.quoteNextNumber = settings.quote_next_number || state.settings.quoteNextNumber || 1;
    }
    if (costs) {
      state.costSettings.defaultMarginPct = Number(costs.default_margin_pct || state.costSettings.defaultMarginPct || 0);
      state.costSettings.paintPriceM2 = Number(costs.paint_price_m2 || state.costSettings.paintPriceM2 || 0);
      state.costSettings.laborHourPrice = Number(costs.labor_hour_price || state.costSettings.laborHourPrice || 0);
      state.costSettings.workday = mergeDefaults(state.costSettings.workday || defaultState.costSettings.workday, costs.workday || {});
      state.costSettings.laborRoles = Array.isArray(costs.labor_roles) && costs.labor_roles.length
        ? costs.labor_roles
        : state.costSettings.laborRoles;
    }
  }

  async function loginWithSupabase(email, password) {
    if (!supabaseApi) {
      window.alert("Supabase configurado, mas a conexão não foi inicializada.");
      return;
    }
    try {
      const session = await supabaseApi.signInWithPassword(email, password);
      await loadSupabaseWorkspace(session.user);
      render();
    } catch (error) {
      console.error(error);
      window.alert("Login recusado pelo Supabase. Confira e-mail e senha.");
    }
  }

  function setTheme(theme) {
    state.theme = theme;
    document.documentElement.classList.toggle("dark", theme === "dark");
    save();
  }

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function textBlock(value) {
    return esc(value || "").replace(/\r?\n/g, "<br>");
  }

  function money(value) {
    return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function parseNum(value) {
    if (typeof value === "number") return value;
    let cleaned = String(value || "").trim().replace(/[^\d,.-]/g, "");
    if (!cleaned) return 0;
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    if (lastComma >= 0 && lastDot >= 0) {
      cleaned = lastComma > lastDot
        ? cleaned.replaceAll(".", "").replace(",", ".")
        : cleaned.replaceAll(",", "");
    } else if (lastComma >= 0) {
      cleaned = cleaned.replace(",", ".");
    } else if ((cleaned.match(/\./g) || []).length > 1) {
      cleaned = cleaned.replaceAll(".", "");
    }
    return Number(cleaned) || 0;
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function addDays(date, days) {
    const d = new Date(date + "T12:00:00");
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function brDate(date) {
    if (!date) return "";
    return new Date(date + "T12:00:00").toLocaleDateString("pt-BR");
  }

  function cityFromAddress(address) {
    const text = String(address || "");
    const match = text.match(/([^,\n]+?)\s*[-/]\s*[A-Z]{2}\b/i);
    if (match) return match[1].split(",").pop().trim();
    const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : "Belo Jardim";
  }

  function codeForNextQuote() {
    const prefix = today().replaceAll("-", "");
    const max = state.quotes.reduce((highest, q) => {
      const match = String(q.code || "").match(new RegExp(`^${prefix}-(\\d+)$`));
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0);
    return `${prefix}-${String(max + 1).padStart(4, "0")}`;
  }

  function displayQuoteCode(code) {
    return String(code || "").replace(/^ORC-/i, "");
  }

  function currentMonthRange() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    return { start, end };
  }

  function inRange(date, start, end) {
    return date && date >= start && date <= end;
  }

  function routeSnapshot() {
    return {
      route: state.route,
      activeClientId: state.activeClientId,
      activeQuoteId: state.activeQuoteId,
      activeProjectId: state.activeProjectId,
      activeQuoteTab: state.activeQuoteTab,
      activeStatus: state.activeStatus,
      quotesStatusOpen: state.quotesStatusOpen,
    };
  }

  function routeTo(route, params = {}, options = {}) {
    if (!options.replace && state.logged && state.route && state.route !== route) {
      routeHistory.push(routeSnapshot());
      if (routeHistory.length > 20) routeHistory = routeHistory.slice(-20);
    }
    state.route = route;
    Object.assign(state, params);
    save();
    render();
  }

  function goBack() {
    const previous = routeHistory.pop();
    if (!previous) {
      routeTo("dashboard", {}, { replace: true });
      return;
    }
    Object.assign(state, previous);
    save();
    render();
  }

  function getClient(id) {
    return state.clients.find((c) => c.id === id);
  }

  function getQuote(id) {
    return state.quotes.find((q) => q.id === id);
  }

  function getProject(id) {
    return state.projects.find((p) => p.id === id);
  }

  function getMaterial(id) {
    return state.materials.find((m) => m.id === id);
  }

  function calcQuote(q) {
    const materials = (q.materials || []).reduce((sum, item) => sum + parseNum(item.qty) * parseNum(item.unitCost), 0);
    const paint = parseNum(q.paintAmount);
    const labor = (q.labor || []).reduce((sum, item) => sum + parseNum(item.days) * parseNum(item.dailyRate), 0);
    const extras = (q.extras || []).reduce((sum, item) => sum + parseNum(item.amount), 0);
    const subtotalCost = materials + paint + labor + extras;
    const marginPct = parseNum(q.marginPct);
    const total = subtotalCost * (1 + marginPct / 100);
    return { materials, paint, labor, extras, subtotalCost, marginPct, total };
  }

  function projectResult(projectId) {
    const project = getProject(projectId);
    if (!project) return { sold: 0, costs: 0, received: 0, toReceive: 0, profit: 0 };
    const quote = getQuote(project.quoteId);
    const quoteCalc = quote ? calcQuote(quote) : { total: 0, subtotalCost: 0 };
    const expenses = state.expenses.filter((e) => e.projectId === projectId).reduce((sum, e) => sum + parseNum(e.amount), 0);
    const received = state.receivables
      .filter((r) => r.projectId === projectId && r.status === "recebido")
      .reduce((sum, r) => sum + parseNum(r.amount), 0);
    const toReceive = state.receivables
      .filter((r) => r.projectId === projectId && r.status !== "recebido" && r.status !== "cancelado")
      .reduce((sum, r) => sum + parseNum(r.amount), 0);
    const costs = quoteCalc.subtotalCost + expenses;
    return { sold: quoteCalc.total, costs, received, toReceive, profit: received + toReceive - costs };
  }

  function render() {
    document.documentElement.classList.toggle("dark", state.theme === "dark");
    if (!state.logged) {
      renderLogin();
      return;
    }

    app.innerHTML = `
      <div class="app-shell">
        ${renderSidebar()}
        <main class="content">
          ${renderTopbar()}
          ${renderMobileBar()}
          ${renderRoute()}
        </main>
      </div>
    `;

    bindGlobalEvents();
  }

  function renderLogin() {
    app.innerHTML = `
      <section class="login">
        <div class="login-card">
          <img class="login-logo" src="./assets/logo-edj.png" alt="EDJ Soluções em Manutenção" />
          <p class="eyebrow">Controle operacional</p>
          <h1>Bem Vindo Edson</h1>
          <p>Acesse a área de clientes, orçamentos, obras, financeiro e ponto.</p>
          <form id="loginForm">
            <label>Email<input name="email" type="email" value="admin@serralheria.com" /></label>
            <label>Senha<input name="password" type="password" value="${supabaseConfigured ? "" : "Admin@123456"}" /></label>
            <button class="btn" type="submit">Entrar</button>
          </form>
        </div>
      </section>
    `;
    document.getElementById("loginForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = serializeForm(event.currentTarget);
      if (supabaseConfigured) {
        await loginWithSupabase(data.email, data.password);
        return;
      }
      const users = state.users || [];
      const user = users.find((u) => u.email === data.email && u.active !== false);
      if (!user || !data.password) {
        window.alert("Confira o e-mail e a senha de acesso.");
        return;
      }
      state.currentUserEmail = user.email;
      state.logged = true;
      save();
      render();
    });
  }

  function renderSidebar() {
    const items = navItems();
    return `
      <aside class="sidebar">
        <a class="brand" href="#" data-route="dashboard">
          <img src="./assets/logo-edj.png" alt="EDJ" />
          <span><strong>EDJ</strong><small>SOLUÇÕES EM MANUTENÇÃO</small></span>
        </a>
        <nav class="nav">
          ${items.map((item) => `<button class="${state.route === item.route ? "active" : ""}" data-route="${item.route}"><span class="nav-icon">${item.icon}</span><span>${item.label}</span></button>`).join("")}
        </nav>
      </aside>
    `;
  }

  function renderMobileBar() {
    return `
      <nav class="mobile-bar">
        ${navItems().map((item) => `<button class="${state.route === item.route ? "active" : ""}" data-route="${item.route}">${item.short}</button>`).join("")}
      </nav>
    `;
  }

  function navItems() {
    return [
      { route: "dashboard", label: "Dashboard", short: "Início", icon: "▦" },
      { route: "quotes", label: "Orçamentos", short: "Orç.", icon: "▤" },
      { route: "clients", label: "Clientes", short: "Clientes", icon: "◌" },
      { route: "materials", label: "Materiais", short: "Mat.", icon: "◇" },
      { route: "costs", label: "Base de custos", short: "Custos", icon: "▣" },
      { route: "finance", label: "Financeiro", short: "Caixa", icon: "$" },
      { route: "time", label: "Ponto", short: "Ponto", icon: "◷" },
      { route: "projects", label: "Projetos", short: "Obras", icon: "□" },
      { route: "settings", label: "Configurações", short: "Config.", icon: "⚙" },
    ];
  }

  function renderTopbar() {
    const back = state.route !== "dashboard" ? `<button class="topbar-back" data-action="back">← Voltar</button>` : `<span class="topbar-spacer"></span>`;
    const currentUser = (state.users || []).find((u) => u.email === state.currentUserEmail) || (state.users || [])[0] || { name: "Administrador", email: "admin@serralheria.com" };
    const initials = String(currentUser.name || currentUser.email || "A").trim().slice(0, 1).toUpperCase();
    return `
      <header class="topbar">
        <button class="mobile-brand" data-route="dashboard" aria-label="Voltar para o painel">
          <img src="./assets/logo-edj.png" alt="EDJ" />
          <span>EDJ</span>
        </button>
        ${back}
        <div class="actions topbar-actions">
          <button class="icon-btn" title="${state.theme === "dark" ? "Tema claro" : "Tema escuro"}" data-action="toggle-theme">☼</button>
          <button class="btn" data-action="new-quote">+ Novo orçamento</button>
          <div class="user-chip">
            <span class="avatar">${esc(initials)}</span>
            <span><strong>${esc(currentUser.name || "Administrador")}</strong><small>${esc(currentUser.email || "admin@serralheria.com")}</small></span>
          </div>
          <button class="btn-secondary" data-action="logout">Sair</button>
        </div>
      </header>
    `;
  }

  function renderRoute() {
    switch (state.route) {
      case "clients": return renderClients();
      case "clientDetail": return renderClientDetail();
      case "quotes": return renderQuotes();
      case "quoteDetail": return renderQuoteDetail();
      case "projects": return renderProjects();
      case "projectDetail": return renderProjectDetail();
      case "materials": return renderMaterials();
      case "finance": return renderFinance();
      case "time": return renderTime();
      case "costs": return renderCosts();
      case "settings": return renderSettings();
      default: return renderDashboard();
    }
  }

  function bindGlobalEvents() {
    document.querySelectorAll("[data-route]").forEach((el) => {
      el.addEventListener("click", (event) => {
        event.preventDefault();
        routeTo(el.dataset.route);
      });
    });
    document.querySelectorAll(".dashboard-link").forEach((el) => {
      el.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        routeTo(el.dataset.route);
      });
    });
    document.querySelectorAll("[data-action='toggle-theme']").forEach((btn) => {
      btn.addEventListener("click", () => {
        setTheme(state.theme === "dark" ? "light" : "dark");
        render();
      });
    });
    document.querySelectorAll("[data-action='logout']").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (supabaseApi) await supabaseApi.signOut();
        supabaseReady = false;
        state.logged = false;
        state.currentUserEmail = "";
        state.companyId = null;
        save();
        render();
      });
    });
    document.querySelectorAll("[data-action='new-quote']").forEach((btn) => {
      btn.addEventListener("click", () => openQuoteModal());
    });
    document.querySelectorAll("[data-action='back']").forEach((btn) => {
      btn.addEventListener("click", () => goBack());
    });
  }

  function renderDashboard() {
    const range = currentMonthRange();
    const monthReceipts = state.receivables.filter((r) => r.status === "recebido" && inRange(r.receivedAt || r.dueDate, range.start, range.end));
    const monthExpenses = state.expenses.filter((e) => inRange(e.paidAt || e.dueDate || e.date, range.start, range.end));
    const received = monthReceipts.reduce((sum, r) => sum + parseNum(r.amount), 0);
    const expenses = monthExpenses.reduce((sum, e) => sum + parseNum(e.amount), 0);
    const toReceive = state.receivables.filter((r) => r.status !== "recebido" && r.status !== "cancelado").reduce((sum, r) => sum + parseNum(r.amount), 0);
    const activeProjects = state.projects.filter((p) => !["concluido", "cancelado"].includes(p.status)).length;
    const balance = received - expenses;

    return `
      <section class="grid dashboard-minimal">
        ${pageHeader("Painel operacional", "Visão geral de orçamentos, aprovações e recebimentos.")}
        <div class="kpis dashboard-kpis">
          <article class="card dashboard-link" data-route="finance" role="button" tabindex="0"><span>Faturamento do mês</span><strong>${money(received)}</strong><small>Recebido no período</small></article>
          <article class="card dashboard-link orange" data-route="finance" role="button" tabindex="0"><span>A receber</span><strong>${money(toReceive)}</strong><small>Previsão aberta</small></article>
          <article class="card dashboard-link ${balance < 0 ? "red" : "green"}" data-route="finance" role="button" tabindex="0"><span>Saldo do mês</span><strong>${money(balance)}</strong><small>Receitas menos saídas</small></article>
          <article class="card dashboard-link green" data-route="projects" role="button" tabindex="0"><span>Projetos ativos</span><strong>${activeProjects}</strong><small>Em execução ou pendentes</small></article>
        </div>
        <div class="two-col dashboard-panels">
        <section class="panel dashboard-status">
          <div class="panel-head">
            <div><p class="eyebrow">Pedidos</p><h2>Orçamentos por status</h2></div>
            <button class="btn-secondary" data-action="new-quote">Novo orçamento</button>
          </div>
          ${renderStatusList()}
        </section>
        <section class="panel">
          <div class="panel-head"><div><p class="eyebrow">Obras</p><h2>Últimos projetos / Em andamento</h2></div></div>
          ${renderDashboardProjects()}
        </section>
        </div>
      </section>
    `;
  }

  function renderDashboardProjects() {
    const projects = state.projects
      .filter((p) => !["concluido", "cancelado"].includes(p.status))
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      .slice(0, 6);
    if (!projects.length) return empty("Nenhum projeto em andamento.", "Projetos aprovados aparecem aqui para acompanhamento rápido.");
    return `
      <div class="compact-list">
        ${projects.map((project) => {
          const client = getClient(project.clientId);
          const result = projectResult(project.id);
          return `
            <div class="compact-row">
              <button class="clickable compact-title" data-project-id="${project.id}">${esc(project.title)}</button>
              <span>${client ? esc(client.name) : "Sem cliente"}</span>
              <strong>${money(result.sold)}</strong>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderStatusList(options = {}) {
    const clickable = options.clickable !== false;
    const counts = Object.fromEntries(statusOrder.map((s) => [s, 0]));
    state.quotes.forEach((q) => counts[q.status || "pendente"] = (counts[q.status || "pendente"] || 0) + 1);
    return `
      <div class="status-list">
        ${statusOrder.map((status) => `
          <button class="status-row ${state.activeStatus === status ? "active" : ""}" ${clickable ? `data-status-filter="${status}"` : ""}>
            <span class="status-label"><span class="dot ${status}"></span>${statusLabels[status]}</span>
            <span class="count">${counts[status] || 0}<span>›</span></span>
          </button>
        `).join("")}
      </div>
    `;
  }

  function renderStatusStrip() {
    const counts = Object.fromEntries(statusOrder.map((s) => [s, 0]));
    state.quotes.forEach((q) => counts[q.status || "pendente"] = (counts[q.status || "pendente"] || 0) + 1);
    return `
      <div class="quote-status-strip">
        ${statusOrder.map((status) => `
          <span class="status-chip">
            <span class="dot ${status}"></span>
            <strong>${counts[status] || 0}</strong>
            <span>${statusLabels[status]}</span>
          </span>
        `).join("")}
      </div>
    `;
  }

  function pageHeader(title, subtitle, action = "") {
    return `
      <div class="page-head">
        <div>
          <h1>${esc(title)}</h1>
          ${subtitle ? `<p>${esc(subtitle)}</p>` : ""}
        </div>
        ${action ? `<div class="page-actions">${action}</div>` : ""}
      </div>
    `;
  }

  function renderClients() {
    return `
      <section class="grid">
        ${pageHeader("Clientes", `${state.clients.length} cliente(s) cadastrado(s).`, `<button class="btn" data-action="new-client">+ Novo cliente</button>`)}
        <div class="panel">
          <div class="panel-head">
            <div><p class="eyebrow">Cadastro</p><h2>Clientes</h2></div>
          </div>
          ${state.clients.length ? renderClientTable(state.clients) : empty("Nenhum cliente cadastrado.", "Cadastre um cliente para iniciar o histórico de orçamentos e projetos.")}
        </div>
      </section>
    `;
  }

  function renderClientTable(clients) {
    return `
      <div class="table-wrap mobile-card-table client-table-wrap">
        <table>
          <thead><tr><th>Cliente</th><th>Documento</th><th>Contato</th><th>Projetos</th><th>Financeiro</th><th></th></tr></thead>
          <tbody>
            ${clients.map((client) => {
              const quotes = state.quotes.filter((q) => q.clientId === client.id);
              const received = state.receivables.filter((r) => r.clientId === client.id && r.status === "recebido").reduce((s, r) => s + parseNum(r.amount), 0);
              return `
                <tr>
                  <td data-label="Cliente"><button class="clickable" data-client-id="${client.id}">${esc(client.name)}</button></td>
                  <td data-label="Documento">${esc(client.document || "")}</td>
                  <td data-label="Contato">${esc(client.phone || client.email || "")}</td>
                  <td data-label="Projetos">${quotes.length}</td>
                  <td data-label="Financeiro">${money(received)}</td>
                  <td data-label="Ações" class="right action-cell">
                    <button class="icon-action" title="Editar cliente" data-edit-client="${client.id}">✎</button>
                    <button class="icon-action danger" title="Excluir cliente" data-delete-client="${client.id}">🗑</button>
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderClientDetail() {
    const client = getClient(state.activeClientId);
    if (!client) return empty("Cliente não encontrado.", "Volte para a lista de clientes.");
    const quotes = state.quotes.filter((q) => q.clientId === client.id);
    const projects = state.projects.filter((p) => p.clientId === client.id);
    const received = state.receivables.filter((r) => r.clientId === client.id && r.status === "recebido").reduce((s, r) => s + parseNum(r.amount), 0);
    const toReceive = state.receivables.filter((r) => r.clientId === client.id && r.status !== "recebido" && r.status !== "cancelado").reduce((s, r) => s + parseNum(r.amount), 0);
    return `
      <section class="grid">
        <div class="client-header">
          <div>
            <p class="eyebrow">Ficha do cliente</p>
            <h2>${esc(client.name)}</h2>
            <div class="meta-list">
              ${client.document ? `<span>${esc(client.document)}</span>` : ""}
              ${client.phone ? `<span>${esc(client.phone)}</span>` : ""}
              ${client.email ? `<span>${esc(client.email)}</span>` : ""}
              ${client.address ? `<span>${esc(client.address)}</span>` : ""}
            </div>
          </div>
          <div class="actions">
            <button class="btn" data-action="new-quote-client" data-client-id="${client.id}">Novo orçamento</button>
            <button class="btn-secondary" data-edit-client="${client.id}">Editar cliente</button>
          </div>
        </div>
        <div class="kpis">
          <article class="card"><span>Orçamentos</span><strong>${quotes.length}</strong><small>Histórico do cliente</small></article>
          <article class="card green"><span>Projetos</span><strong>${projects.length}</strong><small>Obras vinculadas</small></article>
          <article class="card orange"><span>A receber</span><strong>${money(toReceive)}</strong><small>Previsão aberta</small></article>
          <article class="card"><span>Recebido</span><strong>${money(received)}</strong><small>Total já baixado</small></article>
        </div>
        <section class="panel">
          <div class="panel-head"><div><p class="eyebrow">Histórico</p><h2>Projetos e orçamentos</h2></div></div>
          ${projects.length ? renderProjectTable(projects) : quotes.length ? renderQuoteTable(quotes) : empty("Nenhum projeto cadastrado para este cliente.", "Crie o primeiro orçamento para iniciar o histórico.")}
        </section>
      </section>
    `;
  }

  function renderQuotes() {
    const filtered = state.activeStatus ? state.quotes.filter((q) => q.status === state.activeStatus) : state.quotes;
    const statusOpen = Boolean(state.quotesStatusOpen || state.activeStatus);
    const listTitle = state.activeStatus ? statusLabels[state.activeStatus] : "Todos os orçamentos";
    return `
      <section class="grid quotes-page">
        ${pageHeader("Orçamentos", `${state.quotes.length} orçamento(s) no histórico.`, `<button class="btn" data-action="new-quote">+ Novo orçamento</button>`)}
        <section class="panel quote-status-panel ${statusOpen ? "open" : "collapsed"}">
          <button class="quote-status-toggle" type="button" data-action="toggle-quote-status" aria-expanded="${statusOpen ? "true" : "false"}">
            <div>
              <p class="eyebrow">Pedidos</p>
              <h2>Pedidos por status</h2>
            </div>
            <span>${statusOpen ? "Recolher" : "Abrir"} ›</span>
          </button>
          ${statusOpen ? renderStatusList() : renderStatusStrip()}
        </section>
        <section class="panel quote-list-panel">
          <div class="panel-head">
            <div><p class="eyebrow">Lista</p><h2>${listTitle}</h2></div>
            ${state.activeStatus ? `<button class="btn-secondary" data-clear-status>Mostrar todos</button>` : ""}
          </div>
          ${filtered.length ? renderQuoteTable(filtered) : empty("Nenhum orçamento encontrado.", "Não há orçamentos neste status.")}
        </section>
      </section>
    `;
  }

  function renderQuoteTable(quotes) {
    return `
      <div class="table-wrap mobile-card-table quote-table-wrap">
        <div class="mobile-quote-list-native">
          ${quotes.map((q) => {
            const client = getClient(q.clientId);
            const calc = calcQuote(q);
            return `
              <article class="mobile-quote-row">
                <button class="mobile-quote-title" data-quote-id="${q.id}">${esc(q.title || "Sem título")}</button>
                <button class="mobile-quote-total" data-quote-id="${q.id}">${money(calc.total)}</button>
                <div class="mobile-quote-meta">
                  <button data-quote-id="${q.id}">${esc(displayQuoteCode(q.code))}</button>
                  <span>${brDate(q.createdAt)}</span>
                  ${client ? `<button data-client-id="${client.id}">${esc(client.name)}</button>` : `<span>Sem cliente</span>`}
                </div>
                <select class="mobile-quote-status" data-status-change="${q.id}">${statusOrder.map((s) => `<option value="${s}" ${q.status === s ? "selected" : ""}>${statusLabels[s]}</option>`).join("")}</select>
                <div class="mobile-quote-actions">
                  <button class="icon-action" title="Prévia PDF" data-action="preview-pdf" data-quote-id="${q.id}">▧</button>
                  <button class="icon-action" title="Editar orçamento" data-action="edit-quote" data-quote-id="${q.id}">✎</button>
                  <button class="icon-action danger" title="Excluir orçamento" data-delete-quote="${q.id}">🗑</button>
                </div>
              </article>
            `;
          }).join("")}
        </div>
        <table>
          <thead><tr><th>Código</th><th>Projeto</th><th>Cliente</th><th>Status</th><th>Valor</th><th>Data</th><th class="right">Ações</th></tr></thead>
          <tbody>
            ${quotes.map((q) => {
              const client = getClient(q.clientId);
              const calc = calcQuote(q);
              return `
                <tr>
                  <td data-label="Código" data-mobile-date="${esc(brDate(q.createdAt))}"><button class="clickable" data-quote-id="${q.id}">${esc(displayQuoteCode(q.code))}</button></td>
                  <td data-label="Projeto"><button class="clickable" data-quote-id="${q.id}">${esc(q.title || "Sem título")}</button></td>
                  <td data-label="Cliente">${client ? `<button class="clickable" data-client-id="${client.id}">${esc(client.name)}</button>` : ""}</td>
                  <td data-label="Status"><select data-status-change="${q.id}">${statusOrder.map((s) => `<option value="${s}" ${q.status === s ? "selected" : ""}>${statusLabels[s]}</option>`).join("")}</select></td>
                  <td data-label="Valor"><button class="clickable" data-quote-id="${q.id}">${money(calc.total)}</button></td>
                  <td data-label="Data">${brDate(q.createdAt)}</td>
                  <td data-label="Ações" class="right action-cell">
                    <button class="icon-action" title="Prévia PDF" data-action="preview-pdf" data-quote-id="${q.id}">▧</button>
                    <button class="icon-action" title="Editar orçamento" data-action="edit-quote" data-quote-id="${q.id}">✎</button>
                    <button class="icon-action danger" title="Excluir orçamento" data-delete-quote="${q.id}">🗑</button>
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderQuoteDetail() {
    const q = getQuote(state.activeQuoteId);
    if (!q) return empty("Orçamento não encontrado.", "Volte para a lista de orçamentos.");
    const client = getClient(q.clientId);
    const calc = calcQuote(q);
    const activeTab = state.activeQuoteTab || "summary";
    return `
      <section class="quote-layout">
        <div class="panel">
          <div class="panel-head">
            <div><p class="eyebrow">${esc(displayQuoteCode(q.code))}</p><h2>${esc(q.title || "Orçamento")}</h2></div>
            <div class="actions">
              <button class="btn-secondary" data-action="edit-quote" data-quote-id="${q.id}">Editar</button>
              <button class="btn" data-action="preview-pdf" data-quote-id="${q.id}">Gerar PDF</button>
            </div>
          </div>
          <div class="tabs">
            <button class="tab ${activeTab === "summary" ? "active" : ""}" data-quote-tab="summary">Resumo</button>
            <button class="tab ${activeTab === "internal" ? "active" : ""}" data-quote-tab="internal">Base interna</button>
            <button class="tab ${activeTab === "finance" ? "active" : ""}" data-quote-tab="finance">Financeiro</button>
            <button class="tab ${activeTab === "ai" ? "active" : ""}" data-quote-tab="ai">IA</button>
          </div>
          ${renderQuoteTabContent(activeTab, q, client, calc)}
        </div>
        <aside class="paper">
          ${proposalHtml(q, false)}
        </aside>
      </section>
    `;
  }

  function renderQuoteTabContent(activeTab, q, client, calc) {
    if (activeTab === "ai") return `
      <div class="quote-tab-panel">
        <section class="ai-assistant quote-detail-ai">
          <div class="ai-assistant-head">
            <span class="ai-spark">✦</span>
            <div>
              <h3>Assistente de texto com IA</h3>
              <p>Escreva uma orientação simples e gere textos comerciais para o PDF ou para enviar ao cliente.</p>
            </div>
          </div>
          <div class="ai-assistant-actions">
            <button class="btn ai-button" type="button" data-ai-quote-update="description">✦ Gerar descrição do orçamento</button>
            <button class="btn ai-button" type="button" data-ai-quote-update="payment">✦ Gerar condições de pagamento</button>
          </div>
        </section>
      </div>
    `;
    if (activeTab === "internal") return `
      <div class="quote-tab-panel">
        <div class="panel-head compact"><div><p class="eyebrow">Base interna</p><h3>Materiais, mão de obra e custos</h3></div></div>
        ${renderInternalCostTables(q)}
      </div>
    `;
    if (activeTab === "finance") return renderQuoteFinanceTab(q, calc);
    return `
      <div class="quote-tab-panel">
        <div class="three-col">
          <article class="card"><span>Cliente</span><strong style="font-size:1.35rem">${esc(client ? client.name : "")}</strong><small>${esc(client ? client.document || "" : "")}</small></article>
          <article class="card orange"><span>Total comercial</span><strong>${money(calc.total)}</strong><small>Valor para cliente</small></article>
          <article class="card red"><span>Custo interno</span><strong>${money(calc.subtotalCost)}</strong><small>Oculto no PDF</small></article>
        </div>
        <div style="height:14px"></div>
        <div class="summary-list">
          <div class="summary-line"><span>Status</span><strong>${esc(statusLabels[q.status] || q.status || "")}</strong></div>
          <div class="summary-line"><span>Margem aplicada</span><strong>${parseNum(q.marginPct)}%</strong></div>
          <div class="summary-line"><span>Data do orçamento</span><strong>${brDate(q.createdAt)}</strong></div>
        </div>
      </div>
    `;
  }

  function renderQuoteFinanceTab(q, calc) {
    const project = state.projects.find((p) => p.quoteId === q.id);
    const receivables = state.receivables.filter((r) => r.quoteId === q.id);
    const expenses = project ? state.expenses.filter((e) => e.projectId === project.id) : [];
    const received = receivables.filter((r) => r.status === "recebido").reduce((sum, r) => sum + parseNum(r.amount), 0);
    const toReceive = receivables.filter((r) => r.status !== "recebido" && r.status !== "cancelado").reduce((sum, r) => sum + parseNum(r.amount), 0);
    const extraExpenses = expenses.reduce((sum, e) => sum + parseNum(e.amount), 0);
    const cost = calc.subtotalCost + extraExpenses;
    const result = received + toReceive - cost;
    const receivableRows = receivables.map((r) => `<tr><td>${esc(r.description)}</td><td>${brDate(r.dueDate)}</td><td>${esc(r.status)}</td><td>${money(r.amount)}</td></tr>`).join("");
    const expenseRows = expenses.map((e) => `<tr><td>${esc(e.category)}</td><td>${esc(e.description)}</td><td>${brDate(e.date || e.dueDate)}</td><td>${money(e.amount)}</td></tr>`).join("");
    return `
      <div class="quote-tab-panel">
        <div class="three-col">
          <article class="card green"><span>Recebido</span><strong>${money(received)}</strong><small>Baixado no financeiro</small></article>
          <article class="card orange"><span>A receber</span><strong>${money(toReceive)}</strong><small>Previsões abertas</small></article>
          <article class="card ${result < 0 ? "red" : "green"}"><span>Resultado</span><strong>${money(result)}</strong><small>Receitas previstas - custos</small></article>
        </div>
        <div style="height:14px"></div>
        <div class="grid">
          <div class="table-wrap"><table><thead><tr><th>Recebimento</th><th>Vencimento</th><th>Status</th><th>Valor</th></tr></thead><tbody>${receivableRows || `<tr><td colspan="4">Nenhum recebimento vinculado a este orçamento.</td></tr>`}</tbody></table></div>
          <div class="table-wrap"><table><thead><tr><th>Despesa</th><th>Descrição</th><th>Data</th><th>Valor</th></tr></thead><tbody>${expenseRows || `<tr><td colspan="4">Nenhuma despesa adicional vinculada ao projeto.</td></tr>`}</tbody></table></div>
        </div>
      </div>
    `;
  }

  function renderInternalCostTables(q) {
    const materialRows = (q.materials || []).map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.qty)}</td><td>${esc(m.unit)}</td><td>${money(m.unitCost)}</td><td>${money(parseNum(m.qty) * parseNum(m.unitCost))}</td></tr>`).join("");
    const laborRows = (q.labor || []).map((l) => `<tr><td>${esc(l.role)}</td><td>${esc(l.days)}</td><td>${money(l.dailyRate)}</td><td>${money(parseNum(l.days) * parseNum(l.dailyRate))}</td></tr>`).join("");
    const extraRows = (q.extras || []).map((e) => `<tr><td>${esc(e.label)}</td><td>${money(e.amount)}</td></tr>`).join("");
    return `
      <div class="grid">
        <div class="table-wrap"><table><thead><tr><th>Material</th><th>Qtd.</th><th>Un.</th><th>Valor unit.</th><th>Total</th></tr></thead><tbody>${materialRows || `<tr><td colspan="5">Nenhum material lançado.</td></tr>`}</tbody></table></div>
        <div class="table-wrap"><table><thead><tr><th>Mão de obra</th><th>Diárias</th><th>Valor diária</th><th>Total</th></tr></thead><tbody>${laborRows || `<tr><td colspan="4">Nenhuma diária lançada.</td></tr>`}</tbody></table></div>
        <div class="table-wrap"><table><thead><tr><th>Extras/impostos</th><th>Total</th></tr></thead><tbody>${extraRows || `<tr><td colspan="2">Nenhum custo extra lançado.</td></tr>`}</tbody></table></div>
      </div>
    `;
  }

  function renderProjects() {
    return `
      <section class="grid">
        ${pageHeader("Projetos", `${state.projects.length} projeto(s) cadastrado(s).`)}
        <div class="panel">
          <div class="panel-head"><div><p class="eyebrow">Obras</p><h2>Projetos</h2></div></div>
          ${state.projects.length ? renderProjectTable(state.projects) : empty("Nenhum projeto cadastrado.", "Aprove um orçamento para transformar em projeto.")}
        </div>
      </section>
    `;
  }

  function renderProjectTable(projects) {
    return `
      <div class="table-wrap mobile-card-table project-table-wrap">
        <table>
          <thead><tr><th>Projeto</th><th>Cliente</th><th>Status</th><th>Vendido</th><th>Gasto</th><th>Resultado</th></tr></thead>
          <tbody>
            ${projects.map((p) => {
              const client = getClient(p.clientId);
              const result = projectResult(p.id);
              return `
                <tr>
                  <td data-label="Projeto"><button class="clickable" data-project-id="${p.id}">${esc(p.title)}</button></td>
                  <td data-label="Cliente">${client ? `<button class="clickable" data-client-id="${client.id}">${esc(client.name)}</button>` : ""}</td>
                  <td data-label="Status"><select data-project-status-change="${p.id}">${statusOrder.map((s) => `<option value="${s}" ${p.status === s ? "selected" : ""}>${statusLabels[s]}</option>`).join("")}</select></td>
                  <td data-label="Vendido">${p.quoteId ? `<button class="clickable" data-quote-id="${p.quoteId}">${money(result.sold)}</button>` : money(result.sold)}</td>
                  <td data-label="Gasto">${money(result.costs)}</td>
                  <td data-label="Resultado" class="${result.profit < 0 ? "danger-text" : ""}">${money(result.profit)}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderProjectDetail() {
    const project = getProject(state.activeProjectId);
    if (!project) return empty("Projeto não encontrado.", "Volte para a lista de projetos.");
    const client = getClient(project.clientId);
    const quote = getQuote(project.quoteId);
    const result = projectResult(project.id);
    const receivables = state.receivables.filter((r) => r.projectId === project.id || r.quoteId === project.quoteId);
    const expenses = state.expenses.filter((e) => e.projectId === project.id);
    return `
      <section class="grid">
        <div class="client-header">
          <div>
            <p class="eyebrow">Projeto / Obra</p>
            <h2>${esc(project.title)}</h2>
            <div class="meta-list">
              ${client ? `<button class="clickable" data-client-id="${client.id}">${esc(client.name)}</button>` : "<span>Sem cliente</span>"}
              ${quote ? `<button class="clickable" data-quote-id="${quote.id}">${esc(displayQuoteCode(quote.code))}</button>` : ""}
            </div>
          </div>
          <div class="actions">
            ${quote ? `<button class="btn" data-quote-id="${quote.id}">Abrir orçamento</button>` : ""}
          </div>
        </div>
        <div class="kpis">
          <article class="card orange"><span>Vendido</span><strong>${money(result.sold)}</strong><small>Valor aprovado</small></article>
          <article class="card green"><span>Recebido</span><strong>${money(result.received)}</strong><small>Baixado no financeiro</small></article>
          <article class="card red"><span>Custos</span><strong>${money(result.costs)}</strong><small>Base interna + despesas</small></article>
          <article class="card ${result.profit < 0 ? "red" : "green"}"><span>Resultado</span><strong>${money(result.profit)}</strong><small>Entradas previstas - custos</small></article>
        </div>
        <section class="panel">
          <div class="panel-head">
            <div><p class="eyebrow">Status</p><h2>Acompanhamento</h2></div>
            <select data-project-status-change="${project.id}">${statusOrder.map((s) => `<option value="${s}" ${project.status === s ? "selected" : ""}>${statusLabels[s]}</option>`).join("")}</select>
          </div>
          <p class="muted">O projeto mantém o valor aprovado do orçamento congelado. Alterações futuras de materiais não mudam este resultado.</p>
        </section>
        <div class="two-col">
          <section class="panel">
            <div class="panel-head"><div><p class="eyebrow">Financeiro</p><h2>Recebimentos</h2></div></div>
            <div class="table-wrap"><table><thead><tr><th>Descrição</th><th>Vencimento</th><th>Status</th><th>Valor</th></tr></thead><tbody>
              ${receivables.map((r) => `<tr><td>${esc(r.description)}</td><td>${brDate(r.dueDate)}</td><td>${esc(r.status)}</td><td>${money(r.amount)}</td></tr>`).join("") || `<tr><td colspan="4">Nenhum recebimento vinculado.</td></tr>`}
            </tbody></table></div>
          </section>
          <section class="panel">
            <div class="panel-head"><div><p class="eyebrow">Custos</p><h2>Despesas da obra</h2></div><button class="btn" data-action="new-expense">Nova despesa</button></div>
            <div class="table-wrap"><table><thead><tr><th>Categoria</th><th>Descrição</th><th>Data</th><th>Valor</th></tr></thead><tbody>
              ${expenses.map((e) => `<tr><td>${esc(e.category)}</td><td>${esc(e.description)}</td><td>${brDate(e.date || e.dueDate)}</td><td>${money(e.amount)}</td></tr>`).join("") || `<tr><td colspan="4">Nenhuma despesa vinculada.</td></tr>`}
            </tbody></table></div>
          </section>
        </div>
      </section>
    `;
  }

  function financeRange() {
    const now = new Date();
    const iso = (date) => date.toISOString().slice(0, 10);
    const period = state.financePeriod || "month";
    if (period === "previous_month") {
      return {
        start: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        end: iso(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    }
    if (period === "last_3_months") return { start: iso(new Date(now.getFullYear(), now.getMonth() - 2, 1)), end: iso(now) };
    if (period === "year") return { start: `${now.getFullYear()}-01-01`, end: `${now.getFullYear()}-12-31` };
    if (period === "previous_year") {
      const year = now.getFullYear() - 1;
      return { start: `${year}-01-01`, end: `${year}-12-31` };
    }
    if (period === "custom") {
      const fallback = currentMonthRange();
      return { start: state.financeStart || fallback.start, end: state.financeEnd || fallback.end };
    }
    return currentMonthRange();
  }

  function financeBreakdown(range) {
    const receivablesInPeriod = state.receivables.filter((r) => inRange(r.receivedAt || r.dueDate || r.createdAt, range.start, range.end));
    const expensesInPeriod = state.expenses.filter((e) => inRange(e.paidAt || e.dueDate || e.date, range.start, range.end));
    const received = receivablesInPeriod.filter((r) => r.status === "recebido").reduce((s, r) => s + parseNum(r.amount), 0);
    const toReceive = receivablesInPeriod.filter((r) => r.status !== "recebido" && r.status !== "cancelado").reduce((s, r) => s + parseNum(r.amount), 0);
    const projectCosts = expensesInPeriod.filter((e) => e.projectId && !e.fixed).reduce((s, e) => s + parseNum(e.amount), 0);
    const fixedExpenses = expensesInPeriod.filter((e) => e.fixed).reduce((s, e) => s + parseNum(e.amount), 0);
    const variableExpenses = expensesInPeriod.filter((e) => !e.fixed && !e.projectId).reduce((s, e) => s + parseNum(e.amount), 0);
    return { receivablesInPeriod, expensesInPeriod, received, toReceive, projectCosts, fixedExpenses, variableExpenses };
  }

  function renderFinancePeriodControls(range) {
    return `
      <div class="period-controls">
        <label>Período
          <select data-finance-period>
            <option value="month" ${state.financePeriod === "month" ? "selected" : ""}>Este mês</option>
            <option value="previous_month" ${state.financePeriod === "previous_month" ? "selected" : ""}>Mês passado</option>
            <option value="last_3_months" ${state.financePeriod === "last_3_months" ? "selected" : ""}>Últimos 3 meses</option>
            <option value="year" ${state.financePeriod === "year" ? "selected" : ""}>Este ano</option>
            <option value="previous_year" ${state.financePeriod === "previous_year" ? "selected" : ""}>Ano passado</option>
            <option value="custom" ${state.financePeriod === "custom" ? "selected" : ""}>Personalizado</option>
          </select>
        </label>
        ${state.financePeriod === "custom" ? `
          <label>De<input type="date" value="${esc(range.start)}" data-finance-start></label>
          <label>Até<input type="date" value="${esc(range.end)}" data-finance-end></label>
        ` : `<span class="period-pill">${brDate(range.start)} até ${brDate(range.end)}</span>`}
      </div>
    `;
  }

  function renderFinancePie(data) {
    const segments = [
      { label: "Recebido", value: data.received, color: "#00c08b" },
      { label: "A receber", value: data.toReceive, color: "#4ea1ff" },
      { label: "Custos de obra", value: data.projectCosts, color: "#ff4d4d" },
      { label: "Despesas fixas", value: data.fixedExpenses, color: "#ffb020" },
      { label: "Custos e despesas variáveis", value: data.variableExpenses, color: "#ff7a1a" },
    ];
    const total = segments.reduce((sum, item) => sum + item.value, 0);
    let cursor = 0;
    const gradient = total
      ? `conic-gradient(${segments.filter((segment) => segment.value > 0).map((segment) => {
        const start = cursor;
        cursor += (segment.value / total) * 100;
        return `${segment.color} ${start}% ${cursor}%`;
      }).join(", ")})`
      : "conic-gradient(#27344f 0 100%)";
    return `
      <section class="panel finance-pie-panel">
        <div class="panel-head"><div><p class="eyebrow">Distribuição</p><h2>Receitas, custos e despesas</h2></div></div>
        <div class="finance-pie-layout">
          <div class="finance-pie" style="background:${gradient}"><span>${total ? "100%" : "0%"}</span></div>
          <div class="finance-legend">
            ${segments.map((segment) => {
              const pct = total ? (segment.value / total) * 100 : 0;
              return `<div class="legend-row"><span><i style="background:${segment.color}"></i>${segment.label}</span><strong>${money(segment.value)} <small>${pct.toFixed(1)}%</small></strong></div>`;
            }).join("")}
          </div>
        </div>
      </section>
    `;
  }

  function renderFinance() {
    const range = financeRange();
    const data = financeBreakdown(range);
    const costsAndExpenses = data.projectCosts + data.fixedExpenses + data.variableExpenses;
    return `
      <section class="grid">
        ${pageHeader("Financeiro", "Entradas, valores a receber, custos e despesas da empresa.", renderFinancePeriodControls(range))}
        <div class="kpis">
          <article class="card green"><span>Recebido</span><strong>${money(data.received)}</strong><small>Baixado no período</small></article>
          <article class="card orange"><span>A receber</span><strong>${money(data.toReceive)}</strong><small>Previsões no período</small></article>
          <article class="card red"><span>Custos e despesas</span><strong>${money(costsAndExpenses)}</strong><small>Obra, variáveis e fixas</small></article>
          <article class="card ${data.received - costsAndExpenses < 0 ? "red" : "green"}"><span>Resultado</span><strong>${money(data.received - costsAndExpenses)}</strong><small>Recebido - saídas</small></article>
        </div>
        ${renderFinancePie(data)}
        <div class="two-col">
          <section class="panel">
            <div class="panel-head"><div><p class="eyebrow">Contas</p><h2>A receber</h2></div><button class="btn-secondary" data-action="export-receivables">Exportar CSV</button></div>
            ${data.receivablesInPeriod.length ? renderReceivablesTable(data.receivablesInPeriod) : empty("Nenhuma conta a receber neste período.", "Ao aprovar um orçamento, o sistema cria a previsão automaticamente.")}
          </section>
          <section class="panel">
            <div class="panel-head"><div><p class="eyebrow">Empresa</p><h2>Custos e despesas</h2></div><button class="btn" data-action="new-expense">Nova despesa</button></div>
            ${data.expensesInPeriod.length ? renderExpensesTable(data.expensesInPeriod) : empty("Nenhum custo ou despesa neste período.", "Lance custos fixos da empresa sem criar um cliente interno só para despesas.")}
          </section>
        </div>
      </section>
    `;
  }

  function renderReceivablesTable(rows = state.receivables) {
    return `
      <div class="table-wrap mobile-card-table receivable-table-wrap">
        <table>
          <thead><tr><th>Cliente</th><th>Descrição</th><th>Vencimento</th><th>Status</th><th>Valor</th><th class="right">Ações</th></tr></thead>
          <tbody>
            ${rows.map((r) => {
              const c = getClient(r.clientId);
              const description = r.quoteId ? `<button class="clickable" data-quote-id="${r.quoteId}">${esc(r.description)}</button>` : r.projectId ? `<button class="clickable" data-project-id="${r.projectId}">${esc(r.description)}</button>` : esc(r.description);
              return `<tr><td data-label="Cliente">${c ? `<button class="clickable" data-client-id="${c.id}">${esc(c.name)}</button>` : ""}</td><td data-label="Descrição">${description}</td><td data-label="Vencimento">${brDate(r.dueDate)}</td><td data-label="Status">${esc(r.status)}</td><td data-label="Valor">${money(r.amount)}</td><td data-label="Ações" class="right action-cell">${r.status !== "recebido" ? `<button class="btn-secondary" data-receive="${r.id}">Receber</button>` : ""}<button class="icon-action" title="Editar conta" data-edit-receivable="${r.id}">✎</button><button class="icon-action danger" title="Excluir conta" data-delete-receivable="${r.id}">🗑</button></td></tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderExpensesTable(rows = state.expenses) {
    return `
      <div class="table-wrap mobile-card-table expense-table-wrap">
        <table>
          <thead><tr><th>Categoria</th><th>Descrição</th><th>Tipo</th><th>Data</th><th>Valor</th><th class="right">Ações</th></tr></thead>
          <tbody>
            ${rows.map((e) => `<tr><td data-label="Categoria">${esc(e.category)}</td><td data-label="Descrição">${esc(e.description)}</td><td data-label="Tipo">${e.fixed ? "Despesa fixa" : e.projectId ? "Custo de obra" : "Variável"}</td><td data-label="Data">${brDate(e.date || e.dueDate)}</td><td data-label="Valor">${money(e.amount)}</td><td data-label="Ações" class="right action-cell"><button class="icon-action" title="Editar despesa" data-edit-expense="${e.id}">✎</button><button class="icon-action danger" title="Excluir despesa" data-delete-expense="${e.id}">🗑</button></td></tr>`).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderTime() {
    return `
      <section class="grid">
        ${pageHeader("Ponto", "Controle de colaboradores, horas normais e horas extras.")}
        <div class="two-col">
          <section class="panel">
            <div class="panel-head"><div><p class="eyebrow">Equipe</p><h2>Colaboradores</h2></div><button class="btn" data-action="new-employee">Novo colaborador</button></div>
            ${state.employees.length ? renderEmployeesTable() : empty("Nenhum colaborador cadastrado.", "Cadastre a equipe para controlar horas normais e extras.")}
          </section>
          <section class="panel">
            <div class="panel-head"><div><p class="eyebrow">Ponto</p><h2>Registro diário</h2></div><button class="btn" data-action="new-time-entry">Lançar ponto</button></div>
            ${state.timeEntries.length ? renderTimeTable() : empty("Nenhum ponto lançado.", "Lance entrada, intervalo e saída para calcular horas.")}
          </section>
        </div>
        <section class="panel">
          <div class="panel-head"><div><p class="eyebrow">Relatório</p><h2>Exportação de ponto</h2></div><div class="actions"><button class="btn-secondary" data-action="preview-time-report">Prévia PDF</button><button class="btn-secondary" data-action="export-time">Exportar CSV</button></div></div>
          <p class="muted">O relatório separa horas normais, extra 50% e extra 100% conforme jornada padrão da empresa. O CSV abre no Excel e pode ser importado no Google Sheets.</p>
        </section>
      </section>
    `;
  }

  function renderEmployeesTable() {
    return `<div class="table-wrap mobile-card-table employee-table-wrap"><table><thead><tr><th>Nome</th><th>Função</th><th>Valor diária</th><th>Status</th><th class="right">Ações</th></tr></thead><tbody>${state.employees.map((e) => `<tr><td data-label="Nome">${esc(e.name)}</td><td data-label="Função">${esc(e.role)}</td><td data-label="Valor diária">${money(e.dailyRate)}</td><td data-label="Status">${e.active ? "Ativo" : "Inativo"}</td><td data-label="Ações" class="right action-cell"><button class="icon-action" title="Editar colaborador" data-edit-employee="${e.id}">✎</button><button class="icon-action danger" title="Excluir colaborador" data-delete-employee="${e.id}">🗑</button></td></tr>`).join("")}</tbody></table></div>`;
  }

  function renderTimeTable() {
    return `<div class="table-wrap mobile-card-table time-table-wrap"><table><thead><tr><th>Colaborador</th><th>Data</th><th>Normal</th><th>Extra 50%</th><th>Extra 100%</th><th>Obra</th><th class="right">Ações</th></tr></thead><tbody>${state.timeEntries.map((entry) => {
      const employee = state.employees.find((e) => e.id === entry.employeeId);
      const calc = calcTime(entry);
      const project = getProject(entry.projectId);
      return `<tr><td data-label="Colaborador">${esc(employee ? employee.name : "")}</td><td data-label="Data">${brDate(entry.date)}</td><td data-label="Normal">${formatHours(calc.normal)}</td><td data-label="Extra 50%">${formatHours(calc.extra50)}</td><td data-label="Extra 100%">${formatHours(calc.extra100)}</td><td data-label="Obra">${esc(project ? project.title : "")}</td><td data-label="Ações" class="right action-cell"><button class="icon-action danger" title="Excluir ponto" data-delete-time="${entry.id}">🗑</button></td></tr>`;
    }).join("")}</tbody></table></div>`;
  }

  function renderCosts() {
    const workday = state.costSettings.workday || {};
    return `
      <section class="grid">
        ${pageHeader("Custos", "Parâmetros, materiais e fornecedores usados no cálculo dos orçamentos.")}
        <section class="panel">
          <div class="panel-head"><div><p class="eyebrow">Parâmetros gerais</p><h2>Base de cálculo</h2></div><button class="btn" data-action="edit-cost-settings">Editar parâmetros</button></div>
          <div class="summary-list">
            <div class="summary-line"><span>Margem padrão</span><strong>${parseNum(state.costSettings.defaultMarginPct)}%</strong></div>
            <div class="summary-line"><span>Pintura eletrostática</span><strong>${money(state.costSettings.paintPriceM2)}/m²</strong></div>
            <div class="summary-line"><span>Jornada padrão</span><strong>${esc(workday.morningStart || "07:00")} às ${esc(workday.morningEnd || "11:30")} / ${esc(workday.afternoonStart || "13:00")} às ${esc(workday.afternoonEnd || "17:00")}</strong></div>
          </div>
        </section>
        <div class="two-col">
          <section class="panel">
            <div class="panel-head"><div><p class="eyebrow">Mão de obra</p><h2>Diárias por função</h2></div><button class="btn" data-action="new-role">Adicionar função</button></div>
            <div class="table-wrap"><table><thead><tr><th>Função</th><th>Valor diária</th><th class="right">Ações</th></tr></thead><tbody>${state.costSettings.laborRoles.map((r) => `<tr><td>${esc(r.role)}</td><td>${money(r.dailyRate)}</td><td class="right action-cell"><button class="icon-action" title="Editar função" data-edit-role="${r.id}">✎</button><button class="icon-action danger" title="Excluir função" data-delete-role="${r.id}">🗑</button></td></tr>`).join("")}</tbody></table></div>
          </section>
          <section class="panel">
            <div class="panel-head"><div><p class="eyebrow">Materiais</p><h2>Catálogo</h2></div><button class="btn" data-action="new-material">Novo material</button></div>
            ${state.materials.length ? renderMaterialsTable() : empty("Nenhum material cadastrado.", "Cadastre metalon, perfis, chapas, pintura e insumos.")}
          </section>
        </div>
      </section>
    `;
  }

  function renderMaterials() {
    return `
      <section class="grid">
        ${pageHeader("Materiais", "Alterar valores aqui afeta apenas novos orçamentos.", `<button class="btn" data-action="new-material">+ Novo material</button>`)}
        <div class="panel">
          ${state.materials.length ? renderMaterialsTable() : empty("Nenhum material cadastrado.", "Cadastre metalon, perfis, chapas, pintura e insumos.")}
        </div>
      </section>
    `;
  }

  function renderMaterialsTable() {
    return `<div class="table-wrap mobile-card-table material-table-wrap"><table><thead><tr><th>Material</th><th>Unidade</th><th>Preço atual</th><th>Status</th><th class="right">Ações</th></tr></thead><tbody>${state.materials.map((m) => `<tr><td data-label="Material">${esc(m.name)}</td><td data-label="Unidade">${esc(m.unit)}</td><td data-label="Preço atual">${money(m.price)}</td><td data-label="Status">${m.active === false ? "Inativo" : "Ativo"}</td><td data-label="Ações" class="right action-cell"><button class="icon-action" title="Editar material" data-edit-material="${m.id}">✎</button><button class="icon-action danger" title="Excluir material" data-delete-material="${m.id}">🗑</button></td></tr>`).join("")}</tbody></table></div>`;
  }

  function renderSettings() {
    return `
      <section class="grid">
        ${pageHeader("Configurações", "Dados da empresa e padrões usados nos orçamentos.")}
        <div class="two-col">
          <section class="panel">
            <div class="panel-head"><div><p class="eyebrow">Empresa</p><h2>Dados e pagamento</h2></div><button class="btn" data-action="edit-settings">Editar</button></div>
            <div class="summary-list">
              <div class="summary-line"><span>Empresa</span><strong>${esc(state.settings.companyName)}</strong></div>
              <div class="summary-line"><span>CNPJ</span><strong>${esc(state.settings.document)}</strong></div>
              <div class="summary-line"><span>PIX</span><strong>${esc(state.settings.pix || "Não informado")}</strong></div>
            </div>
          </section>
          <section class="panel">
            <div class="panel-head"><div><p class="eyebrow">Legado</p><h2>Importar CSV</h2></div></div>
            <div class="stack">
              <label>Clientes CSV<input type="file" accept=".csv" data-import="clients"></label>
              <label>Pedidos CSV<input type="file" accept=".csv" data-import="jobs"></label>
              <label>Recebimentos CSV<input type="file" accept=".csv" data-import="receipts"></label>
              <p class="muted">A importação vincula clientes, pedidos e recebimentos pelo ID legado quando possível.</p>
            </div>
          </section>
        </div>
        <section class="panel">
          <div class="panel-head"><div><p class="eyebrow">Acesso</p><h2>Usuários</h2></div><button class="btn" data-action="new-user">Novo usuário</button></div>
          <div class="table-wrap"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Status</th><th class="right">Ações</th></tr></thead><tbody>${(state.users || []).map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(userRoleLabel(u.role))}</td><td>${u.active === false ? "Inativo" : "Ativo"}</td><td class="right action-cell"><button class="icon-action" title="Editar usuário" data-edit-user="${u.id}">✎</button><button class="icon-action danger" title="Excluir usuário" data-delete-user="${u.id}">🗑</button></td></tr>`).join("")}</tbody></table></div>
          <p class="muted">Nesta versão local, a tela organiza usuários e perfis para validação do cliente. Controle real de acesso precisa do Supabase Auth/RLS no deploy.</p>
        </section>
      </section>
    `;
  }

  function userRoleLabel(role) {
    return { admin: "Administrador", operator: "Operacional", financial: "Financeiro" }[role] || role || "";
  }

  function empty(title, text) {
    return `<div class="empty"><div><h3>${title}</h3><p>${text}</p></div></div>`;
  }

  function openModal(html) {
    modalRoot.innerHTML = `<div class="modal-backdrop">${html}</div>`;
    modalRoot.querySelectorAll("[data-close-modal]").forEach((el) => el.addEventListener("click", closeModal));
  }

  function closeModal() {
    modalRoot.innerHTML = "";
  }

  function serializeForm(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function openClientModal(clientId) {
    const client = clientId ? getClient(clientId) : {};
    openModal(`
      <form class="modal small" id="clientForm">
        <div class="modal-head"><h2>${clientId ? "Editar cliente" : "Novo cliente"}</h2><button class="btn-ghost" type="button" data-close-modal>Fechar</button></div>
        <div class="modal-body form-grid">
          <label class="wide">Nome<input name="name" required value="${esc(client.name || "")}"></label>
          <label>CPF/CNPJ<input name="document" value="${esc(client.document || "")}" placeholder="Opcional"></label>
          <label>Telefone<input name="phone" value="${esc(client.phone || "")}"></label>
          <label>Email<input name="email" value="${esc(client.email || "")}"></label>
          <button class="btn-secondary wide" type="button" data-lookup-cnpj>Buscar dados pelo CNPJ</button>
          <label class="wide">Endereço<input name="address" value="${esc(client.address || "")}"></label>
        </div>
        <div class="modal-foot"><button class="btn-secondary" type="button" data-close-modal>Cancelar</button><button class="btn" type="submit">Salvar</button></div>
      </form>
    `);
    document.getElementById("clientForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const data = serializeForm(event.currentTarget);
      if (clientId) Object.assign(client, data);
      else state.clients.push({ id: uid(), createdAt: today(), ...data });
      save();
      closeModal();
      render();
    });
    document.querySelector("[data-lookup-cnpj]").addEventListener("click", () => lookupCnpj(document.getElementById("clientForm")));
  }

  async function lookupCnpj(form) {
    const docInput = form.elements.document;
    const digits = String(docInput.value || "").replace(/\D/g, "");
    if (digits.length !== 14) {
      window.alert("A busca automática está disponível apenas para CNPJ. CPF não possui consulta pública segura.");
      return;
    }
    const button = form.querySelector("[data-lookup-cnpj]");
    const original = button.textContent;
    button.textContent = "Buscando...";
    button.disabled = true;
    try {
      const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);
      if (!response.ok) throw new Error("CNPJ não encontrado");
      const data = await response.json();
      form.elements.name.value = data.razao_social || data.nome_fantasia || form.elements.name.value;
      form.elements.phone.value = data.ddd_telefone_1 || form.elements.phone.value;
      form.elements.email.value = data.email || form.elements.email.value;
      form.elements.address.value = [
        data.logradouro,
        data.numero,
        data.bairro,
        data.municipio,
        data.uf,
      ].filter(Boolean).join(", ");
    } catch (_) {
      window.alert("Não foi possível buscar esse CNPJ agora. Confira a internet e os dados digitados.");
    } finally {
      button.textContent = original;
      button.disabled = false;
    }
  }

  function openQuoteModalLegacy(existingId, forcedClientId) {
    if (!existingId && !state.clients.length) {
      openModal(`
        <div class="modal small">
          <div class="modal-head"><h2>Novo orçamento</h2><button class="btn-ghost" type="button" data-close-modal>Fechar</button></div>
          <div class="modal-body">
            ${empty("Cadastre um cliente primeiro.", "O orçamento precisa ser nominal ao cliente para sair com CPF/CNPJ e dados corretos no PDF.")}
          </div>
          <div class="modal-foot"><button class="btn-secondary" type="button" data-close-modal>Cancelar</button><button class="btn" type="button" data-action="new-client">Cadastrar cliente</button></div>
        </div>
      `);
      return;
    }
    const q = existingId ? getQuote(existingId) : null;
    openModal(`
      <form class="modal" id="quoteForm">
        <div class="modal-head"><h2>${q ? "Editar orçamento" : "Novo orçamento"}</h2><button class="btn-ghost" type="button" data-close-modal>Fechar</button></div>
        <div class="modal-body stack">
          <section class="ai-assistant">
            <div class="ai-assistant-head">
              <span class="ai-spark">✦</span>
              <div>
                <h3>Assistente de texto com IA</h3>
                <p>Use os botões abaixo para gerar textos comerciais do orçamento.</p>
              </div>
            </div>
            <div class="ai-assistant-actions">
              <button class="btn ai-button" type="button" data-ai-generate="description">✦ Gerar descrição do orçamento</button>
              <button class="btn ai-button" type="button" data-ai-generate="payment">✦ Gerar condições de pagamento</button>
            </div>
          </section>
          <div class="form-grid">
              <label>Cliente<select name="clientId" required>${state.clients.map((c) => `<option value="${c.id}" ${(q && q.clientId === c.id) || forcedClientId === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
            <label>Status<select name="status">${statusOrder.map((s) => `<option value="${s}" ${q && q.status === s ? "selected" : ""}>${statusLabels[s]}</option>`).join("")}</select></label>
            <label>Título do pedido<input name="title" required value="${esc(q ? q.title : "")}" placeholder="Portão social, telhado, guarda-corpo"></label>
            <label>Quantidade comercial<input name="commercialQty" value="${esc(q ? q.commercialQty : "1")}" inputmode="decimal"></label>
            <label class="wide">Descrição comercial<textarea name="description">${esc(q ? q.description : "")}</textarea></label>
            <label>Validade<input name="validity" value="${esc(q ? q.validity : "5 dias")}"></label>
            <label>Prazo<input name="deadline" value="${esc(q ? q.deadline : "")}"></label>
            <label>Margem (%)<input name="marginPct" value="${esc(q ? q.marginPct : state.costSettings.defaultMarginPct)}" inputmode="decimal"></label>
            <label class="wide">Condições de pagamento<textarea name="paymentTerms">${esc(q ? q.paymentTerms : "")}</textarea></label>
          </div>
          <section class="panel">
            <div class="panel-head"><div><p class="eyebrow">Base interna</p><h3>Materiais simples</h3></div><button class="btn-secondary" type="button" data-add-material-line>Adicionar material</button></div>
            <div id="materialLines" class="stack">${renderMaterialInputs(q ? q.materials : [])}</div>
            ${renderMaterialsDatalist()}
          </section>
          <section class="panel">
            <div class="panel-head"><div><p class="eyebrow">Base interna</p><h3>Mão de obra e extras</h3></div></div>
            <div class="form-grid">
              <label>Função<select name="laborRole"><option value="">Selecionar</option>${state.costSettings.laborRoles.map((r) => `<option value="${r.id}">${esc(r.role)} - ${money(r.dailyRate)}</option>`).join("")}</select></label>
              <label>Diárias<input name="laborDays" value="" inputmode="decimal"></label>
              <label>Extra/Imposto descrição<input name="extraLabel" value=""></label>
              <label>Extra/Imposto valor<input name="extraAmount" value="" inputmode="decimal"></label>
            </div>
          </section>
        </div>
        <div class="modal-foot"><button class="btn-secondary" type="button" data-close-modal>Cancelar</button><button class="btn" type="submit">Salvar orçamento</button></div>
      </form>
    `);

    document.querySelector("[data-add-material-line]").addEventListener("click", () => {
      document.getElementById("materialLines").insertAdjacentHTML("beforeend", renderMaterialInput());
    });
    document.getElementById("quoteForm").addEventListener("input", (event) => {
      if (event.target.matches("[name='materialName']")) fillMaterialFromCatalog(event.target);
    });
    document.querySelectorAll("[data-ai-generate]").forEach((button) => {
      button.addEventListener("click", () => openAiTextPopup(button.dataset.aiGenerate, "form"));
    });

    document.getElementById("quoteForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = serializeForm(form);
      const materials = [...form.querySelectorAll("[data-material-row]")].map((row) => ({
        id: uid(),
        materialId: row.querySelector("[name='materialId']").value,
        name: row.querySelector("[name='materialName']").value,
        qty: parseNum(row.querySelector("[name='materialQty']").value),
        unit: row.querySelector("[name='materialUnit']").value,
        unitCost: parseNum(row.querySelector("[name='materialUnitCost']").value),
        snapshot: snapshotForMaterial(row),
      })).filter((m) => m.name && m.qty);
      const labor = [];
      const selectedRole = state.costSettings.laborRoles.find((r) => r.id === data.laborRole);
      if (selectedRole && parseNum(data.laborDays)) {
        labor.push({ id: uid(), role: selectedRole.role, days: parseNum(data.laborDays), dailyRate: parseNum(selectedRole.dailyRate), snapshot: { capturedAt: new Date().toISOString() } });
      }
      const extras = [];
      if (data.extraLabel && parseNum(data.extraAmount)) extras.push({ id: uid(), label: data.extraLabel, amount: parseNum(data.extraAmount) });

      if (q) {
        Object.assign(q, { ...data, materials, labor: [...(q.labor || []), ...labor], extras: [...(q.extras || []), ...extras], updatedAt: today() });
        handleStatusSideEffects(q);
      } else {
        const quote = { id: uid(), code: codeForNextQuote(), createdAt: today(), receivableGenerated: false, projectGenerated: false, ...data, materials, labor, extras };
        state.quotes.push(quote);
        handleStatusSideEffects(quote);
        state.activeQuoteId = quote.id;
      }
      save();
      closeModal();
      routeTo("quoteDetail", { activeQuoteId: q ? q.id : state.activeQuoteId, activeQuoteTab: "summary" });
    });
  }

  function openQuoteModal(existingId, forcedClientId) {
    if (!existingId && !state.clients.length) {
      openModal(`
        <div class="modal small">
          <div class="modal-head"><h2>Novo orçamento</h2><button class="btn-ghost" type="button" data-close-modal>Fechar</button></div>
          <div class="modal-body">
            ${empty("Cadastre um cliente primeiro.", "O orçamento precisa ser nominal ao cliente para sair com CPF/CNPJ e dados corretos no PDF.")}
          </div>
          <div class="modal-foot"><button class="btn-secondary" type="button" data-close-modal>Cancelar</button><button class="btn" type="button" data-action="new-client">Cadastrar cliente</button></div>
        </div>
      `);
      return;
    }

    const q = existingId ? getQuote(existingId) : null;
    const steps = ["Cliente", "Projeto", "Materiais", "Custos", "Proposta", "Resumo"];
    let currentStep = 0;

    openModal(`
      <form class="modal quote-wizard-modal" id="quoteForm">
        <div class="modal-head">
          <h2>${q ? "Editar orçamento" : "Novo orçamento"}</h2>
          <button class="btn-ghost modal-close-x" type="button" data-close-modal aria-label="Fechar">×</button>
        </div>
        <div class="quote-stepper">
          ${steps.map((step, index) => `
            <button type="button" class="quote-step ${index === 0 ? "active" : ""}" data-wizard-step="${index}">
              <span>${index < 5 ? "✓" : index + 1}</span>${esc(step)}
            </button>
          `).join("")}
        </div>
        <div class="modal-body quote-wizard-body">
          <section class="wizard-panel active" data-wizard-panel="0">
            <div class="wizard-block">
              <p class="eyebrow">Cliente</p>
              <h3>Dados do cliente</h3>
              <div class="form-grid">
                <label class="wide">Cliente
                  <select name="clientId" required>
                    ${state.clients.map((c) => `<option value="${c.id}" ${(q && q.clientId === c.id) || forcedClientId === c.id ? "selected" : ""}>${esc(c.name)}${c.document ? ` - ${esc(c.document)}` : ""}</option>`).join("")}
                  </select>
                </label>
              </div>
              <p class="muted">O nome, CPF/CNPJ e contato cadastrados entram automaticamente no PDF comercial.</p>
            </div>
          </section>

          <section class="wizard-panel" data-wizard-panel="1">
            <div class="wizard-block">
              <p class="eyebrow">Projeto</p>
              <h3>Pedido e prazos</h3>
              <div class="form-grid">
                <label>Status<select name="status">${statusOrder.map((s) => `<option value="${s}" ${(q ? q.status : "pendente") === s ? "selected" : ""}>${statusLabels[s]}</option>`).join("")}</select></label>
                <label>Título do pedido<input name="title" required value="${esc(q ? q.title : "")}" placeholder="Portão social, telhado, guarda-corpo"></label>
                <label>Quantidade comercial<input name="commercialQty" value="${esc(q ? q.commercialQty : "1")}" inputmode="decimal"></label>
                <label>Validade<input name="validity" value="${esc(q ? q.validity : "5 dias")}"></label>
                <label>Prazo<input name="deadline" value="${esc(q ? q.deadline : "")}" placeholder="7 dias úteis"></label>
              </div>
            </div>
          </section>

          <section class="wizard-panel" data-wizard-panel="2">
            <div class="wizard-block">
              <div class="panel-head">
                <div><p class="eyebrow">Materiais</p><h3>Base interna de materiais</h3></div>
                <button class="btn-secondary" type="button" data-add-material-line>Adicionar material</button>
              </div>
              <div id="materialLines" class="stack">${renderMaterialInputs(q ? q.materials : [])}</div>
              ${renderMaterialsDatalist()}
              <p class="muted">Esses itens servem para cálculo interno. Eles não aparecem detalhados no PDF do cliente.</p>
            </div>
          </section>

          <section class="wizard-panel" data-wizard-panel="3">
            <div class="wizard-block">
              <p class="eyebrow">Custos</p>
              <h3>Pintura, mão de obra e extras</h3>
              <div class="form-grid">
                <label>Margem (%)<input name="marginPct" value="${esc(q ? q.marginPct : state.costSettings.defaultMarginPct)}" inputmode="decimal"></label>
                <label>Pintura (R$)<input name="paintAmount" value="${esc(q ? q.paintAmount || "" : "")}" inputmode="decimal"></label>
                <label>Função<select name="laborRole"><option value="">Selecionar</option>${state.costSettings.laborRoles.map((r) => `<option value="${r.id}">${esc(r.role)} - ${money(r.dailyRate)}</option>`).join("")}</select></label>
                <label>Diárias<input name="laborDays" value="" inputmode="decimal"></label>
                <label>Extra/Imposto descrição<input name="extraLabel" value=""></label>
                <label>Extra/Imposto valor<input name="extraAmount" value="" inputmode="decimal"></label>
              </div>
              <p class="muted">Custos e margem ficam apenas na base interna. O cliente vê somente a proposta comercial.</p>
            </div>
          </section>

          <section class="wizard-panel" data-wizard-panel="4">
            <div class="wizard-block">
              <section class="ai-assistant">
                <div class="ai-assistant-head">
                  <span class="ai-spark">✦</span>
                  <div>
                    <h3>Assistente de texto com IA</h3>
                    <p>Digite simples, gere um texto comercial e edite antes de enviar ao cliente.</p>
                  </div>
                </div>
                <div class="ai-assistant-actions">
                  <button class="btn ai-button" type="button" data-ai-generate="description">✦ Gerar descrição do orçamento</button>
                  <button class="btn ai-button" type="button" data-ai-generate="payment">✦ Gerar condições de pagamento</button>
                </div>
              </section>
              <div class="form-grid">
                <label class="wide">Descrição comercial<textarea name="description">${esc(q ? q.description : "")}</textarea></label>
                <label class="wide">Condições de pagamento<textarea name="paymentTerms">${esc(q ? q.paymentTerms : state.settings.defaultTerms || "")}</textarea></label>
              </div>
            </div>
          </section>

          <section class="wizard-panel" data-wizard-panel="5">
            <div class="wizard-summary-card" id="wizardSummary"></div>
            <div class="wizard-pdf-actions">
              <label class="switch-line"><input type="checkbox" name="downloadAfterSave"> <span></span> Gerar PDF e baixar ao concluir</label>
              <div class="actions">
                <button class="btn-secondary" type="button" data-toggle-live-preview>Ver prévia ao vivo</button>
                <button class="btn-secondary" type="button" data-print-draft>Baixar PDF agora</button>
              </div>
            </div>
            <div class="wizard-live-preview" id="wizardPdfPreview" hidden></div>
          </section>
        </div>
        <div class="modal-foot wizard-foot">
          <button class="btn-secondary wizard-back" type="button" data-prev-step>← Voltar</button>
          <button class="btn wizard-next" type="button" data-next-step>Avançar</button>
          <button class="btn wizard-finish" type="submit" hidden>Concluir orçamento</button>
        </div>
      </form>
    `);

    const form = document.getElementById("quoteForm");
    const panels = [...form.querySelectorAll("[data-wizard-panel]")];
    const stepButtons = [...form.querySelectorAll("[data-wizard-step]")];
    const prevButton = form.querySelector("[data-prev-step]");
    const nextButton = form.querySelector("[data-next-step]");
    const finishButton = form.querySelector(".wizard-finish");
    const previewPanel = form.querySelector("#wizardPdfPreview");

    const setStep = (index) => {
      currentStep = Math.max(0, Math.min(index, steps.length - 1));
      panels.forEach((panel, panelIndex) => panel.classList.toggle("active", panelIndex === currentStep));
      stepButtons.forEach((button, buttonIndex) => {
        button.classList.toggle("active", buttonIndex === currentStep);
        button.classList.toggle("done", buttonIndex < currentStep);
        button.querySelector("span").textContent = buttonIndex < currentStep ? "✓" : buttonIndex + 1;
      });
      prevButton.disabled = currentStep === 0;
      nextButton.hidden = currentStep === steps.length - 1;
      finishButton.hidden = currentStep !== steps.length - 1;
      refreshWizardSummary();
    };

    const refreshWizardSummary = () => {
      const draft = buildQuoteDraftFromForm(form, q);
      form.querySelector("#wizardSummary").innerHTML = renderQuoteWizardSummary(draft);
      if (!previewPanel.hidden) previewPanel.innerHTML = `<div class="paper">${proposalHtml(draft.quote, false)}</div>`;
    };

    form.querySelector("[data-add-material-line]").addEventListener("click", () => {
      document.getElementById("materialLines").insertAdjacentHTML("beforeend", renderMaterialInput());
      refreshWizardSummary();
    });

    form.addEventListener("input", (event) => {
      if (event.target.matches("[name='materialName']")) fillMaterialFromCatalog(event.target);
      refreshWizardSummary();
    });
    form.addEventListener("change", refreshWizardSummary);

    form.querySelectorAll("[data-ai-generate]").forEach((button) => {
      button.addEventListener("click", () => openAiTextPopup(button.dataset.aiGenerate, "form"));
    });

    form.querySelectorAll("[data-wizard-step]").forEach((button) => {
      button.addEventListener("click", () => setStep(Number(button.dataset.wizardStep)));
    });

    nextButton.addEventListener("click", () => {
      const activeRequired = panels[currentStep].querySelectorAll("input[required], select[required], textarea[required]");
      const invalid = [...activeRequired].find((field) => !field.checkValidity());
      if (invalid) {
        invalid.reportValidity();
        return;
      }
      setStep(currentStep + 1);
    });
    prevButton.addEventListener("click", () => setStep(currentStep - 1));

    form.querySelector("[data-toggle-live-preview]").addEventListener("click", () => {
      previewPanel.hidden = !previewPanel.hidden;
      refreshWizardSummary();
    });

    form.querySelector("[data-print-draft]").addEventListener("click", () => {
      const draft = buildQuoteDraftFromForm(form, q);
      printArea.innerHTML = proposalHtml(draft.quote, true);
      window.print();
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const draft = buildQuoteDraftFromForm(form, q);
      if (q) {
        Object.assign(q, { ...draft.data, materials: draft.materials, labor: draft.labor, extras: draft.extras, updatedAt: today() });
        handleStatusSideEffects(q);
      } else {
        const quote = { id: uid(), code: codeForNextQuote(), createdAt: today(), receivableGenerated: false, projectGenerated: false, ...draft.data, materials: draft.materials, labor: draft.labor, extras: draft.extras };
        state.quotes.push(quote);
        handleStatusSideEffects(quote);
        state.activeQuoteId = quote.id;
      }
      const savedQuote = q || getQuote(state.activeQuoteId);
      save();
      if (form.elements.downloadAfterSave.checked && savedQuote) {
        printArea.innerHTML = proposalHtml(savedQuote, true);
        window.print();
      }
      closeModal();
      routeTo("quoteDetail", { activeQuoteId: savedQuote ? savedQuote.id : state.activeQuoteId, activeQuoteTab: "summary" });
    });

    setStep(0);
  }

  function buildQuoteDraftFromForm(form, existingQuote = null) {
    const data = serializeForm(form);
    delete data.laborRole;
    delete data.laborDays;
    delete data.extraLabel;
    delete data.extraAmount;
    delete data.downloadAfterSave;
    delete data.materialId;
    delete data.materialName;
    delete data.materialQty;
    delete data.materialUnit;
    delete data.materialUnitCost;
    const materials = [...form.querySelectorAll("[data-material-row]")].map((row) => ({
      id: row.dataset.existingId || uid(),
      materialId: row.querySelector("[name='materialId']").value,
      name: row.querySelector("[name='materialName']").value,
      qty: parseNum(row.querySelector("[name='materialQty']").value),
      unit: row.querySelector("[name='materialUnit']").value,
      unitCost: parseNum(row.querySelector("[name='materialUnitCost']").value),
      snapshot: snapshotForMaterial(row),
    })).filter((m) => m.name && m.qty);
    const labor = [...(existingQuote && existingQuote.labor ? existingQuote.labor : [])];
    const selectedRole = state.costSettings.laborRoles.find((r) => r.id === form.elements.laborRole.value);
    if (selectedRole && parseNum(form.elements.laborDays.value)) {
      labor.push({ id: uid(), role: selectedRole.role, days: parseNum(form.elements.laborDays.value), dailyRate: parseNum(selectedRole.dailyRate), snapshot: { capturedAt: new Date().toISOString() } });
    }
    const extras = [...(existingQuote && existingQuote.extras ? existingQuote.extras : [])];
    if (form.elements.extraLabel.value && parseNum(form.elements.extraAmount.value)) {
      extras.push({ id: uid(), label: form.elements.extraLabel.value, amount: parseNum(form.elements.extraAmount.value) });
    }
    const quote = {
      ...(existingQuote || {}),
      id: existingQuote ? existingQuote.id : "__preview",
      code: existingQuote ? existingQuote.code : codeForNextQuote(),
      createdAt: existingQuote ? existingQuote.createdAt : today(),
      receivableGenerated: existingQuote ? existingQuote.receivableGenerated : false,
      projectGenerated: existingQuote ? existingQuote.projectGenerated : false,
      ...data,
      paintAmount: parseNum(data.paintAmount),
      materials,
      labor,
      extras,
    };
    return { data: { ...data, paintAmount: parseNum(data.paintAmount) }, materials, labor, extras, quote, calc: calcQuote(quote), client: getClient(data.clientId) };
  }

  function renderQuoteWizardSummary(draft) {
    const q = draft.quote;
    const calc = draft.calc;
    return `
      <div class="summary-grid">
        <span>Cliente</span><strong>${esc(draft.client ? draft.client.name : "Sem cliente")}</strong>
        <span>Projeto</span><strong>${esc(q.title || "Sem título")}</strong>
        <span>Itens</span><strong>${esc(q.commercialQty || "1")}</strong>
      </div>
      <div class="summary-grid totals">
        <span>Materiais</span><strong>${money(calc.materials)}</strong>
        <span>Pintura</span><strong>${money(calc.paint || 0)}</strong>
        <span>Mão de obra</span><strong>${money(calc.labor)}</strong>
        <span>Custos extras</span><strong>${money(calc.extras)}</strong>
        <span>Subtotal</span><strong>${money(calc.subtotalCost)}</strong>
        <span>Margem (${parseNum(q.marginPct)}%)</span><strong>${money(calc.total - calc.subtotalCost)}</strong>
      </div>
      <div class="summary-total"><span>TOTAL</span><strong>${money(calc.total)}</strong></div>
    `;
  }

  function applyQuoteAssistant(type, brief = "") {
    const form = document.getElementById("quoteForm");
    if (!form) return;
    if (type === "description") {
      form.elements.description.value = buildQuoteDescription(form, brief);
      form.elements.description.focus();
      form.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    if (type === "payment") {
      form.elements.paymentTerms.value = buildPaymentTerms(form, brief);
      form.elements.paymentTerms.focus();
      form.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function buildQuoteDescription(form, brief = "") {
    const client = getClient(form.elements.clientId.value);
    const title = form.elements.title.value.trim() || "serviço solicitado";
    const qty = form.elements.commercialQty.value.trim() || "1";
    const materials = [...form.querySelectorAll("[data-material-row]")]
      .map((row) => row.querySelector("[name='materialName']").value.trim())
      .filter(Boolean)
      .slice(0, 4);
    const materialText = materials.length ? `, utilizando ${materials.join(", ")}` : "";
    const deadline = form.elements.deadline.value.trim();
    const deadlineText = deadline ? ` O prazo previsto para execução/entrega é de ${deadline}.` : "";
    const clientText = client ? ` para ${client.name}` : "";
    const requestText = brief.trim() ? ` Escopo solicitado: ${sentence(brief)}.` : "";
    return `Conforme solicitado, apresentamos proposta para execução de ${qty} ${title}${clientText}${materialText}.${requestText} O serviço contempla fabricação, preparação dos materiais, montagem e acabamento final, conforme medidas, acabamento e condições alinhadas previamente. A execução será realizada com atenção ao padrão de qualidade da EDJ Soluções em Manutenção.${deadlineText}`;
  }

  function buildPaymentTerms(form, brief = "") {
    const title = form.elements.title.value.trim() || "o serviço contratado";
    const validity = form.elements.validity.value.trim() || "5 dias";
    const bank = state.settings.bank ? `\nDados bancários: ${state.settings.bank}${state.settings.agency ? `, agência ${state.settings.agency}` : ""}${state.settings.account ? `, conta ${state.settings.account}` : ""}.` : "";
    const pix = state.settings.pix ? `\n${state.settings.pixType || "Chave PIX"}: ${state.settings.pix}.` : "";
    const card = state.settings.acceptsCreditCard === "true" ? `\nCartão de crédito: até ${state.settings.cardInstallments || "3"}x${parseNum(state.settings.cardFeePct) ? ` com ${parseNum(state.settings.cardFeePct)}% de juros` : " sem juros"}, conforme aprovação da operadora.` : "";
    const requestText = brief.trim() ? `Condição combinada: ${sentence(brief)}.` : `Condição sugerida para ${title}: 50% de entrada para início da produção e 50% na entrega/instalação.`;
    return `${requestText} Orçamento válido por ${validity}. O início da produção fica condicionado à confirmação do pagamento inicial, quando aplicável. Alterações de escopo, medidas ou acabamento podem gerar novo cálculo de valor.${bank}${pix}${card}`;
  }

  function openAiTextPopup(type, source) {
    const title = type === "payment" ? "condições de pagamento" : "descrição do orçamento";
    const targetText = source === "form" ? "o orçamento em edição" : "este orçamento";
    const popup = document.createElement("div");
    popup.className = "assistant-popup-backdrop";
    popup.innerHTML = `
      <form class="assistant-popup" id="assistantPromptForm">
        <div class="assistant-popup-head">
          <div>
            <p class="eyebrow">Assistente de texto com IA</p>
            <h2>Escreva do seu jeito</h2>
            <p>Digite abaixo o que precisa aparecer em ${title}. O sistema vai deixar o texto profissional para ${targetText}, pronto para PDF ou envio ao cliente.</p>
          </div>
          <button class="btn-ghost" type="button" data-close-assistant>Fechar</button>
        </div>
        <div class="assistant-popup-body">
          <label>O que você quer dizer?
            <textarea name="brief" required placeholder="Ex.: portão social de 2 metros, pintura preta, instalar na casa do cliente, entregar em 7 dias, pagamento 50% entrada e 50% na entrega"></textarea>
          </label>
          <div class="assistant-hint">Pode escrever simples. A IA organiza o texto com tom comercial, claro e profissional.</div>
        </div>
        <div class="assistant-popup-foot">
          <button class="btn-secondary" type="button" data-close-assistant>Cancelar</button>
          <button class="btn" type="submit">Gerar texto profissional</button>
        </div>
      </form>
    `;
    document.body.appendChild(popup);
    const close = () => popup.remove();
    popup.querySelectorAll("[data-close-assistant]").forEach((button) => button.addEventListener("click", close));
    popup.addEventListener("click", (event) => {
      if (event.target === popup) close();
    });
    popup.querySelector("#assistantPromptForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const brief = new FormData(event.currentTarget).get("brief") || "";
      close();
      if (source === "form") {
        applyQuoteAssistant(type, brief);
      } else {
        applySavedQuoteAssistant(type, brief);
      }
    });
    popup.querySelector("textarea").focus();
  }

  function applySavedQuoteAssistant(type, brief = "") {
    const q = getQuote(state.activeQuoteId);
    if (!q) return;
    if (type === "description") q.description = buildQuoteDescriptionFromQuote(q, brief);
    if (type === "payment") q.paymentTerms = buildPaymentTermsFromQuote(q, brief);
    q.updatedAt = today();
    save();
    render();
  }

  function buildQuoteDescriptionFromQuote(q, brief = "") {
    const client = getClient(q.clientId);
    const title = String(q.title || "serviço solicitado").trim();
    const qty = String(q.commercialQty || "1").trim();
    const materials = (q.materials || []).map((m) => m.name).filter(Boolean).slice(0, 4);
    const materialText = materials.length ? `, utilizando ${materials.join(", ")}` : "";
    const deadlineText = q.deadline ? ` O prazo previsto para execução/entrega é de ${q.deadline}.` : "";
    const clientText = client ? ` para ${client.name}` : "";
    const requestText = brief.trim() ? ` Escopo solicitado: ${sentence(brief)}.` : "";
    return `Conforme solicitado, apresentamos proposta para execução de ${qty} ${title}${clientText}${materialText}.${requestText} O serviço contempla fabricação, preparação dos materiais, montagem e acabamento final, conforme medidas, acabamento e condições alinhadas previamente. A execução será realizada com atenção ao padrão de qualidade da EDJ Soluções em Manutenção.${deadlineText}`;
  }

  function buildPaymentTermsFromQuote(q, brief = "") {
    const title = String(q.title || "o serviço contratado").trim();
    const validity = String(q.validity || "5 dias").trim();
    const bank = state.settings.bank ? `\nDados bancários: ${state.settings.bank}${state.settings.agency ? `, agência ${state.settings.agency}` : ""}${state.settings.account ? `, conta ${state.settings.account}` : ""}.` : "";
    const pix = state.settings.pix ? `\n${state.settings.pixType || "Chave PIX"}: ${state.settings.pix}.` : "";
    const card = state.settings.acceptsCreditCard === "true" ? `\nCartão de crédito: até ${state.settings.cardInstallments || "3"}x${parseNum(state.settings.cardFeePct) ? ` com ${parseNum(state.settings.cardFeePct)}% de juros` : " sem juros"}, conforme aprovação da operadora.` : "";
    const requestText = brief.trim() ? `Condição combinada: ${sentence(brief)}.` : `Condição sugerida para ${title}: 50% de entrada para início da produção e 50% na entrega/instalação.`;
    return `${requestText} Orçamento válido por ${validity}. O início da produção fica condicionado à confirmação do pagamento inicial, quando aplicável. Alterações de escopo, medidas ou acabamento podem gerar novo cálculo de valor.${bank}${pix}${card}`;
  }

  function sentence(value) {
    const text = String(value || "").trim().replace(/\s+/g, " ");
    if (!text) return "";
    return text.replace(/[.!?]+$/g, "");
  }

  function renderMaterialInputs(materials) {
    return (materials && materials.length ? materials : [{}]).map(renderMaterialInput).join("");
  }

  function renderMaterialInput(item = {}) {
    return `
      <div class="form-grid" data-material-row>
        <input type="hidden" name="materialId" value="${esc(item.materialId || "")}">
        <label>Material<input name="materialName" list="materialsList" value="${esc(item.name || "")}" placeholder="Metalon 30x30"></label>
        <label>Quantidade<input name="materialQty" value="${esc(item.qty || "")}" inputmode="decimal"></label>
        <label>Unidade<input name="materialUnit" value="${esc(item.unit || "un.")}" placeholder="barra, un., m, m²"></label>
        <label>Valor unitário<input name="materialUnitCost" value="${esc(item.unitCost || "")}" inputmode="decimal"></label>
        <button class="btn-ghost wide" type="button" data-remove-material-row>Remover material</button>
      </div>
    `;
  }

  function renderMaterialsDatalist() {
    return `<datalist id="materialsList">${state.materials.filter((m) => m.active !== false).map((m) => `<option value="${esc(m.name)}">${esc(m.unit)} - ${money(m.price)}</option>`).join("")}</datalist>`;
  }

  function fillMaterialFromCatalog(input) {
    const material = state.materials.find((m) => m.name.toLowerCase() === input.value.trim().toLowerCase() && m.active !== false);
    if (!material) return;
    const row = input.closest("[data-material-row]");
    row.querySelector("[name='materialId']").value = material.id;
    row.querySelector("[name='materialUnit']").value = material.unit || "un.";
    row.querySelector("[name='materialUnitCost']").value = String(material.price || "").replace(".", ",");
  }

  function snapshotForMaterial(row) {
    const material = getMaterial(row.querySelector("[name='materialId']").value);
    return {
      capturedAt: new Date().toISOString(),
      material: material ? {
        id: material.id,
        name: material.name,
        unit: material.unit,
        price: parseNum(material.price),
        active: material.active !== false,
      } : null,
      unitCost: parseNum(row.querySelector("[name='materialUnitCost']").value),
      unit: row.querySelector("[name='materialUnit']").value,
    };
  }

  function handleStatusSideEffects(q) {
    if (q.status === "cancelado") {
      const project = state.projects.find((p) => p.quoteId === q.id);
      if (project) project.status = "cancelado";
      state.receivables
        .filter((r) => r.quoteId === q.id && r.status !== "recebido")
        .forEach((r) => r.status = "cancelado");
      return;
    }

    if (["aprovado", "aguardando_pagamento", "concluido", "em_andamento"].includes(q.status)) {
      const calc = calcQuote(q);
      const project = createProjectFromQuote(q);
      project.status = q.status === "concluido" ? "concluido" : "em_andamento";
      const receivable = state.receivables.find((r) => r.quoteId === q.id && r.status !== "recebido");
      if (receivable) {
        Object.assign(receivable, {
          clientId: q.clientId,
          projectId: project.id,
          description: `${displayQuoteCode(q.code)} - ${q.title}`,
          amount: calc.total,
          status: receivable.status === "cancelado" ? "previsto" : receivable.status,
        });
      } else if (!q.receivableGenerated || !state.receivables.some((r) => r.quoteId === q.id)) {
        state.receivables.push({
          id: uid(),
          clientId: q.clientId,
          quoteId: q.id,
          projectId: project.id,
          description: `${displayQuoteCode(q.code)} - ${q.title}`,
          amount: calc.total,
          dueDate: addDays(today(), 15),
          status: "previsto",
          createdAt: today(),
        });
      }
      q.receivableGenerated = true;
    }
  }

  function createProjectFromQuote(q) {
    let project = state.projects.find((p) => p.quoteId === q.id);
    if (!project) {
      project = { id: uid(), quoteId: q.id, clientId: q.clientId, title: q.title, status: q.status === "concluido" ? "concluido" : "em_andamento", createdAt: today() };
      state.projects.push(project);
    }
    return project;
  }

  function proposalHtmlLegacy(q, printMode) {
    const client = getClient(q.clientId) || {};
    const calc = calcQuote(q);
    const bankLines = [
      state.settings.bank ? `Banco: ${state.settings.bank}` : "",
      state.settings.agency ? `Agência: ${state.settings.agency}` : "",
      state.settings.account ? `Conta: ${state.settings.account}` : "",
      state.settings.holder ? `Titular: ${state.settings.holder}` : "",
      state.settings.pix ? `${state.settings.pixType || "PIX"}: ${state.settings.pix}` : "",
      state.settings.acceptsCreditCard === "true" ? `Cartão de crédito: até ${state.settings.cardInstallments || "3"}x${parseNum(state.settings.cardFeePct) ? ` com ${parseNum(state.settings.cardFeePct)}% de juros` : " sem juros"}` : "",
    ].filter(Boolean);
    return `
      <div class="${printMode ? "print-page" : ""}">
        <header class="paper-head">
          <img src="./assets/logo-edj.png" alt="EDJ" />
          <div>
            <strong>${esc(state.settings.companyName)}</strong>
            <span>CNPJ: ${esc(state.settings.document || "")}</span>
            <span>${esc(state.settings.address || "")}</span>
            <span>${esc(state.settings.phone || "")}</span>
          </div>
          <time>${brDate(today())}</time>
        </header>
        <section class="paper-title">
          <h2>Proposta comercial ${esc(displayQuoteCode(q.code))}</h2>
          <strong>${esc(q.title || "")}</strong>
        </section>
        <section class="paper-section">
          <strong>Cliente:</strong> ${esc(client.name || "")}
          ${client.document ? `<br><strong>CPF/CNPJ:</strong> ${esc(client.document)}` : ""}
        </section>
        <section class="paper-section">
          <div class="paper-table">
            <strong>Descrição</strong><strong>Qtd.</strong><strong>Valor</strong>
            <span>${esc(q.description || q.title || "")}</span><span>${esc(q.commercialQty || "1")}</span><span>${money(calc.total)}</span>
          </div>
        </section>
        <section class="paper-total"><span>Total</span><strong>${money(calc.total)}</strong></section>
        <section class="paper-section"><strong>Validade:</strong> ${esc(q.validity || "")}<br><strong>Prazo:</strong> ${esc(q.deadline || "")}</section>
        <section class="paper-section"><strong>Condições de pagamento</strong><br>${esc(q.paymentTerms || state.settings.defaultTerms)}${bankLines.length ? `<br><br>${bankLines.map(esc).join("<br>")}` : ""}</section>
      </div>
    `;
  }

  function proposalHtml(q, printMode) {
    const client = getClient(q.clientId) || {};
    const calc = calcQuote(q);
    const quoteCode = displayQuoteCode(q.code);
    const quoteDate = brDate(q.createdAt || today());
    const city = cityFromAddress(state.settings.address);
    const qty = parseNum(q.commercialQty) || 1;
    const unitPrice = calc.total / qty;
    const companyName = state.settings.companyName || "EDJ Soluções em Manutenção";
    const companyDocument = state.settings.document || "";
    const companyOwner = state.settings.holder || "";
    const serviceTitle = q.title || "Serviço solicitado";
    const serviceDescription = q.description || q.title || "Serviço conforme solicitação do cliente.";
    const paymentText = q.paymentTerms || state.settings.defaultTerms || "Condições de pagamento a combinar.";
    const paymentMethods = state.settings.acceptsCreditCard === "true"
      ? "Boleto, transferência bancária, dinheiro, cartão de crédito, cartão de débito ou pix."
      : "Boleto, transferência bancária, dinheiro, cartão de débito ou pix.";
    const pixValue = state.settings.pix || companyDocument;
    const bankLines = [
      state.settings.bank ? `Banco: ${state.settings.bank}` : "",
      state.settings.agency ? `Agência: ${state.settings.agency}` : "",
      state.settings.account ? `Conta: ${state.settings.account}` : "",
      state.settings.holder ? `Titular: ${state.settings.holder}` : "",
    ].filter(Boolean);

    return `
      <div class="proposal-page ${printMode ? "print-page" : ""}">
        <header class="proposal-header">
          <img class="proposal-logo" src="./assets/logo-edj.png" alt="EDJ" />
          <div class="proposal-company">
            <h1>${esc(companyName)}</h1>
            ${companyOwner && companyOwner !== companyName ? `<p>${esc(companyOwner)}</p>` : ""}
            ${companyDocument ? `<p>CNPJ: ${esc(companyDocument)}</p>` : ""}
            ${state.settings.address ? `<p>${esc(state.settings.address)}</p>` : ""}
          </div>
          <div class="proposal-contact">
            ${state.settings.email ? `<p><span>E-mail</span>${esc(state.settings.email)}</p>` : ""}
            ${state.settings.phone ? `<p><span>Telefone</span>${esc(state.settings.phone)}</p>` : ""}
            ${pixValue ? `<p><span>PIX</span>${esc(pixValue)}</p>` : ""}
            <time>${esc(quoteDate)}</time>
          </div>
        </header>

        <div class="proposal-social">edj_solucoes</div>

        <section class="proposal-title-block">
          <h2>Proposta comercial ${esc(quoteCode)}</h2>
          <p>${esc(serviceTitle.toUpperCase())}</p>
        </section>

        <p class="proposal-client"><strong>Cliente:</strong> ${esc(client.name || "Cliente não informado")}${client.document ? ` <span>CPF/CNPJ: ${esc(client.document)}</span>` : ""}</p>

        <section class="proposal-section">
          <h3>Informações básicas</h3>
          <div class="proposal-info-grid">
            <div>
              <strong>Validade do orçamento</strong>
              <span>${esc(q.validity || "Conforme negociação")}</span>
            </div>
            <div>
              <strong>Prazo de execução</strong>
              <span>${esc(q.deadline || "A combinar")}</span>
            </div>
          </div>
        </section>

        <section class="proposal-section proposal-services">
          <h3>Serviços</h3>
          <table class="proposal-table">
            <thead>
              <tr>
                <th>Descrição</th>
                <th>Unidade</th>
                <th>Preço unitário</th>
                <th>Qtd.</th>
                <th>Preço</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <strong>${esc(serviceTitle.toUpperCase())}</strong>
                  <p>${textBlock(serviceDescription)}</p>
                </td>
                <td>un.</td>
                <td>${money(unitPrice)}</td>
                <td>${esc(q.commercialQty || "1")}</td>
                <td>${money(calc.total)}</td>
              </tr>
            </tbody>
          </table>
          <div class="proposal-total-row"><span>Total</span><strong>${money(calc.total)}</strong></div>
        </section>

        <section class="proposal-section proposal-payment">
          <h3>Pagamento</h3>
          <div class="proposal-payment-grid">
            <div>
              <strong>Meios de pagamento</strong>
              <p>${esc(paymentMethods)}</p>
              ${paymentText ? `<strong>Condições de pagamento</strong><p>${textBlock(paymentText)}</p>` : ""}
            </div>
            ${pixValue ? `<div><strong>PIX</strong><p>${esc(pixValue)}</p></div>` : ""}
            ${bankLines.length ? `<div><strong>Dados bancários</strong><p>${bankLines.map(esc).join("<br>")}</p></div>` : ""}
          </div>
        </section>

        <footer class="proposal-signatures">
          <p>${esc(city)}, ${esc(quoteDate)}</p>
          <div>
            <span>
              <strong>${esc(companyName.toUpperCase())}</strong>
              ${companyOwner ? `<em>${esc(companyOwner)}</em>` : ""}
            </span>
            <span>
              <strong>${esc(String(client.name || "Cliente").toUpperCase())}</strong>
            </span>
          </div>
        </footer>

        <small class="proposal-page-number">Página 1/1</small>
      </div>
    `;
  }

  function previewPdf(quoteId) {
    const q = getQuote(quoteId);
    openModal(`
      <div class="modal">
        <div class="modal-head"><h2>Prévia da proposta</h2><button class="btn-ghost" type="button" data-close-modal>Fechar</button></div>
        <div class="modal-body"><div class="paper">${proposalHtml(q, false)}</div></div>
        <div class="modal-foot"><button class="btn-secondary" type="button" data-close-modal>Voltar e editar</button><button class="btn" type="button" data-print-quote="${quoteId}">Baixar PDF</button></div>
      </div>
    `);
    document.querySelector("[data-print-quote]").addEventListener("click", () => {
      printArea.innerHTML = proposalHtml(q, true);
      window.print();
    });
  }

  function openExpenseModal(expenseId) {
    const expense = expenseId ? state.expenses.find((e) => e.id === expenseId) || {} : {};
    const defaultProjectId = expense.projectId || (state.route === "projectDetail" ? state.activeProjectId : "");
    openModal(`
      <form class="modal small" id="expenseForm">
        <div class="modal-head"><h2>${expenseId ? "Editar despesa" : "Nova despesa"}</h2><button class="btn-ghost" type="button" data-close-modal>Fechar</button></div>
        <div class="modal-body form-grid">
          <label>Categoria<input name="category" required placeholder="Aluguel, combustível, fornecedor" value="${esc(expense.category || "")}"></label>
          <label>Tipo<select name="fixed"><option value="false" ${!expense.fixed ? "selected" : ""}>Custo/Despesa variável</option><option value="true" ${expense.fixed ? "selected" : ""}>Despesa fixa</option></select></label>
          <label class="wide">Descrição<input name="description" required value="${esc(expense.description || "")}"></label>
          <label>Valor<input name="amount" required inputmode="decimal" value="${esc(expense.amount || "")}"></label>
          <label>Data<input name="date" type="date" value="${esc(expense.date || expense.dueDate || today())}"></label>
          <label class="wide">Projeto opcional<select name="projectId"><option value="">Sem vínculo</option>${state.projects.map((p) => `<option value="${p.id}" ${defaultProjectId === p.id ? "selected" : ""}>${esc(p.title)}</option>`).join("")}</select></label>
        </div>
        <div class="modal-foot"><button class="btn-secondary" type="button" data-close-modal>Cancelar</button><button class="btn" type="submit">Salvar</button></div>
      </form>
    `);
    document.getElementById("expenseForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const data = serializeForm(event.currentTarget);
      const payload = { ...data, fixed: data.fixed === "true", amount: parseNum(data.amount) };
      if (expenseId) Object.assign(expense, payload);
      else state.expenses.push({ id: uid(), ...payload, createdAt: today() });
      save();
      closeModal();
      render();
    });
  }

  function openReceivableModal(receivableId) {
    const item = state.receivables.find((r) => r.id === receivableId);
    if (!item) return;
    openModal(`
      <form class="modal small" id="receivableForm">
        <div class="modal-head"><h2>Editar conta a receber</h2><button class="btn-ghost" type="button" data-close-modal>Fechar</button></div>
        <div class="modal-body form-grid">
          <label class="wide">Descrição<input name="description" required value="${esc(item.description || "")}"></label>
          <label>Valor<input name="amount" inputmode="decimal" value="${esc(item.amount || "")}"></label>
          <label>Vencimento<input name="dueDate" type="date" value="${esc(item.dueDate || today())}"></label>
          <label>Status<select name="status">
            <option value="previsto" ${item.status === "previsto" ? "selected" : ""}>Previsto</option>
            <option value="recebido" ${item.status === "recebido" ? "selected" : ""}>Recebido</option>
            <option value="cancelado" ${item.status === "cancelado" ? "selected" : ""}>Cancelado</option>
          </select></label>
          <label>Recebido em<input name="receivedAt" type="date" value="${esc(item.receivedAt || "")}"></label>
        </div>
        <div class="modal-foot"><button class="btn-secondary" type="button" data-close-modal>Cancelar</button><button class="btn" type="submit">Salvar</button></div>
      </form>
    `);
    document.getElementById("receivableForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const data = serializeForm(event.currentTarget);
      Object.assign(item, {
        description: data.description,
        amount: parseNum(data.amount),
        dueDate: data.dueDate,
        status: data.status,
        receivedAt: data.status === "recebido" ? (data.receivedAt || today()) : "",
      });
      save();
      closeModal();
      render();
    });
  }

  function openEmployeeModal(employeeId) {
    const employee = employeeId ? state.employees.find((e) => e.id === employeeId) || {} : {};
    openModal(`
      <form class="modal small" id="employeeForm">
        <div class="modal-head"><h2>${employeeId ? "Editar colaborador" : "Novo colaborador"}</h2><button class="btn-ghost" type="button" data-close-modal>Fechar</button></div>
        <div class="modal-body form-grid">
          <label class="wide">Nome<input name="name" required value="${esc(employee.name || "")}"></label>
          <label>Função<input name="role" required value="${esc(employee.role || "")}"></label>
          <label>Valor diária<input name="dailyRate" inputmode="decimal" value="${esc(employee.dailyRate || "")}"></label>
          <label>Status<select name="active"><option value="true" ${employee.active !== false ? "selected" : ""}>Ativo</option><option value="false" ${employee.active === false ? "selected" : ""}>Inativo</option></select></label>
        </div>
        <div class="modal-foot"><button class="btn-secondary" type="button" data-close-modal>Cancelar</button><button class="btn" type="submit">Salvar</button></div>
      </form>
    `);
    document.getElementById("employeeForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const data = serializeForm(event.currentTarget);
      const payload = { ...data, dailyRate: parseNum(data.dailyRate), active: data.active === "true" };
      if (employeeId) Object.assign(employee, payload);
      else state.employees.push({ id: uid(), ...payload, createdAt: today() });
      save();
      closeModal();
      render();
    });
  }

  function openTimeModal() {
    if (!state.employees.length) {
      openModal(`
        <div class="modal small">
          <div class="modal-head"><h2>Lançar ponto</h2><button class="btn-ghost" type="button" data-close-modal>Fechar</button></div>
          <div class="modal-body">${empty("Cadastre um colaborador primeiro.", "O ponto precisa estar vinculado a um colaborador para calcular horas e exportar relatório.")}</div>
          <div class="modal-foot"><button class="btn-secondary" type="button" data-close-modal>Cancelar</button><button class="btn" type="button" data-action="new-employee">Novo colaborador</button></div>
        </div>
      `);
      return;
    }
    const workday = state.costSettings.workday || {};
    openModal(`
      <form class="modal small" id="timeForm">
        <div class="modal-head"><h2>Lançar ponto</h2><button class="btn-ghost" type="button" data-close-modal>Fechar</button></div>
        <div class="modal-body form-grid">
          <label class="wide">Colaborador<select name="employeeId" required>${state.employees.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join("")}</select></label>
          <label>Data<input name="date" type="date" value="${today()}" required></label>
          <label>Projeto<select name="projectId"><option value="">Sem vínculo</option>${state.projects.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join("")}</select></label>
          <label>Entrada<input name="in1" type="time" value="${esc(workday.morningStart || "07:00")}"></label>
          <label>Saída almoço<input name="out1" type="time" value="${esc(workday.morningEnd || "11:30")}"></label>
          <label>Retorno almoço<input name="in2" type="time" value="${esc(workday.afternoonStart || "13:00")}"></label>
          <label>Saída final<input name="out2" type="time" value="${esc(workday.afternoonEnd || "17:00")}"></label>
          <label class="wide">Observação<input name="notes"></label>
        </div>
        <div class="modal-foot"><button class="btn-secondary" type="button" data-close-modal>Cancelar</button><button class="btn" type="submit">Salvar</button></div>
      </form>
    `);
    document.getElementById("timeForm").addEventListener("submit", (event) => {
      event.preventDefault();
      state.timeEntries.push({ id: uid(), ...serializeForm(event.currentTarget), createdAt: today() });
      save();
      closeModal();
      render();
    });
  }

  function openMaterialModal(materialId) {
    const material = materialId ? getMaterial(materialId) || {} : {};
    openModal(`
      <form class="modal small" id="materialForm">
        <div class="modal-head"><h2>${materialId ? "Editar material" : "Novo material"}</h2><button class="btn-ghost" type="button" data-close-modal>Fechar</button></div>
        <div class="modal-body form-grid">
          <label class="wide">Material<input name="name" required placeholder="Metalon 30x30" value="${esc(material.name || "")}"></label>
          <label>Unidade<input name="unit" value="${esc(material.unit || "un.")}"></label>
          <label>Preço atual<input name="price" inputmode="decimal" value="${esc(material.price || "")}"></label>
          <label>Status<select name="active"><option value="true" ${material.active !== false ? "selected" : ""}>Ativo</option><option value="false" ${material.active === false ? "selected" : ""}>Inativo</option></select></label>
        </div>
        <div class="modal-foot"><button class="btn-secondary" type="button" data-close-modal>Cancelar</button><button class="btn" type="submit">Salvar</button></div>
      </form>
    `);
    document.getElementById("materialForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const data = serializeForm(event.currentTarget);
      const payload = { ...data, price: parseNum(data.price), active: data.active === "true" };
      if (materialId) Object.assign(material, payload);
      else state.materials.push({ id: uid(), ...payload });
      save();
      closeModal();
      render();
    });
  }

  function openRoleModal(roleId) {
    const role = roleId ? state.costSettings.laborRoles.find((r) => r.id === roleId) || {} : {};
    openModal(`
      <form class="modal small" id="roleForm">
        <div class="modal-head"><h2>${roleId ? "Editar função" : "Adicionar função"}</h2><button class="btn-ghost" type="button" data-close-modal>Fechar</button></div>
        <div class="modal-body form-grid">
          <label>Função<input name="role" required value="${esc(role.role || "")}"></label>
          <label>Valor diária<input name="dailyRate" inputmode="decimal" value="${esc(role.dailyRate || "")}"></label>
        </div>
        <div class="modal-foot"><button class="btn-secondary" type="button" data-close-modal>Cancelar</button><button class="btn" type="submit">Salvar</button></div>
      </form>
    `);
    document.getElementById("roleForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const data = serializeForm(event.currentTarget);
      if (roleId) Object.assign(role, { role: data.role, dailyRate: parseNum(data.dailyRate) });
      else state.costSettings.laborRoles.push({ id: uid(), role: data.role, dailyRate: parseNum(data.dailyRate) });
      save();
      closeModal();
      render();
    });
  }

  function openCostSettingsModal() {
    const c = state.costSettings;
    const w = c.workday || {};
    openModal(`
      <form class="modal small" id="costSettingsForm">
        <div class="modal-head"><h2>Parâmetros de custo</h2><button class="btn-ghost" type="button" data-close-modal>Fechar</button></div>
        <div class="modal-body form-grid">
          <label>Margem padrão (%)<input name="defaultMarginPct" inputmode="decimal" value="${esc(c.defaultMarginPct)}"></label>
          <label>Pintura eletrostática (R$/m²)<input name="paintPriceM2" inputmode="decimal" value="${esc(c.paintPriceM2)}"></label>
          <label>Entrada manhã<input name="morningStart" type="time" value="${esc(w.morningStart || "07:00")}"></label>
          <label>Saída almoço<input name="morningEnd" type="time" value="${esc(w.morningEnd || "11:30")}"></label>
          <label>Retorno almoço<input name="afternoonStart" type="time" value="${esc(w.afternoonStart || "13:00")}"></label>
          <label>Saída padrão<input name="afternoonEnd" type="time" value="${esc(w.afternoonEnd || "17:00")}"></label>
          <label>Extra dias úteis (%)<input name="weekdayExtraPct" inputmode="decimal" value="${esc(w.weekdayExtraPct || 50)}"></label>
          <label>Sábado (%)<input name="saturdayExtraPct" inputmode="decimal" value="${esc(w.saturdayExtraPct || 50)}"></label>
          <label>Domingo/Feriado (%)<input name="sundayHolidayExtraPct" inputmode="decimal" value="${esc(w.sundayHolidayExtraPct || 100)}"></label>
        </div>
        <div class="modal-foot"><button class="btn-secondary" type="button" data-close-modal>Cancelar</button><button class="btn" type="submit">Salvar</button></div>
      </form>
    `);
    document.getElementById("costSettingsForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const data = serializeForm(event.currentTarget);
      state.costSettings.defaultMarginPct = parseNum(data.defaultMarginPct);
      state.costSettings.paintPriceM2 = parseNum(data.paintPriceM2);
      state.costSettings.workday = {
        morningStart: data.morningStart || "07:00",
        morningEnd: data.morningEnd || "11:30",
        afternoonStart: data.afternoonStart || "13:00",
        afternoonEnd: data.afternoonEnd || "17:00",
        weekdayExtraPct: parseNum(data.weekdayExtraPct) || 50,
        saturdayExtraPct: parseNum(data.saturdayExtraPct) || 50,
        sundayHolidayExtraPct: parseNum(data.sundayHolidayExtraPct) || 100,
      };
      save();
      closeModal();
      render();
    });
  }

  function openSettingsModal() {
    const s = state.settings;
    openModal(`
      <form class="modal" id="settingsForm">
        <div class="modal-head"><h2>Dados da empresa</h2><button class="btn-ghost" type="button" data-close-modal>Fechar</button></div>
        <div class="modal-body form-grid">
          <label>Empresa<input name="companyName" value="${esc(s.companyName)}"></label>
          <label>CNPJ<input name="document" value="${esc(s.document)}"></label>
          <label>Email<input name="email" value="${esc(s.email)}"></label>
          <label>Telefone<input name="phone" value="${esc(s.phone)}"></label>
          <label class="wide">Endereço<input name="address" value="${esc(s.address)}"></label>
          <label>Banco<input name="bank" value="${esc(s.bank)}"></label>
          <label>Agência<input name="agency" value="${esc(s.agency)}"></label>
          <label>Conta<input name="account" value="${esc(s.account)}"></label>
          <label>Titular<input name="holder" value="${esc(s.holder)}"></label>
          <label>Tipo da chave PIX<input name="pixType" value="${esc(s.pixType || "Chave PIX")}" placeholder="CPF, CNPJ, telefone, e-mail ou aleatória"></label>
          <label>PIX<input name="pix" value="${esc(s.pix)}"></label>
          <label>Aceita cartão de crédito<select name="acceptsCreditCard"><option value="false" ${s.acceptsCreditCard !== "true" ? "selected" : ""}>Não</option><option value="true" ${s.acceptsCreditCard === "true" ? "selected" : ""}>Sim</option></select></label>
          <label>Parcelas no cartão<input name="cardInstallments" inputmode="decimal" value="${esc(s.cardInstallments || "3")}"></label>
          <label>Juros do cartão (%)<input name="cardFeePct" inputmode="decimal" value="${esc(s.cardFeePct || "0")}"></label>
          <div class="wide payment-suggestions">
            <button type="button" class="chip-button" data-payment-template="50% de entrada para início da produção e 50% na entrega/instalação.">50% entrada + 50% entrega</button>
            <button type="button" class="chip-button" data-payment-template="Pagamento à vista com 5% de desconto após aprovação do orçamento.">À vista com desconto</button>
            <button type="button" class="chip-button" data-payment-template="Pagamento no cartão de crédito conforme parcelas combinadas, sujeito às taxas da operadora.">Cartão de crédito</button>
          </div>
          <label class="wide">Termos padrão<textarea name="defaultTerms">${esc(s.defaultTerms)}</textarea></label>
        </div>
        <div class="modal-foot"><button class="btn-secondary" type="button" data-close-modal>Cancelar</button><button class="btn" type="submit">Salvar</button></div>
      </form>
    `);
    document.getElementById("settingsForm").addEventListener("submit", (event) => {
      event.preventDefault();
      Object.assign(state.settings, serializeForm(event.currentTarget));
      save();
      closeModal();
      render();
    });
    document.querySelectorAll("[data-payment-template]").forEach((button) => {
      button.addEventListener("click", () => {
        const field = document.querySelector("#settingsForm [name='defaultTerms']");
        if (field) field.value = button.dataset.paymentTemplate;
      });
    });
  }

  function openUserModal(userId) {
    const user = userId ? (state.users || []).find((u) => u.id === userId) || {} : {};
    openModal(`
      <form class="modal small" id="userForm">
        <div class="modal-head"><h2>${userId ? "Editar usuário" : "Novo usuário"}</h2><button class="btn-ghost" type="button" data-close-modal>Fechar</button></div>
        <div class="modal-body form-grid">
          <label class="wide">Nome<input name="name" required value="${esc(user.name || "")}"></label>
          <label class="wide">E-mail<input name="email" type="email" required value="${esc(user.email || "")}"></label>
          <label>Perfil<select name="role">
            <option value="admin" ${user.role === "admin" ? "selected" : ""}>Administrador</option>
            <option value="operator" ${user.role === "operator" ? "selected" : ""}>Operacional</option>
            <option value="financial" ${user.role === "financial" ? "selected" : ""}>Financeiro</option>
          </select></label>
          <label>Status<select name="active"><option value="true" ${user.active !== false ? "selected" : ""}>Ativo</option><option value="false" ${user.active === false ? "selected" : ""}>Inativo</option></select></label>
        </div>
        <div class="modal-foot"><button class="btn-secondary" type="button" data-close-modal>Cancelar</button><button class="btn" type="submit">Salvar</button></div>
      </form>
    `);
    document.getElementById("userForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const data = serializeForm(event.currentTarget);
      const payload = { ...data, active: data.active === "true" };
      state.users = state.users || [];
      if (userId) Object.assign(user, payload);
      else state.users.push({ id: uid(), ...payload });
      save();
      closeModal();
      render();
    });
  }

  function calcTime(entry) {
    const date = new Date(entry.date + "T12:00:00");
    const day = date.getDay();
    const holiday = state.holidays.includes(entry.date);
    const intervals = [
      [toMin(entry.in1), toMin(entry.out1)],
      [toMin(entry.in2), toMin(entry.out2)],
    ].filter(([a, b]) => b > a);
    const total = intervals.reduce((s, [a, b]) => s + (b - a), 0) / 60;
    if (holiday || day === 0) return { normal: 0, extra50: 0, extra100: total };
    if (day === 6) return { normal: 0, extra50: total, extra100: 0 };
    const workday = state.costSettings.workday || {};
    const normalWindows = [
      [toMin(workday.morningStart || "07:00"), toMin(workday.morningEnd || "11:30")],
      [toMin(workday.afternoonStart || "13:00"), toMin(workday.afternoonEnd || "17:00")],
    ];
    let normalMin = 0;
    intervals.forEach(([a, b]) => {
      normalWindows.forEach(([s, e]) => {
        normalMin += Math.max(0, Math.min(b, e) - Math.max(a, s));
      });
    });
    const normal = normalMin / 60;
    return { normal, extra50: Math.max(0, total - normal), extra100: 0 };
  }

  function toMin(time) {
    const [h, m] = String(time || "00:00").split(":").map(Number);
    return h * 60 + m;
  }

  function formatHours(value) {
    return `${Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}h`;
  }

  function receive(id) {
    const item = state.receivables.find((r) => r.id === id);
    if (item) {
      item.status = "recebido";
      item.receivedAt = today();
      save();
      render();
    }
  }

  function removeById(collection, id) {
    const index = collection.findIndex((item) => item.id === id);
    if (index >= 0) collection.splice(index, 1);
  }

  function deleteClient(id) {
    const hasHistory = state.quotes.some((q) => q.clientId === id) || state.projects.some((p) => p.clientId === id);
    if (hasHistory) {
      window.alert("Este cliente possui orçamentos/projetos vinculados. Mantenha o cadastro para preservar o histórico.");
      return;
    }
    if (!window.confirm("Excluir este cliente?")) return;
    removeById(state.clients, id);
    save();
    render();
  }

  function deleteQuote(id) {
    if (!window.confirm("Excluir este orçamento e seus vínculos financeiros/projeto?")) return;
    const projectIds = state.projects.filter((p) => p.quoteId === id).map((p) => p.id);
    state.expenses.forEach((e) => {
      if (projectIds.includes(e.projectId)) e.projectId = "";
    });
    state.projects = state.projects.filter((p) => p.quoteId !== id);
    state.receivables = state.receivables.filter((r) => r.quoteId !== id);
    state.quotes = state.quotes.filter((q) => q.id !== id);
    if (state.activeQuoteId === id) state.activeQuoteId = null;
    save();
    routeTo("quotes");
  }

  function deleteMaterial(id) {
    const used = state.quotes.some((q) => (q.materials || []).some((m) => m.materialId === id));
    if (used) {
      const material = getMaterial(id);
      if (material && window.confirm("Este material já foi usado em orçamento. Para preservar histórico, deseja apenas inativar?")) {
        material.active = false;
        save();
        render();
      }
      return;
    }
    if (!window.confirm("Excluir este material?")) return;
    state.materials = state.materials.filter((m) => m.id !== id);
    save();
    render();
  }

  function deleteRole(id) {
    if (!window.confirm("Excluir esta função da base de mão de obra?")) return;
    state.costSettings.laborRoles = state.costSettings.laborRoles.filter((r) => r.id !== id);
    save();
    render();
  }

  function deleteEmployee(id) {
    const employee = state.employees.find((e) => e.id === id);
    const hasTime = state.timeEntries.some((entry) => entry.employeeId === id);
    if (hasTime) {
      if (employee && window.confirm("Este colaborador possui ponto lançado. Para preservar o relatório, deseja apenas inativar?")) {
        employee.active = false;
        save();
        render();
      }
      return;
    }
    if (!window.confirm("Excluir este colaborador?")) return;
    state.employees = state.employees.filter((e) => e.id !== id);
    save();
    render();
  }

  function deleteSimple(collectionName, id, label) {
    if (!window.confirm(`Excluir ${label}?`)) return;
    state[collectionName] = state[collectionName].filter((item) => item.id !== id);
    save();
    render();
  }

  function exportCsv(filename, rows) {
    const headers = Object.keys(rows[0] || { vazio: "" });
    const csv = [headers.join(";")].concat(rows.map((row) => headers.map((h) => `"${String(row[h] ?? "").replaceAll('"', '""')}"`).join(";"))).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function exportTime() {
    const rows = state.timeEntries.map((entry) => {
      const employee = state.employees.find((e) => e.id === entry.employeeId);
      const project = getProject(entry.projectId);
      const calc = calcTime(entry);
      return {
        colaborador: employee ? employee.name : "",
        data: brDate(entry.date),
        entrada: entry.in1,
        saida_almoco: entry.out1,
        retorno_almoco: entry.in2,
        saida_final: entry.out2,
        horas_normais: calc.normal.toFixed(2),
        extra_50: calc.extra50.toFixed(2),
        extra_100: calc.extra100.toFixed(2),
        projeto: project ? project.title : "",
        observacao: entry.notes || "",
      };
    });
    exportCsv("relatorio-ponto-edj.csv", rows);
  }

  function previewTimeReport() {
    const rows = state.timeEntries.map((entry) => {
      const employee = state.employees.find((e) => e.id === entry.employeeId);
      const project = getProject(entry.projectId);
      const calc = calcTime(entry);
      return { entry, employee, project, calc };
    });
    const html = `
      <div class="print-page">
        <header class="paper-head">
          <img src="./assets/logo-edj.png" alt="EDJ" />
          <div>
            <strong>${esc(state.settings.companyName)}</strong>
            <span>Relatório de ponto</span>
            <span>${brDate(today())}</span>
          </div>
        </header>
        <section class="paper-title"><h2>Horas trabalhadas</h2><strong>${rows.length} lançamento(s)</strong></section>
        <section class="paper-section">
          <div class="paper-table six">
            <strong>Colaborador</strong><strong>Data</strong><strong>Normal</strong><strong>Extra 50%</strong><strong>Extra 100%</strong><strong>Obra</strong>
            ${rows.map(({ entry, employee, project, calc }) => `
              <span>${esc(employee ? employee.name : "")}</span>
              <span>${brDate(entry.date)}</span>
              <span>${formatHours(calc.normal)}</span>
              <span>${formatHours(calc.extra50)}</span>
              <span>${formatHours(calc.extra100)}</span>
              <span>${esc(project ? project.title : "")}</span>
            `).join("")}
          </div>
        </section>
      </div>
    `;
    openModal(`
      <div class="modal">
        <div class="modal-head"><h2>Prévia do relatório de ponto</h2><button class="btn-ghost" type="button" data-close-modal>Fechar</button></div>
        <div class="modal-body"><div class="paper">${html}</div></div>
        <div class="modal-foot"><button class="btn-secondary" type="button" data-close-modal>Voltar</button><button class="btn" type="button" data-print-time>Baixar PDF</button></div>
      </div>
    `);
    document.querySelector("[data-print-time]").addEventListener("click", () => {
      printArea.innerHTML = html;
      window.print();
    });
  }

  function exportReceivables() {
    const rows = state.receivables.map((r) => {
      const c = getClient(r.clientId);
      return { cliente: c ? c.name : "", descricao: r.description, vencimento: brDate(r.dueDate), status: r.status, valor: r.amount };
    });
    exportCsv("contas-a-receber-edj.csv", rows);
  }

  function parseCsv(text) {
    const firstLine = String(text || "").split(/\r?\n/)[0] || "";
    const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : ",";
    const rows = [];
    let row = [], cell = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i], next = text[i + 1];
      if (ch === '"' && quoted && next === '"') { cell += '"'; i++; continue; }
      if (ch === '"') { quoted = !quoted; continue; }
      if (ch === delimiter && !quoted) { row.push(cell); cell = ""; continue; }
      if ((ch === "\n" || ch === "\r") && !quoted) {
        if (ch === "\r" && next === "\n") i++;
        row.push(cell); cell = "";
        if (row.some((v) => v !== "")) rows.push(row);
        row = [];
        continue;
      }
      cell += ch;
    }
    row.push(cell);
    if (row.some((v) => v !== "")) rows.push(row);
    const headers = (rows.shift() || []).map((h) => h.replace(/^\uFEFF/, ""));
    return rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] || ""])));
  }

  function handleImport(type, file) {
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCsv(String(reader.result || ""));
      if (type === "clients") {
        rows.forEach((r) => {
          if (!state.clients.some((c) => c.legacyId === r.id) && r.name) {
            state.clients.push({ id: uid(), legacyId: r.id, name: r.name, document: r.cnpj || r.cpf || "", phone: r.phones || "", email: r.email || "", address: [r.street, r.number || r.streetNumber, r.district, r.city, r.state].filter(Boolean).join(", "), createdAt: today() });
          }
        });
      }
      if (type === "jobs") {
        rows.filter((r) => r.id).forEach((r) => {
          if (state.quotes.some((q) => q.legacyId === r.id)) return;
          let client = state.clients.find((c) => c.legacyId === r.clientId) || state.clients.find((c) => c.name === r.clientName);
          if (!client && r.clientName) {
            client = { id: uid(), legacyId: r.clientId, name: r.clientName, createdAt: today() };
            state.clients.push(client);
          }
          if (!client) return;
          const total = parseNum(r.totalPrice);
          state.quotes.push({ id: uid(), legacyId: r.id, clientId: client.id, code: `ORC-${r.jobYear || new Date().getFullYear()}-${String(r.jobNumber || state.quotes.length + 1).padStart(4, "0")}`, title: r.jobTitle || r["descriptions.description"] || "Pedido importado", description: r["descriptions.details"] || r.jobAdditionalInfo || "", commercialQty: r["descriptions.quantity"] || "1", status: mapLegacyStatus(r), createdAt: parseLegacyDate(r.jobDate) || today(), validity: "", deadline: "", paymentTerms: r.paymentConditions || "", marginPct: 0, materials: [], labor: [], extras: [{ id: uid(), label: "Valor importado", amount: total }], receivableGenerated: false });
        });
      }
      if (type === "receipts") {
        rows.forEach((r) => {
          if (state.receivables.some((x) => x.legacyId === r.id)) return;
          const client = state.clients.find((c) => c.legacyId === r.clienId) || state.clients.find((c) => c.name === r.client);
          const quote = state.quotes.find((q) => q.legacyId === r.jobId);
          state.receivables.push({ id: uid(), legacyId: r.id, clientId: client ? client.id : "", quoteId: quote ? quote.id : "", projectId: "", description: `Recebimento importado ${r.client || ""}`, amount: parseNum(r.value), dueDate: parseLegacyDate(r.date) || today(), receivedAt: parseLegacyDate(r.date) || today(), status: "recebido" });
        });
      }
      save();
      render();
    };
    reader.readAsText(file, "utf-8");
  }

  function mapLegacyStatus(row) {
    if (row.cancelReason) return "cancelado";
    if (row.completedAt) return "concluido";
    const type = String(row.jobType || "");
    if (type === "2") return "aguardando_aprovacao";
    if (type === "4") return "aguardando_pagamento";
    if (type === "5") return "em_andamento";
    return "pendente";
  }

  function parseLegacyDate(value) {
    const m = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
  }

  document.addEventListener("click", (event) => {
    const target = event.target.closest("button, a");
    if (!target) return;
    if (target.dataset.action === "new-quote-client") {
      openQuoteModal(null, target.dataset.clientId);
      return;
    }
    if (target.dataset.aiQuoteUpdate) {
      openAiTextPopup(target.dataset.aiQuoteUpdate, "quote");
      return;
    }
    if (target.dataset.clientId) {
      routeTo("clientDetail", { activeClientId: target.dataset.clientId });
      return;
    }
    if (target.dataset.projectId) {
      routeTo("projectDetail", { activeProjectId: target.dataset.projectId });
      return;
    }
    if (target.dataset.action === "edit-quote") {
      openQuoteModal(target.dataset.quoteId);
      return;
    }
    if (target.dataset.action === "preview-pdf") {
      previewPdf(target.dataset.quoteId);
      return;
    }
    if (target.dataset.action === "toggle-quote-status") {
      routeTo("quotes", { quotesStatusOpen: !state.quotesStatusOpen, activeStatus: null });
      return;
    }
    if (target.dataset.quoteId) {
      routeTo("quoteDetail", { activeQuoteId: target.dataset.quoteId, activeQuoteTab: "summary" });
      return;
    }
    if (target.dataset.quoteTab) {
      routeTo("quoteDetail", { activeQuoteId: state.activeQuoteId, activeQuoteTab: target.dataset.quoteTab });
      return;
    }
    if (target.dataset.statusFilter) {
      routeTo("quotes", { activeStatus: target.dataset.statusFilter, quotesStatusOpen: true });
      return;
    }
    if (target.dataset.clearStatus !== undefined) {
      routeTo("quotes", { activeStatus: null });
      return;
    }
    if (target.dataset.editClient) openClientModal(target.dataset.editClient);
    if (target.dataset.deleteClient) deleteClient(target.dataset.deleteClient);
    if (target.dataset.deleteQuote) deleteQuote(target.dataset.deleteQuote);
    if (target.dataset.editMaterial) openMaterialModal(target.dataset.editMaterial);
    if (target.dataset.deleteMaterial) deleteMaterial(target.dataset.deleteMaterial);
    if (target.dataset.deleteRole) deleteRole(target.dataset.deleteRole);
    if (target.dataset.editExpense) openExpenseModal(target.dataset.editExpense);
    if (target.dataset.deleteExpense) deleteSimple("expenses", target.dataset.deleteExpense, "esta despesa");
    if (target.dataset.editEmployee) openEmployeeModal(target.dataset.editEmployee);
    if (target.dataset.deleteEmployee) deleteEmployee(target.dataset.deleteEmployee);
    if (target.dataset.deleteTime) deleteSimple("timeEntries", target.dataset.deleteTime, "este lançamento de ponto");
    if (target.dataset.editReceivable) openReceivableModal(target.dataset.editReceivable);
    if (target.dataset.deleteReceivable) deleteSimple("receivables", target.dataset.deleteReceivable, "esta conta a receber");
    if (target.dataset.editUser) openUserModal(target.dataset.editUser);
    if (target.dataset.deleteUser) deleteSimple("users", target.dataset.deleteUser, "este usuário");
    if (target.dataset.removeMaterialRow !== undefined) {
      const row = target.closest("[data-material-row]");
      if (row && document.querySelectorAll("[data-material-row]").length > 1) row.remove();
      return;
    }
    if (target.dataset.receive) receive(target.dataset.receive);
    if (target.dataset.action === "new-client") openClientModal();
    if (target.dataset.action === "new-expense") openExpenseModal();
    if (target.dataset.action === "new-employee") openEmployeeModal();
    if (target.dataset.action === "new-time-entry") openTimeModal();
    if (target.dataset.action === "new-material") openMaterialModal();
    if (target.dataset.action === "new-role") openRoleModal();
    if (target.dataset.editRole) openRoleModal(target.dataset.editRole);
    if (target.dataset.action === "edit-cost-settings") openCostSettingsModal();
    if (target.dataset.action === "edit-settings") openSettingsModal();
    if (target.dataset.action === "new-user") openUserModal();
    if (target.dataset.action === "export-time") exportTime();
    if (target.dataset.action === "preview-time-report") previewTimeReport();
    if (target.dataset.action === "export-receivables") exportReceivables();
  });

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (target.dataset.statusChange) {
      const q = getQuote(target.dataset.statusChange);
      if (!q) return;
      q.status = target.value;
      handleStatusSideEffects(q);
      save();
      render();
    }
    if (target.dataset.projectStatusChange) {
      const project = getProject(target.dataset.projectStatusChange);
      if (!project) return;
      project.status = target.value;
      project.updatedAt = today();
      save();
      render();
    }
    if (target.dataset.financePeriod !== undefined) {
      state.financePeriod = target.value;
      save();
      render();
    }
    if (target.dataset.financeStart !== undefined) {
      state.financeStart = target.value;
      state.financePeriod = "custom";
      save();
      render();
    }
    if (target.dataset.financeEnd !== undefined) {
      state.financeEnd = target.value;
      state.financePeriod = "custom";
      save();
      render();
    }
    if (target.dataset.import && target.files && target.files[0]) {
      handleImport(target.dataset.import, target.files[0]);
    }
  });

  document.addEventListener("focusin", (event) => {
    const target = event.target;
    if (!target.matches || !target.matches("input[inputmode='decimal'], input[type='number']")) return;
    const value = String(target.value || "").trim();
    if (/^0([,.]0+)?$/.test(value)) target.value = "";
    else target.select();
  });

  boot();
})();
