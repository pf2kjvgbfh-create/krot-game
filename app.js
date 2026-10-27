/* Крот — tap game: find the lie, lay down the evidence that breaks it. Cases live in cases.json. */
const tg = window.Telegram && window.Telegram.WebApp;
const can = (v) => !!(tg && tg.isVersionAtLeast && tg.isVersionAtLeast(v));
const $app = document.getElementById("app");
const KEY = "krot1";
const RANKS = [[0, "Курсант"], [3, "Стажёр"], [7, "Опер"], [11, "Старший опер"], [15, "Майор"], [24, "Полковник"]];
const RETORTS = ["Это правда, проверяй сколько хочешь.", "И где тут враньё? Мимо.", "Я сказал как было. Ищи в другом месте."];
let CASES = [];
let P = { stars: {}, tricks: {}, streak: { day: "", n: 0 } };
let G = null; // current case run

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const haptic = (kind) => {
  try {
    if (!can("6.1")) return;
    if (kind === "tap") tg.HapticFeedback.impactOccurred("light");
    else tg.HapticFeedback.notificationOccurred(kind);
  } catch (e) { /* haptics are optional */ }
};

/* ---------- storage ---------- */
function save() {
  const s = JSON.stringify(P);
  try { localStorage.setItem(KEY, s); } catch (e) { /* private mode */ }
  try { if (can("6.9")) tg.CloudStorage.setItem(KEY, s, () => {}); } catch (e) { /* old client */ }
}
function load() {
  try { const s = localStorage.getItem(KEY); if (s) P = { ...P, ...JSON.parse(s) }; } catch (e) { /* empty */ }
  try {
    if (can("6.9")) tg.CloudStorage.getItem(KEY, (err, v) => {
      if (err || !v) return;
      const cloud = JSON.parse(v);
      if (totalStars(cloud) > totalStars(P)) { P = { ...P, ...cloud }; if (!G) home(); }
    });
  } catch (e) { /* old client */ }
}
const totalStars = (p) => Object.values(p.stars || {}).reduce((a, b) => a + b, 0);
function rankOf(stars) {
  let i = 0;
  RANKS.forEach(([min], k) => { if (stars >= min) i = k; });
  const next = RANKS[i + 1];
  return { name: RANKS[i][1], from: RANKS[i][0], next: next ? next[0] : null, nextName: next ? next[1] : null };
}
const dayStr = (d) => d.toISOString().slice(0, 10);
function bumpStreak() {
  const today = dayStr(new Date());
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (P.streak.day === today) return;
  P.streak = { day: today, n: P.streak.day === dayStr(y) ? P.streak.n + 1 : 1 };
}

/* ---------- shell ---------- */
function screen(html, back) {
  $app.innerHTML = `<div class="screen">${html}</div>`;
  window.scrollTo(0, 0);
  if (can("6.1")) back ? tg.BackButton.show() : tg.BackButton.hide();
}
function toast(text) {
  const t = document.getElementById("toast");
  t.textContent = text; t.classList.remove("hidden");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add("hidden"), 2600);
}
function sheet(html) {
  const s = document.getElementById("sheet");
  document.getElementById("sheetCard").innerHTML = html;
  s.classList.remove("hidden");
  s.onclick = (e) => { if (e.target === s) closeSheet(); };
}
const closeSheet = () => document.getElementById("sheet").classList.add("hidden");
const scrollEnd = () => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
const person = (c, id) => c.people.find((p) => p.id === id);

/* ---------- home ---------- */
function home() {
  G = null;
  const st = totalStars(P), r = rankOf(st);
  const pct = r.next ? Math.round(((st - r.from) / (r.next - r.from)) * 100) : 100;
  const firstOpen = CASES.findIndex((c) => P.stars[c.id] === undefined);
  const list = CASES.map((c, i) => {
    const done = P.stars[c.id] !== undefined;
    const open = i === 0 || P.stars[CASES[i - 1].id] !== undefined;
    const stars = done ? "★".repeat(P.stars[c.id]) + "☆".repeat(3 - P.stars[c.id]) : open ? "" : "🔒";
    return `<button class="case ${open ? "" : "locked"} ${i === firstOpen ? "next" : ""}" data-i="${i}" ${open ? "" : "disabled"}>
      <div class="num">${String(i + 1).padStart(2, "0")}</div>
      <div><div class="t">${esc(c.title)}</div><div class="tag">${esc(c.tag)} · ~3 мин</div></div>
      <div class="stars">${stars}</div></button>`;
  }).join("");
  const nTricks = Object.keys(P.tricks).length;
  screen(`
    <div class="brand"><div class="eye">👁</div><div><div class="h1">КРОТ</div><small>Найди, где врут. Докажи.</small></div></div>
    <div class="rank">
      <div class="rank-top"><div><div class="muted mono" style="font-size:11px">ЗВАНИЕ</div><div class="rank-name">${r.name}</div></div>
        <div class="chips"><span class="chip">🔥 ${P.streak.n || 0}</span><span class="chip">★ ${st}</span></div></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="muted" style="font-size:13px">${r.next ? `До звания «${r.nextName}»: ещё ★ ${r.next - st}` : "Высшее звание. Уважение."}</div>
    </div>
    <div class="section">Дела</div>${list}
    <button class="nb" id="nb"><span>📓 Блокнот опера</span><span class="muted">${nTricks} приёмов →</span></button>`);
  $app.querySelectorAll(".case[data-i]").forEach((b) => b.onclick = () => { haptic("tap"); intro(CASES[+b.dataset.i]); });
  document.getElementById("nb").onclick = notebook;
}

