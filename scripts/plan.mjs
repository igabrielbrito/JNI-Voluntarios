// Decide quais notificações mandar. Função pura: não lê nem grava nada.
// state: o app/state (já em objeto). sent: {chave: timestamp} do que já foi enviado.
// now: Date. init: true na primeira rodada (só registra o que já existe, sem mandar nada).

const TIPO = { culto: "Culto", disc: "Discipulado", com: "Comunhão", ext: "Evento externo", trein: "Treinamento", camp: "Acampamento" };
const HORA = { culto: "20:00", disc: "18:00", com: "22:00" };
const EQUIPE = { fo: "Fotografia", st: "Storys" };
const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const SEM = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export const LEMBRETE_HORA = 18;          // lembrete da véspera a partir das 18h
export const SILENCIO = [22, 8];          // não manda aviso de escala entre 22h e 8h
const DIA = 864e5;

// data/hora no fuso de São Paulo (UTC-3, sem horário de verão)
export function sp(now) {
  const t = new Date(now.getTime() - 3 * 3600e3);
  return { iso: t.toISOString().slice(0, 10), h: t.getUTCHours() };
}
const isoAdd = (iso, n) => new Date(Date.parse(iso + "T12:00:00Z") + n * DIA).toISOString().slice(0, 10);
const dig = t => String(t || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
const fmtD = iso => { const d = new Date(iso + "T12:00:00Z"); return `${SEM[d.getUTCDay()]}, ${d.getUTCDate()} ${MES[d.getUTCMonth()]}`; };
const fmtH = t => t ? t.slice(0, 2).replace(/^0/, "") + "h" + (t.slice(3) === "00" ? "" : t.slice(3)) : "";
const nome = e => e.ti || TIPO[e.t] || "Evento";
const primeiro = p => String(p.name || "").trim().split(/\s+/)[0] || "Alguém";

function papeis(team, k) {
  const g = team.cfg && team.cfg.g;
  if (g) return [g.r1 || "Captação", g.r2 || "Edição"];
  return k === "st" ? ["Captação", "Edição"] : ["Foto", "Edição"];
}

// quem lidera cada equipe: "Líder na equipe" + acessos fixados (adm vê todas, lid as dele)
function lideres(state) {
  const L = {};
  const acc = (state.auth && state.auth.acc) || {};
  for (const [k, team] of Object.entries(state.teams || {})) {
    const s = new Set();
    for (const p of team.people || []) {
      const tel = dig(p.tel);
      if (!tel || p.status === "saiu") continue;
      const a = acc[tel];
      if (a && a.r === "none") continue;
      if (a && a.r === "vol") continue;
      if (p.lider || (a && a.r === "adm") || (a && a.r === "lid" && (a.t || []).includes(k))) s.add(tel);
    }
    for (const [tel, a] of Object.entries(acc)) {
      if (!/^\d{10,11}$/.test(tel)) continue;
      if (a.r === "adm" || (a.r === "lid" && (a.t || []).includes(k))) s.add(tel);
    }
    L[k] = s;
  }
  return L;
}

export function plan(state, sent, now, init) {
  const { iso: hoje, h } = sp(now);
  const amanha = isoAdd(hoje, 1);
  const quieto = h >= SILENCIO[0] || h < SILENCIO[1];
  const out = [];           // {tel, title, body, key}
  const marcar = {};        // chaves para registrar como enviadas
  const L = lideres(state);
  const add = (key, tels, title, body) => {
    if (sent[key] || marcar[key]) return;
    marcar[key] = now.getTime();
    if (init) return;
    for (const tel of tels) if (tel) out.push({ tel, title, body, key });
  };

  for (const [k, team] of Object.entries(state.teams || {})) {
    const P = {};
    for (const p of team.people || []) P[p.id] = p;
    const [r1, r2] = papeis(team, k);
    const multi = Object.keys(state.teams).length > 1;
    for (const e of team.events || []) {
      if (!e || !e.d || e.d < hoje) continue;
      const hora = fmtH(e.st || HORA[e.t] || "");
      const quando = fmtD(e.d) + (hora ? " · " + hora : "");
      const vagas = [["f", r1, e.f || []], ["e", r2, e.e || []]];
      const pap = {};
      for (const [, papel, ids] of vagas) for (const pid of ids) (pap[pid] = pap[pid] || []).includes(papel) || pap[pid].push(papel);
      for (const [slot, papel, ids] of vagas) {
        for (const pid of ids) {
          const p = P[pid];
          if (!p || p.status === "saiu") continue;
          const tel = dig(p.tel);
          // 1. você foi escalado
          const kEsc = `esc|${k}|${e.id}|${pid}|${slot}`;
          let agora = false;
          if (!sent[kEsc] && !(quieto && !init)) {
            agora = !init;
            add(kEsc, [tel], "Você foi escalado 📸", `${nome(e)} · ${quando} · ${papel}${multi ? " (" + (EQUIPE[k] || k) + ")" : ""}. Toque para confirmar.`);
          }
          // 2. lembrete na véspera
          if (e.d === amanha && h >= LEMBRETE_HORA && (!quieto || init)) {
            const kLem = `lem|${k}|${e.id}|${pid}`;
            const conf = e.cf && e.cf[pid];
            // acabou de receber o aviso de escala: não manda o lembrete junto
            add(kLem, agora ? [] : [tel], "Amanhã você serve 🙌", `${nome(e)}${hora ? " às " + hora : ""} · ${pap[pid].join(" e ")}.${conf ? "" : " Ainda falta confirmar."}`);
          }
        }
      }
      // 3. para a liderança: confirmou / recusou (feito pela própria pessoa)
      for (const [pid, v] of Object.entries(e.cfs || {})) {
        const p = P[pid]; if (!p || !v) continue;
        const kc = `cf|${k}|${e.id}|${pid}|${v.at || ""}`;
        const tels = [...(L[k] || [])].filter(t => t !== dig(p.tel));
        if (!(quieto && !init)) add(kc, tels, `${primeiro(p)} confirmou ✅`, `${nome(e)} · ${fmtD(e.d)}${multi ? " · " + (EQUIPE[k] || k) : ""}`);
      }
    }
    // recusas ficam também em eventos já sem a pessoa (rx); não dependem da vaga
    for (const e of team.events || []) {
      if (!e || !e.d || e.d < hoje) continue;
      for (const [pid, v] of Object.entries(e.rx || {})) {
        const p = P[pid]; if (!p || !v) continue;
        const kr = `rx|${k}|${e.id}|${pid}|${v.at || ""}`;
        const tels = [...(L[k] || [])].filter(t => t !== dig(p.tel));
        if (!(quieto && !init)) add(kr, tels, `${primeiro(p)} recusou ⚠️`, `${nome(e)} · ${fmtD(e.d)}${v.m ? " · “" + String(v.m).slice(0, 80) + "”" : ""}. Toque para escalar outra pessoa.`);
      }
    }
  }
  return { out, marcar };
}

// apaga chaves com mais de 90 dias para o registro não crescer sem fim
export function podar(sent, now) {
  const lim = now.getTime() - 90 * DIA, o = {};
  for (const [k, t] of Object.entries(sent)) if (t >= lim) o[k] = t;
  return o;
}
