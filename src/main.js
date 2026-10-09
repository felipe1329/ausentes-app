import JSZip from "jszip";
import { mergeImports, parseDate, parseJsonText, parseTxt } from "./parseTikTok.js";

const STORAGE_KEY = "ausentes-v1";
const PAGE_SIZE = 80;

const VIEWS = [
  ["following", "Siguiendo"],
  ["followers", "Seguidores"],
  ["mutual", "Mutuos"],
  ["not-back", "No te siguen"],
  ["not-followed", "Tú no sigues"],
  ["missing", "Ausentes"],
  ["cleaned", "Apartadas"],
];

const state = {
  owner: "",
  sourceName: "",
  following: [],
  followers: [],
  checks: {},
  cleaned: {},
  view: "following",
  query: "",
  sort: "date-desc",
  visible: PAGE_SIZE,
  running: false,
};

let connectedProfile = null;
let pollTimer = 0;

const els = {
  gate: document.querySelector("#gate"),
  account: document.querySelector("#account"),
  desk: document.querySelector("#desk"),
  connect: document.querySelector("#connect"),
  setup: document.querySelector("#setup"),
  redirectUri: document.querySelector("#redirect-uri"),
  displayName: document.querySelector("#display-name"),
  bio: document.querySelector("#bio"),
  avatar: document.querySelector("#avatar"),
  handle: document.querySelector("#handle"),
  metrics: document.querySelector("#metrics"),
  fetchList: document.querySelector("#fetch-list"),
  fetchListDesk: document.querySelector("#fetch-list-desk"),
  removeDeletedBtn: document.querySelector("#remove-deleted"),
  removeDeletedDesk: document.querySelector("#remove-deleted-desk"),
  importFile: document.querySelector("#import-file"),
  disconnect: document.querySelector("#disconnect"),
  disconnectDesk: document.querySelector("#disconnect-desk"),
  dataNote: document.querySelector("#data-note"),
  sessionChip: document.querySelector("#session-chip"),
  chipAvatar: document.querySelector("#chip-avatar"),
  chipName: document.querySelector("#chip-name"),
  resume: document.querySelector("#resume"),
  demo: document.querySelector("#demo"),
  status: document.querySelector("#status"),
  owner: document.querySelector("#owner-kicker"),
  title: document.querySelector("#desk-title"),
  stats: document.querySelector("#stats"),
  tabs: document.querySelector("#tabs"),
  rows: document.querySelector("#rows"),
  query: document.querySelector("#query"),
  more: document.querySelector("#more"),
  count: document.querySelector("#count-label"),
  verify: document.querySelector("#verify"),
  verifyVisible: document.querySelector("#verify-visible"),
  stop: document.querySelector("#stop"),
  replace: document.querySelector("#replace"),
  cleanMissing: document.querySelector("#clean-missing"),
  exportBtn: document.querySelector("#export"),
  sortDate: document.querySelector("#sort-date"),
  progress: document.querySelector("#progress"),
  progressFill: document.querySelector("#progress-fill"),
  progressLabel: document.querySelector("#progress-label"),
  removal: document.querySelector("#removal"),
  removalCopy: document.querySelector("#removal-copy"),
  removalOpen: document.querySelector("#removal-open"),
  removalDone: document.querySelector("#removal-done"),
  removalSkip: document.querySelector("#removal-skip"),
};

let stopRequested = false;
let removal = [];

function isPlaceholderName(value) {
  return String(value || "").trim().toLowerCase() === "user";
}

function findPerson(username) {
  const key = String(username || "").toLowerCase();
  return (
    state.following.find((person) => person.username.toLowerCase() === key) ||
    state.followers.find((person) => person.username.toLowerCase() === key)
  );
}

function isDeletedAccount(person) {
  if (!person) return false;
  const check = state.checks[person.username.toLowerCase()];
  if (check?.status === "missing") return true;
  if (isPlaceholderName(check?.displayName)) return true;
  if (isPlaceholderName(person.nickname) || isPlaceholderName(person.username)) return true;
  return false;
}