function notebook() {
  const items = Object.values(P.tricks);
  screen(`<div class="topbar"><button class="back" id="bk">←</button><div class="title">Блокнот опера</div></div>
    ${items.length ? `<div class="card">${items.map((t) => `<div class="trick"><b>${esc(t.trick)}</b><span class="muted">${esc(t.rule)}</span></div>`).join("")}</div>`
      : `<div class="card muted">Пока пусто. Каждая пойманная ложь — приём в блокнот.</div>`}`, true);
  document.getElementById("bk").onclick = home;
}

/* ---------- case ---------- */
function intro(c) {
  const i = CASES.indexOf(c) + 1;
  screen(`<div class="topbar"><button class="back" id="bk">←</button></div>
    <div class="dossier"><div class="stamp-sm">${esc(c.tag.toUpperCase())}</div>
      <div class="lbl">ДЕЛО №${String(i).padStart(2, "0")} · ${esc(c.place)}</div>
      <div class="h1">${esc(c.title)}</div><p>${esc(c.intro)}</p>
      <div class="suspects">${c.people.map((p) => `<div class="sus"><div class="av">${p.emoji}</div><div><b>${esc(p.name)}</b> — ${esc(p.role)}</div></div>`).join("")}</div>
    </div>
    <div class="card muted" style="font-size:14px">Как играть: нажми на фразу, где врут → выбери улику, которая это ломает. Ошибся — минус жетон. Жетонов три.</div>
    <div class="cta"><button class="btn" id="go">Взять дело</button></div>`, true);
  document.getElementById("bk").onclick = home;
  document.getElementById("go").onclick = () => {
    haptic("tap");
    G = { c, ri: 0, tokens: 3, sel: null, held: c.evidence.filter((e) => e.start).map((e) => e.id), fresh: [], learned: [], busy: false };
    round();
  };
}

function header() {
  const b = [0, 1, 2].map((k) => `<b class="${k < G.tokens ? "" : "off"}">★</b>`).join("");
  const n = G.c.rounds.length;
  const sub = G.ri < n ? `эпизод ${G.ri + 1} из ${n}` : "финал";
  return `<div class="topbar"><button class="back" id="bk">←</button><div><div class="title">${esc(G.c.title)}</div><div class="sub">${sub}</div></div><div class="badges" id="badges">${b}</div></div>`;
}
function bindBack() { document.getElementById("bk").onclick = home; }

function trayHTML() {
  return G.held.map((id) => {
    const e = G.c.evidence.find((x) => x.id === id);
    return `<button class="ev ${G.fresh.includes(id) ? "new" : ""}" data-e="${id}"><div class="ic">${e.icon}</div><div class="tt">${esc(e.title)}</div></button>`;
  }).join("");
}

function msgHTML(c, l, cls = "") {
  const p = person(c, l.who);
  return `<div class="msg ${cls}"><div class="av">${p.emoji}</div>
    <button class="bubble ${cls ? "" : "tap"}" ${l.id ? `data-l="${l.id}"` : ""}><div class="who">${esc(p.name)}</div>${esc(l.text)}</button></div>`;
}

async function addMsg(l, cls) {
  const chat = document.getElementById("chat");
  const p = person(G.c, l.who);
  const t = document.createElement("div");
  t.className = "msg"; t.innerHTML = `<div class="av">${p.emoji}</div><div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div>`;
  chat.appendChild(t); scrollEnd();
  await sleep(G.fast ? 120 : Math.min(1100, 380 + l.text.length * 9));
  t.outerHTML = msgHTML(G.c, l, cls);
  scrollEnd();
}

