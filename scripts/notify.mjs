// Robô de notificações do JNI Voluntários. Roda no GitHub Actions a cada 15 minutos.
// Lê o app/state no Firestore, decide os avisos (plan.mjs) e manda pelo Firebase Cloud Messaging.
import admin from "firebase-admin";
import { plan, podar, sp } from "./plan.mjs";
import { agendas } from "./ics.mjs";
import { createHmac } from "node:crypto";
import fs from "node:fs";

const SITE = process.env.SITE_URL || "https://igabrielbrito.github.io/JNI-Voluntarios/";
const SECO = process.env.DRY_RUN === "1";

const sa = JSON.parse(process.env.FIREBASE_SA || "{}");
if (!sa.project_id) { console.error("FIREBASE_SA ausente ou inválido."); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const snap = await db.doc("app/state").get();
if (!snap.exists) { console.log("Sem dados no app/state. Nada a fazer."); process.exit(0); }
const raw = snap.data();
const state = typeof raw.j === "string" ? JSON.parse(raw.j) : raw;

const rRef = db.doc("robot/state");
const rSnap = await rRef.get();
const robo = rSnap.exists ? rSnap.data() : {};
const sent = robo.sent ? JSON.parse(robo.sent) : {};
const init = !rSnap.exists || robo.v !== 2;   // v2: formato novo das chaves
const now = new Date();

const { out, marcar } = plan(state, sent, now, init);
console.log(init ? `Primeira rodada: ${Object.keys(marcar).length} avisos registrados sem enviar.` : `${out.length} notificações para mandar.`);

// tokens por celular
const tk = {};
(await db.collection("push").get()).forEach(d => { const t = d.data().tel; if (t) (tk[t] = tk[t] || []).push(d.id); });

let ok = 0, falha = 0, semApp = 0;
const ruins = new Set();
for (const n of out) {
  const tokens = tk[n.tel] || [];
  if (!tokens.length) { semApp++; continue; }
  if (SECO) { console.log("[teste]", n.tel.slice(-4), n.title, "|", n.body); continue; }
  const r = await admin.messaging().sendEachForMulticast({
    tokens,
    webpush: {
      notification: { title: n.title, body: n.body, icon: SITE + "icons/icon-192.png", badge: SITE + "icons/icon-192.png", tag: n.key },
      fcmOptions: { link: SITE + (n.key.startsWith("fb|") ? "?abrir=feedback" : "") }
    }
  });
  r.responses.forEach((x, i) => {
    if (x.success) ok++;
    else {
      falha++;
      const c = x.error && x.error.code;
      console.log("Falha:", n.tel.slice(-4), c, x.error && x.error.message);
      if (c === "messaging/registration-token-not-registered" || c === "messaging/invalid-registration-token") ruins.add(tokens[i]);
    }
  });
}
// testes pedidos pelo administrador (sai na hora, mesmo à noite)
let testes = 0;
for (const d of (await db.collection("testes").get()).docs) {
  const x = d.data();
  if (x.st) { if (now.getTime() - (x.done || x.at || 0) > 7 * 864e5) await d.ref.delete(); continue; }
  const tokens = tk[x.tel] || [];
  if (!tokens.length) { await d.ref.update({ st: "sem", done: now.getTime() }); continue; }
  if (SECO) { console.log("[teste]", x.tel.slice(-4), "notificação de teste"); continue; }
  const r = await admin.messaging().sendEachForMulticast({
    tokens,
    webpush: {
      notification: { title: "Notificação de teste 🔔", body: `Tudo pronto${x.nm ? ", " + x.nm : ""}! As notificações do JNI Voluntários estão funcionando neste celular.`, icon: SITE + "icons/icon-192.png", badge: SITE + "icons/icon-192.png", tag: "teste-" + d.id },
      fcmOptions: { link: SITE }
    }
  });
  const errs = [];
  r.responses.forEach((y, i) => { if (!y.success) { const c = y.error && y.error.code; errs.push(c + ": " + (y.error && y.error.message || "").slice(0, 160)); console.log("Falha no teste:", x.tel.slice(-4), c, y.error && y.error.message); if (c === "messaging/registration-token-not-registered" || c === "messaging/invalid-registration-token") ruins.add(tokens[i]); } else console.log("Teste entregue:", x.tel.slice(-4)); });
  await d.ref.update({ st: r.successCount ? "ok" : "falha", done: now.getTime(), n: r.successCount, err: errs.join(" | ").slice(0, 500) });
  testes++;
}
for (const t of ruins) await db.collection("push").doc(t).delete();

// cópia de segurança: uma por dia, últimos 30 dias
let bkl = Array.isArray(robo.bkl) ? robo.bkl : [];
const hojeBk = sp(now).iso;
if (!SECO && !bkl.includes(hojeBk)) {
  await db.doc("backups/" + hojeBk).set({ j: typeof raw.j === "string" ? raw.j : JSON.stringify(state), at: now.getTime() });
  bkl = [...bkl, hojeBk].sort();
  while (bkl.length > 30) { const velho = bkl.shift(); await db.doc("backups/" + velho).delete(); }
  console.log("Cópia de segurança do dia salva:", hojeBk);
}

if (!SECO) {
  const novo = podar(Object.assign({}, sent, marcar), now);
  await rRef.set({ v: 2, sent: JSON.stringify(novo), at: now.getTime(), bkl });
}
console.log(`Testes: ${testes} · enviadas: ${ok} · falhas: ${falha} · tokens removidos: ${ruins.size} · sem app instalado: ${semApp}`);

// ---------- agenda assinável de cada pessoa ----------
// Arquivos em cal/<código>.ics, publicados pelo GitHub Pages. O código é secreto (derivado da chave do robô),
// e o app descobre o seu lendo cal/<celular> no Firestore.
if (!SECO && process.env.CAL_DIR) {
  const dir = process.env.CAL_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const cod = tel => createHmac("sha256", (sa.private_key_id || "") + "|jni-cal").update(tel).digest("hex").slice(0, 24);
  const A = agendas(state, sp(now).iso, SITE);
  const vivos = new Set();
  let mud = 0;
  const calRefs = (await db.collection("cal").get()).docs.reduce((o, d) => (o[d.id] = d.data().t, o), {});
  for (const [tel, a] of Object.entries(A)) {
    const c = cod(tel), f = `${dir}/${c}.ics`;
    vivos.add(c + ".ics");
    const old = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
    if (old !== a.txt) { fs.writeFileSync(f, a.txt); mud++; }
    if (calRefs[tel] !== c) await db.collection("cal").doc(tel).set({ t: c, at: now.getTime() });
  }
  for (const f of fs.readdirSync(dir)) if (f.endsWith(".ics") && !vivos.has(f)) { fs.unlinkSync(`${dir}/${f}`); mud++; }
  console.log(`Agendas: ${Object.keys(A).length} pessoas · ${mud} arquivos mudaram`);
}