function setStatus(message) {
  els.status.textContent = message;
}

function loadStorage() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved?.following && !saved?.followers) return;
    Object.assign(state, {
      owner: saved.owner || "",
      sourceName: saved.sourceName || "copia guardada",
      following: saved.following || [],
      followers: saved.followers || [],
      checks: saved.checks || {},
      cleaned: saved.cleaned || {},
    });
    if (state.following.length || state.followers.length) els.resume.hidden = false;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function saveStorage() {
  const payload = {
    owner: state.owner,
    sourceName: state.sourceName,
    following: state.following,
    followers: state.followers,
    checks: state.checks,
    cleaned: state.cleaned,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    setStatus("La lista es muy grande para guardarla en este navegador. Sigue en esta pestaña.");
  }
}

function refreshSets() {
  state.followingSet = new Set(state.following.map((person) => person.username.toLowerCase()));
  state.followersSet = new Set(state.followers.map((person) => person.username.toLowerCase()));
}

function uniquePeople() {
  const all = new Map();
  for (const person of [...state.following, ...state.followers]) {
    const key = person.username.toLowerCase();
    if (!all.has(key)) all.set(key, person);
  }
  return [...all.values()];
}

function relationFor(username) {
  const key = username.toLowerCase();
  const follows = state.followingSet.has(key);
  const follower = state.followersSet.has(key);
  if (follows && follower) return "Mutuo";
  if (follows) return "Sigues";
  if (follower) return "Te sigue";
  return "—";
}

function peopleForView(view) {
  if (!state.followingSet || !state.followersSet) refreshSets();
  let people = [];

  if (view === "following") people = state.following.map((person) => ({ ...person }));
  if (view === "followers") people = state.followers.map((person) => ({ ...person }));
  if (view === "mutual") {
    people = state.following.filter((person) => state.followersSet.has(person.username.toLowerCase()));
  }
  if (view === "not-back") {
    people = state.following.filter((person) => !state.followersSet.has(person.username.toLowerCase()));
  }
  if (view === "not-followed") {
    people = state.followers.filter((person) => !state.followingSet.has(person.username.toLowerCase()));
  }
  if (view === "missing") {
    people = uniquePeople().filter((person) => isDeletedAccount(person));
  }
  if (view === "cleaned") {
    people = uniquePeople().filter((person) => state.cleaned[person.username.toLowerCase()]);
  }

  if (view !== "cleaned") {
    people = people.filter((person) => !state.cleaned[person.username.toLowerCase()]);
  }

  const query = state.query.trim().toLowerCase().replace(/^@/, "");
  if (query) {
    people = people.filter((person) => {
      const check = state.checks[person.username.toLowerCase()];
      return (
        person.username.toLowerCase().includes(query) ||
        (person.nickname || "").toLowerCase().includes(query) ||
        (check?.displayName || "").toLowerCase().includes(query)
      );
    });
  }

  people.sort((a, b) => {
    if (state.sort === "name") return a.username.localeCompare(b.username, "es");
    const aTime = parseDate(a.date)?.getTime() || 0;
    const bTime = parseDate(b.date)?.getTime() || 0;
    return state.sort === "date-asc" ? aTime - bTime : bTime - aTime;
  });

  return people;
}

function countMissing() {
  return uniquePeople().filter((person) => isDeletedAccount(person) && !state.cleaned[person.username.toLowerCase()]).length;
}