async function round() {
  const c = G.c, r = c.rounds[G.ri];
  G.sel = null; G.busy = true; G.fast = false;
  screen(`${header()}<div class="hint" id="hint">Слушай. Где-то здесь враньё.</div>
    <div class="chat" id="chat"></div>
    <div class="tray" id="tray"><div class="lab" id="trayLab">УЛИКИ НА РУКАХ</div><div class="cards" id="cards">${trayHTML()}</div></div>`, true);
  bindBack();
  document.getElementById("chat").onclick = () => { G.fast = true; };
  bindTray();
  for (const l of r.lines) await addMsg(l);
  G.busy = false;
  document.getElementById("hint").textContent = "Нажми на фразу, где врут";
  document.querySelectorAll(".bubble.tap").forEach((b) => b.onclick = (e) => { e.stopPropagation(); selectLine(b); });
}

function selectLine(b) {
  if (G.busy) return;
  haptic("tap");
  document.querySelectorAll(".bubble.sel").forEach((x) => x.classList.remove("sel"));
  if (G.sel === b.dataset.l) { G.sel = null; armTray(false); return; }
  G.sel = b.dataset.l; b.classList.add("sel"); armTray(true);
}
function armTray(on) {
  document.getElementById("tray").classList.toggle("armed", on);
  document.getElementById("trayLab").textContent = on ? "ЧЕМ ДОКАЖЕШЬ? ВЫБЕРИ УЛИКУ" : "УЛИКИ НА РУКАХ";
  document.getElementById("hint").textContent = on ? "Теперь улика, которая это ломает" : "Нажми на фразу, где врут";
}
function bindTray() {
  document.querySelectorAll(".ev").forEach((b) => b.onclick = () => openEvidence(b.dataset.e));
}

function openEvidence(id) {
  if (G.busy) return;
  haptic("tap");
  const e = G.c.evidence.find((x) => x.id === id);
  const line = G.sel && G.c.rounds[G.ri].lines.find((l) => l.id === G.sel);
  sheet(`<div class="ic">${e.icon}</div><h3>${esc(e.title)}</h3><p>${esc(e.text)}</p>
    ${line ? `<div class="against">Против фразы: «${esc(line.text)}»</div><button class="btn" id="present">⚖️ Предъявить</button>`
      : `<div class="against">Сначала нажми на фразу, где врут, — потом предъявишь.</div>`}
    <button class="btn ghost" id="close">Закрыть</button>`);
  document.getElementById("close").onclick = closeSheet;
  if (line) document.getElementById("present").onclick = () => { closeSheet(); present(id); };
}

async function loseToken() {
  G.tokens -= 1;
  haptic("error");
  document.getElementById("badges").outerHTML = header().match(/<div class="badges"[\s\S]*?<\/div>/)[0];
  document.querySelector(".screen").classList.add("shake");
  await sleep(420);
  document.querySelector(".screen").classList.remove("shake");
  if (G.tokens <= 0) { await sleep(500); fail(); return false; }
  return true;
}

async function present(evId) {
  const r = G.c.rounds[G.ri];
  const bubble = document.querySelector(`.bubble[data-l="${G.sel}"]`);
  G.busy = true;
  if (G.sel === r.lie && evId === r.breaks) {
    haptic("success");
    bubble.classList.remove("sel"); bubble.classList.add("lie");
    bubble.insertAdjacentHTML("beforeend", `<div class="stamp">ЛОЖЬ</div>`);
    document.querySelectorAll(".bubble.tap").forEach((b) => { b.onclick = null; if (b !== bubble) b.classList.add("ok"); });
    armTray(false); document.getElementById("hint").textContent = "Попал.";
    await sleep(600);
    await addMsg(r.hit, "react");
    learn(r);
    return;
  }
  const rightLine = G.sel === r.lie;
  const who = r.lines.find((l) => l.id === G.sel).who;
  bubble.classList.remove("sel"); G.sel = null; armTray(false);
  const retort = rightLine ? { who, text: "И что? Эта бумажка вообще не про это." }
    : who === r.wrong.who ? r.wrong : { who, text: RETORTS[G.tokens % RETORTS.length] };
  await addMsg(retort, "wrong");
  if (await loseToken()) {
    G.busy = false;
    document.getElementById("hint").textContent = rightLine ? "Фраза верная, но улика не та. Минус жетон" : "Мимо. Минус жетон. Ищи ещё";
  }
}

