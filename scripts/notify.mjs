// Robô de notificações do JNI Voluntários. Roda no GitHub Actions a cada 15 minutos.
// Lê o app/state no Firestore, decide os avisos (plan.mjs) e manda pelo Firebase Cloud Messaging.
import admin from "firebase-admin";
import { plan, podar } from "./plan.mjs";

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
const init = !rSnap.exists;
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
      fcmOptions: { link: SITE }
    }
  });
  r.responses.forEach((x, i) => {
    if (x.success) ok++;
    else {
      falha++;
      const c = x.error && x.error.code;
      if (c === "messaging/registration-token-not-registered" || c === "messaging/invalid-registration-token" || c === "messaging/invalid-argument") ruins.add(tokens[i]);
      else console.log("Falha:", c, x.error && x.error.message);
    }
  });
}
for (const t of ruins) await db.collection("push").doc(t).delete();

if (!SECO) {
  const novo = podar(Object.assign({}, sent, marcar), now);
  await rRef.set({ sent: JSON.stringify(novo), at: now.getTime() });
}
console.log(`Enviadas: ${ok} · falhas: ${falha} · tokens removidos: ${ruins.size} · sem app instalado: ${semApp}`);