function formatDate(value) {
  const date = parseDate(value);
  if (!date) return "sin fecha";
  return new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function statusPill(username) {
  const check = state.checks[username.toLowerCase()];
  const person = findPerson(username);
  if (check?.status === "missing") return `<span class="pill missing">No existe</span>`;
  if (isPlaceholderName(check?.displayName) || isPlaceholderName(person?.nickname) || isPlaceholderName(username)) {
    return `<span class="pill missing">Nombre user</span>`;
  }
  if (!check) return `<span class="pill pending">Sin revisar</span>`;
  if (check.status === "alive") return `<span class="pill alive">Sigue ahí</span>`;
  return `<span class="pill unknown">Dudosa</span>`;
}

function showDesk() {
  els.gate.hidden = true;
  els.account.hidden = true;
  els.desk.hidden = false;
  const who = state.owner ? `@${state.owner}` : connectedProfile?.username ? `@${connectedProfile.username}` : "tu cuenta";
  els.owner.textContent = who;
  const titles = {
    ejemplo: "Esto es un libro de ejemplo.",
    tiktok: "Lista traída desde tu cuenta.",
  };
  els.title.textContent = titles[state.sourceName] || "El libro está abierto.";
  els.sessionChip.hidden = !connectedProfile;
  render();
}

function openBook(merged, sourceName) {
  removal = [];
  if (els.removal) els.removal.hidden = true;
  state.owner = merged.owner || connectedProfile?.username || "";
  state.sourceName = sourceName;
  state.following = merged.following || [];
  state.followers = merged.followers || [];
  state.checks = {};
  state.cleaned = {};
  state.view = "following";
  state.visible = PAGE_SIZE;
  saveStorage();
  showDesk();
}

function showProfile(profile) {
  connectedProfile = profile;
  els.displayName.textContent = profile.displayName || "Tu TikTok";
  els.bio.textContent = profile.bio || "Cuenta conectada. Pide la lista para ver seguidos y seguidores.";
  els.handle.textContent = profile.username ? `@${profile.username}` : "TikTok no compartió el usuario";
  els.avatar.hidden = !profile.avatarUrl;
  els.avatar.alt = profile.displayName || "Avatar";
  if (profile.avatarUrl) els.avatar.src = profile.avatarUrl;
  els.chipAvatar.hidden = !profile.avatarUrl;
  if (profile.avatarUrl) els.chipAvatar.src = profile.avatarUrl;
  els.chipName.textContent = profile.username ? `@${profile.username}` : profile.displayName;
  const metrics = [
    ["Seguidores", profile.followerCount],
    ["Siguiendo", profile.followingCount],
    ["Me gusta", profile.likesCount],
    ["Videos", profile.videoCount],
  ].filter(([, value]) => value !== null && value !== undefined);
  els.metrics.innerHTML = metrics
    .map(([label, value]) => `<div><dt>${label}</dt><strong>${Number(value).toLocaleString("es")}</strong></div>`)
    .join("");
}

function showAccountScreen() {
  els.gate.hidden = true;
  els.desk.hidden = true;
  els.account.hidden = false;
}

async function disconnectAccount() {
  await fetch("/api/tiktok/disconnect", { method: "POST" });
  clearTimeout(pollTimer);
  connectedProfile = null;
  localStorage.removeItem(STORAGE_KEY);
  state.owner = "";
  state.following = [];
  state.followers = [];
  state.checks = {};
  state.cleaned = {};
  els.sessionChip.hidden = true;
  els.removal.hidden = true;
  removal = [];
  els.account.hidden = true;
  els.desk.hidden = true;
  els.gate.hidden = false;
  setStatus("Conexión eliminada de esta web.");
}

async function applyData(data) {
  if (data.book && (data.book.following?.length || data.book.followers?.length)) {
    openBook(data.book, "tiktok");
    setStatus(`${data.book.following.length.toLocaleString("es")} seguidos · ${data.book.followers.length.toLocaleString("es")} seguidores`);
    return;
  }
  const notes = {
    pending: "TikTok está reuniendo tu lista. Puede tardar. Esta página sigue preguntando.",
    downloading: "TikTok ya tiene el archivo. Lo estoy abriendo…",
    expired: "Esa copia caducó. Pide la lista otra vez.",
    cancelled: "La petición se canceló.",
    idle: "Todavía no pides la lista.",
  };
  const note = data.message || notes[data.status] || "TikTok todavía no entrega la lista.";
  els.dataNote.textContent = note;
  setStatus(note);
  if (data.status === "pending" || data.status === "downloading") {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(pollList, 8000);
  }
}

async function pollList() {
  const response = await fetch("/api/tiktok/data");
  const data = await response.json();
  if (!response.ok) {
    els.dataNote.textContent = data.message || "No pude consultar la lista.";
    return;
  }
  await applyData(data);
}

async function requestList() {
  if (!connectedProfile) {
    setStatus("Conecta tu TikTok para pedir la lista.");
    return;
  }
  els.dataNote.textContent = "Pidiendo tu lista a TikTok…";
  setStatus("Pidiendo tu lista a TikTok…");
  const response = await fetch("/api/tiktok/data", { method: "POST" });
  const data = await response.json();
  if (!response.ok) {
    els.dataNote.textContent = data.message || "TikTok no aceptó la petición.";
    setStatus(data.message || "TikTok no aceptó la petición.");
    return;
  }
  await applyData(data);
}

async function bootTikTok() {
  const params = new URLSearchParams(location.search);
  if (params.get("auth_error")) setStatus(params.get("auth_error"));
  if (params.get("connected") || params.get("auth_error")) history.replaceState({}, "", "/");

  const config = await fetch("/api/tiktok/config").then((response) => response.json());
  if (els.redirectUri) els.redirectUri.textContent = config.redirectUri;
  if (!config.configured) {
    els.connect.removeAttribute("href");
    els.setup.hidden = false;
  }

  const me = await fetch("/api/tiktok/me").then((response) => response.json());
  if (!me.connected) return;
  if (me.profile) showProfile(me.profile);
  if (me.scope && !me.scope.includes("portability.")) {
    els.dataNote.textContent =
      "El Sandbox de TikTok muestra tu cuenta, pero no entrega la lista de seguidos. Eso se activa cuando TikTok apruebe la app en Production.";
  }
  if (me.warning) setStatus(me.warning);
  if (me.book?.following?.length || me.book?.followers?.length) {
    openBook(me.book, "tiktok");
    return;
  }
  if (!state.following.length && !state.followers.length) showAccountScreen();
  if (me.dataStatus === "pending" || me.dataStatus === "downloading") pollList();
}

function isClean(username) {
  return Boolean(state.cleaned[String(username).toLowerCase()]);
}

function renderStats() {
  refreshSets();
  const activeFollowing = state.following.filter((person) => !isClean(person.username));
  const activeFollowers = state.followers.filter((person) => !isClean(person.username));
  const mutual = activeFollowing.filter((person) => state.followersSet.has(person.username.toLowerCase())).length;
  const openMissing = countMissing();
  const apartadas = Object.keys(state.cleaned).length;
  const missingNote = openMissing
    ? "Cuentas que ya no existen o se llaman user"
    : apartadas
      ? "Ya están en Apartadas"
      : "Todavía no revisas la lista";
  const cards = [
    ["Ausentes", openMissing, missingNote, true],
    ["Siguiendo", activeFollowing.length, `${state.following.length.toLocaleString("es")} en la copia`],
    ["Seguidores", activeFollowers.length, `${state.followers.length.toLocaleString("es")} en la copia`],
    ["Mutuos", mutual, "Se siguen"],
    ["Apartadas", apartadas, "Fuera de las otras listas"],
  ];

  els.stats.innerHTML = cards
    .map(
      ([label, value, note, hero]) => `
        <article class="stat${hero ? " hero" : ""}">
          <span>${label}</span>
          <strong>${value.toLocaleString("es")}</strong>
          <small>${note}</small>
        </article>`,
    )
    .join("");
}

function renderTabs() {
  els.tabs.innerHTML = VIEWS.map(([id, label]) => {
    const count = peopleForView(id).length;
    return `<button class="tab" type="button" role="tab" data-view="${id}" aria-selected="${state.view === id}">${label} ${count.toLocaleString("es")}</button>`;
  }).join("");
}

function renderRows() {
  const people = peopleForView(state.view);
  const slice = people.slice(0, state.visible);
  els.count.textContent = `${Math.min(state.visible, people.length).toLocaleString("es")} de ${people.length.toLocaleString("es")}`;
  els.more.hidden = state.visible >= people.length;
  els.sortDate.textContent = state.sort === "name" ? "Nombre" : state.sort === "date-asc" ? "Desde ↑" : "Desde ↓";

  if (!slice.length) {
    els.rows.innerHTML = `<tr><td class="empty" colspan="5">No hay cuentas en esta vista.</td></tr>`;
    return;
  }

  els.rows.innerHTML = slice
    .map((person) => {
      const check = state.checks[person.username.toLowerCase()];
      const name = check?.displayName && check.displayName !== person.username ? check.displayName : person.nickname || "";
      const profile = `https://www.tiktok.com/@${encodeURIComponent(person.username)}`;
      const cleaned = Boolean(state.cleaned[person.username.toLowerCase()]);
      return `
        <tr>
          <td>
            <span class="handle">@${person.username}</span>
            ${name ? `<span class="sub">${escapeHtml(name)}</span>` : ""}
          </td>
          <td>${formatDate(person.date)}</td>
          <td><span class="pill link">${relationFor(person.username)}</span></td>
          <td>${statusPill(person.username)}</td>
          <td>
            <div class="row-actions">
              <a class="link-btn" href="${profile}" target="_blank" rel="noreferrer">Abrir</a>
              <button class="mini" type="button" data-check="${person.username}">Verificar</button>
              <button class="mini" type="button" data-clean="${person.username}">${cleaned ? "Devolver" : "Apartar"}</button>
            </div>
          </td>
        </tr>`;
    })
    .join("");
}

function render() {
  renderStats();
  renderTabs();
  renderRows();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function readFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".zip") || file.type === "application/zip") {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const parts = [];
    const jobs = Object.values(zip.files).filter((entry) => !entry.dir && /\.(json|txt)$/i.test(entry.name));
    for (const entry of jobs) {
      const text = await entry.async("string");
      parts.push(entry.name.toLowerCase().endsWith(".json") ? parseJsonText(text) : parseTxt(text, entry.name));
    }
    if (!parts.length) throw new Error("El ZIP no trae JSON ni TXT de seguidos.");
    return mergeImports(parts);
  }

  const text = await file.text();
  if (name.endsWith(".txt") || file.type.startsWith("text/")) {
    const parsed = parseTxt(text, file.name);
    if (parsed.loose?.length && !parsed.following.length && !parsed.followers.length) {
      throw new Error(`No sé si ${file.name} es seguidos o seguidores. Renómbralo a Following.txt o Follower.txt.`);
    }
    return parsed;
  }
  return parseJsonText(text);
}