function learn(r) {
  G.learned.push(r);
  P.tricks[r.trick] = { trick: r.trick, rule: r.rule };
  const chat = document.getElementById("chat");
  const last = G.ri === G.c.rounds.length - 1;
  chat.insertAdjacentHTML("beforeend", `<div class="lesson"><div class="k">ПРИЁМ В БЛОКНОТ</div><div class="name">${esc(r.trick)}</div>
    <div>${esc(r.why)}</div><div class="rule">👉 ${esc(r.rule)}</div>
    <button class="btn" id="next">${last ? (G.c.final ? "К финалу →" : "Итог дела →") : "Дальше →"}</button></div>`);
  scrollEnd();
  const unlocked = (r.unlock || []).filter((u) => !G.held.includes(u));
  G.fresh = unlocked; G.held = G.held.concat(unlocked);
  if (unlocked.length) {
    document.getElementById("cards").innerHTML = trayHTML(); bindTray();
    toast("Новая улика: " + unlocked.map((u) => G.c.evidence.find((e) => e.id === u).title).join(", "));
  }
  document.getElementById("next").onclick = () => {
    haptic("tap"); G.ri += 1; G.busy = false;
    if (G.ri < G.c.rounds.length) round(); else if (G.c.final) final(); else result();
  };
}

/* ---------- final, result, fail ---------- */
function final() {
  const f = G.c.final;
  screen(`${header()}<div class="hint">Все улики у тебя. Время решать.</div>
    <div class="h2" style="text-align:center;margin-top:6px">${esc(f.ask)}</div>
    <div class="pick">${G.c.people.map((p) => `<button data-p="${p.id}"><span class="em">${p.emoji}</span><span class="nm">${esc(p.name)}</span></button>`).join("")}</div>`, true);
  bindBack();
  document.querySelectorAll(".pick button").forEach((b) => b.onclick = async () => {
    if (G.busy || b.classList.contains("bad")) return;
    if (b.dataset.p === f.answer) { haptic("success"); result(true); return; }
    b.classList.add("bad"); toast("Мимо. У него нет ни окна, ни улик.");
    G.busy = true; if (await loseToken()) G.busy = false;
  });
}

function result(caught) {
  const c = G.c;
  const stars = G.tokens;
  P.stars[c.id] = Math.max(P.stars[c.id] || 0, stars);
  bumpStreak(); save();
  const i = CASES.indexOf(c);
  const next = CASES[i + 1];
  const head = c.final ? `<div class="big-stamp good">${caught ? "ВИНОВЕН" : "РАСКРЫТО"}</div>` : `<div class="big-stamp good">РАЗВОД НЕ ПРОШЁЛ</div>`;
  screen(`${head}<div class="stars-big">${"★".repeat(stars)}${"☆".repeat(3 - stars)}</div>
    <div class="card">${esc(c.final ? c.final.reveal : c.summary)}</div>
    <div class="card"><div class="section" style="margin:0 0 4px">Приёмы из дела</div>
      ${G.learned.map((r) => `<div class="trick"><b>${esc(r.trick)}</b><span class="muted">${esc(r.rule)}</span></div>`).join("")}</div>
    <div class="cta">${next ? `<button class="btn" id="nx">Следующее дело →</button>` : `<div class="card muted">Пока всё. Новые дела появятся в списке.</div>`}
      <button class="btn ghost" id="hm">В меню</button></div>`, true);
  if (next) document.getElementById("nx").onclick = () => intro(next);
  document.getElementById("hm").onclick = home;
}

function fail() {
  const c = G.c;
  screen(`<div class="big-stamp">ДЕЛО РАЗВАЛИЛОСЬ</div>
    <div class="card">Три промаха — и начальство сняло тебя с дела. Не тыкай наугад: сначала найди фразу, которую можно проверить.</div>
    <div class="cta"><button class="btn" id="rt">Ещё раз</button><button class="btn ghost" id="hm">В меню</button></div>`, true);
  document.getElementById("rt").onclick = () => intro(c);
  document.getElementById("hm").onclick = home;
}

/* ---------- boot ---------- */
async function boot() {
  if (tg) {
    tg.ready(); tg.expand();
    if (can("6.1")) { tg.setHeaderColor("#0d1015"); tg.setBackgroundColor("#0d1015"); }
    if (can("7.7")) tg.disableVerticalSwipes();
    if (can("6.1")) tg.BackButton.onClick(home);
  }
  load();
  try {
    CASES = (await (await fetch("cases.json?v=" + Date.now())).json()).cases;
  } catch (e) {
    $app.innerHTML = `<div class="screen"><div class="card">Не загрузились дела. Проверь интернет и открой ещё раз.</div></div>`;
    return;
  }
  home();
}
boot();