async function ingestFiles(fileList, sourceName) {
  const files = [...fileList];
  if (!files.length) return;
  setStatus("Leyendo el archivo…");
  await wait(40);
  try {
    const parts = [];
    for (const file of files) parts.push(await readFile(file));
    const merged = mergeImports(parts);
    if (!merged.following.length && !merged.followers.length) {
      throw new Error("No encontré listas de Following ni de Followers.");
    }
    openBook(merged, sourceName || files.map((file) => file.name).join(", "));
    const summary = `${merged.following.length.toLocaleString("es")} seguidos · ${merged.followers.length.toLocaleString("es")} seguidores`;
    setStatus(sourceName === "archivo" ? `${summary}. Pulsa Quitar cuentas borradas.` : summary);
  } catch (error) {
    setStatus(error.message || "No pude leer ese archivo.");
  }
}

async function checkOne(username) {
  const response = await fetch(`/api/check?username=${encodeURIComponent(username)}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "TikTok no respondió.");
  state.checks[username.toLowerCase()] = data;
  return data;
}

async function verifyList(usernames) {
  const pending = [...new Set(usernames.map((name) => name.replace(/^@/, "")))].filter(Boolean);
  if (!pending.length) {
    setStatus("No hay cuentas para revisar en esta vista.");
    return;
  }
  state.running = true;
  stopRequested = false;
  els.verify.hidden = true;
  els.stop.hidden = false;
  els.progress.hidden = false;

  let done = 0;
  const queue = [...pending];

  async function worker() {
    while (queue.length && !stopRequested) {
      const username = queue.shift();
      try {
        await checkOne(username);
      } catch (error) {
        state.checks[username.toLowerCase()] = {
          status: "unknown",
          username,
          detail: error.message,
        };
      }
      done += 1;
      const width = Math.round((done / pending.length) * 100);
      els.progressFill.style.width = `${width}%`;
      els.progressLabel.textContent = `${done.toLocaleString("es")} de ${pending.length.toLocaleString("es")} · ausentes ${countMissing().toLocaleString("es")}`;
      if (done % 5 === 0 || done === pending.length) {
        saveStorage();
        render();
      }
      await wait(420);
    }
  }

  await Promise.all([worker(), worker()]);
  state.running = false;
  els.verify.hidden = false;
  els.stop.hidden = true;
  els.progress.hidden = true;
  saveStorage();
  render();
  setStatus(stopRequested ? "Revisión detenida." : `Listo. ${countMissing().toLocaleString("es")} cuentas ya no aparecen.`);
}

function exportCsv() {
  const people = peopleForView(state.view);
  const lines = ["username,fecha,relacion,estado,perfil"];
  for (const person of people) {
    const check = state.checks[person.username.toLowerCase()];
    const cells = [
      person.username,
      person.date || "",
      relationFor(person.username),
      check?.status || "pending",
      `https://www.tiktok.com/@${person.username}`,
    ].map((value) => `"${String(value).replaceAll('"', '""')}"`);
    lines.push(cells.join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `ausentes-${state.view}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deletedLabel(person) {
  const check = state.checks[person.username.toLowerCase()];
  if (check?.status === "missing") return "ya no existe";
  return "se llama user";
}

function showRemoval() {
  const person = removal[0];
  if (!person) {
    els.removal.hidden = true;
    return;
  }
  els.removal.hidden = false;
  els.removalCopy.textContent = `@${person.username} ${deletedLabel(person)}. Quedan ${removal.length.toLocaleString("es")}. Ábrela y pulsa Siguiendo.`;
  els.removalOpen.href = `https://www.tiktok.com/@${encodeURIComponent(person.username)}`;
}

function advanceRemoval(markCleaned) {
  const person = removal.shift();
  if (markCleaned && person) state.cleaned[person.username.toLowerCase()] = true;
  saveStorage();
  if (!removal.length) {
    els.removal.hidden = true;
    state.view = "cleaned";
    render();
    setStatus("Listo. En TikTok quedan quitadas las que abriste y marcaste con Siguiendo.");
    return;
  }
  state.view = "missing";
  render();
  showRemoval();
}

async function removeDeletedAccounts() {
  if (state.running) return;
  if (!state.following.length) {
    const message = "Esta conexión todavía no trae a quién sigues. Sube el archivo de datos de TikTok para quitar las borradas.";
    if (els.dataNote) els.dataNote.textContent = message;
    setStatus(message);
    return;
  }

  showDesk();
  const pending = state.following
    .filter((person) => !state.cleaned[person.username.toLowerCase()])
    .filter((person) => {
      const check = state.checks[person.username.toLowerCase()];
      return !check || check.status === "unknown";
    })
    .map((person) => person.username);
  if (pending.length) await verifyList(pending);

  removal = state.following.filter(
    (person) => isDeletedAccount(person) && !state.cleaned[person.username.toLowerCase()],
  );
  if (!removal.length) {
    els.removal.hidden = true;
    setStatus("No hay cuentas borradas ni perfiles con el nombre user.");
    return;
  }
  state.view = "missing";
  render();
  showRemoval();
  setStatus(`${removal.length.toLocaleString("es")} cuentas para quitar. Abre la primera y pulsa Siguiendo.`);
}

els.resume.addEventListener("click", () => showDesk());

els.demo.addEventListener("click", async () => {
  setStatus("Abriendo el ejemplo…");
  const response = await fetch("/demo-tiktok.json");
  const file = new File([await response.text()], "demo-tiktok.json", { type: "application/json" });
  await ingestFiles([file], "ejemplo");
});

els.fetchList.addEventListener("click", requestList);
els.fetchListDesk.addEventListener("click", requestList);
els.removeDeletedBtn.addEventListener("click", () => {
  removeDeletedAccounts().catch((error) => setStatus(error.message));
});
els.removeDeletedDesk.addEventListener("click", () => {
  removeDeletedAccounts().catch((error) => setStatus(error.message));
});
els.importFile.addEventListener("change", () => {
  const files = els.importFile.files;
  ingestFiles(files, "archivo");
  els.importFile.value = "";
});
els.removalDone.addEventListener("click", () => advanceRemoval(true));
els.removalSkip.addEventListener("click", () => advanceRemoval(false));
els.disconnect.addEventListener("click", disconnectAccount);
els.disconnectDesk.addEventListener("click", disconnectAccount);

els.query.addEventListener("input", () => {
  state.query = els.query.value;
  state.visible = PAGE_SIZE;
  renderRows();
  renderTabs();
});

els.tabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (!button) return;
  state.view = button.dataset.view;
  state.visible = PAGE_SIZE;
  render();
});

els.more.addEventListener("click", () => {
  state.visible += PAGE_SIZE;
  renderRows();
});

els.sortDate.addEventListener("click", () => {
  state.sort = state.sort === "date-desc" ? "date-asc" : state.sort === "date-asc" ? "name" : "date-desc";
  renderRows();
});

els.rows.addEventListener("click", async (event) => {
  const check = event.target.closest("[data-check]");
  const clean = event.target.closest("[data-clean]");
  if (check) {
    setStatus(`Revisando @${check.dataset.check}…`);
    try {
      const result = await checkOne(check.dataset.check);
      saveStorage();
      render();
      setStatus(result.detail || (result.status === "alive" ? `@${result.username} sigue en TikTok.` : `@${result.username} ya no existe.`));
    } catch (error) {
      setStatus(error.message);
    }
  }
  if (clean) {
    const key = clean.dataset.clean.toLowerCase();
    if (state.cleaned[key]) delete state.cleaned[key];
    else state.cleaned[key] = true;
    saveStorage();
    render();
  }
});

els.verify.addEventListener("click", () => {
  const names = uniquePeople()
    .filter((person) => !state.cleaned[person.username.toLowerCase()])
    .filter((person) => !state.checks[person.username.toLowerCase()])
    .map((person) => person.username);
  verifyList(names);
});

els.verifyVisible.addEventListener("click", () => {
  verifyList(peopleForView(state.view).map((person) => person.username));
});

els.stop.addEventListener("click", () => {
  stopRequested = true;
});

els.cleanMissing.addEventListener("click", () => {
  let moved = 0;
  for (const person of uniquePeople()) {
    const key = person.username.toLowerCase();
    if (isDeletedAccount(person) && !state.cleaned[key]) {
      state.cleaned[key] = true;
      moved += 1;
    }
  }
  saveStorage();
  state.view = "cleaned";
  render();
  setStatus(moved ? `${moved.toLocaleString("es")} ausentes apartadas. Ábrelas en TikTok para dejar de seguirlas.` : "Todavía no hay ausentes confirmadas.");
});

els.exportBtn.addEventListener("click", exportCsv);

loadStorage();
bootTikTok().catch((error) => setStatus(error.message));
