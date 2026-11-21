// Decide quais notificações mandar. Função pura: não lê nem grava nada.
// state: o app/state (já em objeto). sent: {chave: timestamp} do que já foi enviado.
// now: Date. init: true na primeira rodada (só registra o que já existe, sem mandar nada).

const TIPO = { culto: "Culto", disc: "Discipulado", com: "Comunhão", ext: "Evento externo", trein: "Treinamento", camp: "Acampamento" };
const HORA = { culto: "20:00", disc: "18:00", com: "22:00" };
const FIM = { culto: "22:00", disc: "19:30", com: "00:30" };
const EQUIPE = { fo: "Fotografia", st: "Storys" };
const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const SEM = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export const LEMBRETE_HORA = 19;          // lembretes de 3 dias antes e da véspera a partir das 19h
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
const nome = e => {
  const tp = TIPO[e.t] || "Evento", ti = String(e.ti || "").trim();
  if (!ti) return tp;
  if (["culto", "disc", "com"].includes(e.t) && !ti.toLowerCase().includes(tp.toLowerCase())) return `${tp} ${ti}`;
  return ti;
};
const primeiro = p => String(p.name || "").trim().split(/\s+/)[0] || "Alguém";

function papeis(team, k) {
  const g = team.cfg && team.cfg.g;
  if (g) return [g.r1 || "Captação", g.r2 || "Edição"];
  return k === "st" ? ["Captação", "Edição"] : ["Foto", "Edição"];
}

// quem lidera cada equipe: "Líder na equipe" + acessos fixados (adm vê todas, lid as dele)
function lideres(state) {
  // Avisos da equipe vão para quem lidera AQUELA equipe:
  // - "Líder na equipe" ligado no cadastro dela;
  // - acesso Líder com a equipe marcada;
  // - acesso Admin só nas equipes em que a pessoa está cadastrada
  //   (admin que não está em nenhuma equipe recebe de todas).
  const L = {};
  const acc = (state.auth && state.auth.acc) || {};
  const teams = state.teams || {};
  const membro = {};
  for (const [k, team] of Object.entries(teams)) for (const p of team.people || []) {
    const tel = dig(p.tel); if (!tel || p.status === "saiu") continue;
    (membro[tel] = membro[tel] || new Set()).add(k);
  }
  for (const [k, team] of Object.entries(teams)) {
    const s = new Set();
    for (const p of team.people || []) {
      const tel = dig(p.tel);
      if (!tel || p.status === "saiu") continue;
      const a = acc[tel];
      if (a && (a.r === "none" || a.r === "vol")) continue;
      if (p.lider || (a && a.r === "adm") || (a && a.r === "lid" && (a.t || []).includes(k))) s.add(tel);
    }
    for (const [tel, a] of Object.entries(acc)) {
      if (!/^\d{10,11}$/.test(tel) || !a) continue;
      if (a.r === "lid" && (a.t || []).includes(k)) s.add(tel);
      if (a.r === "adm" && !membro[tel]) s.add(tel);
    }
    L[k] = s;
  }
  return L;
}

const minutos = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); return m ? +m[1] * 60 + +m[2] : null; };
// Evento de dia inteiro: sem horário de início ou com 8 horas ou mais. Nele não vai o aviso de 3h antes.
export function diaInteiro(e) {
  const ini = minutos(e.st || HORA[e.t]);
  if (ini == null) return true;
  let fim = minutos(e.en || FIM[e.t]);
  if (fim == null) return false;
  if (fim <= ini) fim += 24 * 60;
  return fim - ini >= 8 * 60;
}

// quem chamar no lugar: ativo, livre no dia, não escalado nem recusou, com menos escalas no mês
export function sugestoes(team, e, fora) {
  const mes = e.d.slice(0, 7), cont = {};
  for (const x of team.events || []) if (x.d && x.d.slice(0, 7) === mes) for (const id of [...(x.f || []), ...(x.e || [])]) cont[id] = (cont[id] || 0) + 1;
  const ocup = new Set([...(e.f || []), ...(e.e || []), ...Object.keys(e.rx || {}), fora]);
  for (const x of team.events || []) if (x.d === e.d && x.id !== e.id) for (const id of [...(x.f || []), ...(x.e || [])]) ocup.add(id);
  return (team.people || [])
    .filter(p => (p.status || "ativo") === "ativo" && !p.lider && !ocup.has(p.id) && !(p.off || []).some(o => o && o.a <= e.d && e.d <= (o.b || o.a)))
    .sort((a, b) => (cont[a.id] || 0) - (cont[b.id] || 0) || String(a.name).localeCompare(String(b.name)))
    .slice(0, 3).map(primeiro);
}

export function plan(state, sent, now, init) {
  const { iso: hoje, h } = sp(now);
  const minAgora = Math.floor(((now.getTime() - 3 * 3600e3) % DIA + DIA) % DIA / 6e4);
  const em = n => isoAdd(hoje, n);
  const quieto = h >= SILENCIO[0] || h < SILENCIO[1];
  const out = [];
  const marcar = {};
  const L = lideres(state);
  const T = now.getTime();
  const add = (key, tels, title, body) => {
    if (sent[key] || marcar[key]) return;
    marcar[key] = T;
    if (init) return;
    for (const tel of tels) if (tel) out.push({ tel, title, body, key });
  };
  const multi = Object.keys(state.teams || {}).length > 1;

  for (const [k, team] of Object.entries(state.teams || {})) {
    const P = {};
    for (const p of team.people || []) P[p.id] = p;
    const [r1, r2] = papeis(team, k);
    const eq = multi ? " · " + (EQUIPE[k] || k) : "";
    for (const e of team.events || []) {
      if (!e || !e.d || e.d < hoje) continue;
      const hIni = e.st || HORA[e.t] || "";
      const hora = fmtH(hIni);
      const quando = fmtD(e.d) + (hora ? " · " + hora : "");
      const pap = {};
      for (const [papel, ids] of [[r1, e.f || []], [r2, e.e || []]]) for (const pid of ids) (pap[pid] = pap[pid] || []).includes(papel) || pap[pid].push(papel);
      for (const pid of Object.keys(pap)) {
        const p = P[pid];
        if (!p || p.status === "saiu") continue;
        const tel = dig(p.tel);
        const conf = !!(e.cf && e.cf[pid]);
        const funcao = pap[pid].join(" e ");
        const base = `${k}|${e.id}|${pid}`;
        let agora = false;

        // 1. pedido: você foi escalado (fora do silêncio)
        const kEsc = `esc|${base}`;
        if (!sent[kEsc] && !(quieto && !init)) {
          agora = !init;
          add(kEsc, [tel], "Você foi escalado 📸", `${nome(e)} · ${quando} · ${funcao}${eq}. Toque para confirmar ou recusar.`);
        }
        const tEsc = sent[kEsc] || marcar[kEsc];

        // 2. cobrança semanal enquanto não responder (só das 10h às 21h, e se o evento ainda está a mais de 3 dias)
        if (!conf && tEsc && !init && h >= 10 && h < 21 && e.d > em(3)) {
          const sem = Math.floor((T - tEsc) / (7 * DIA));
          if (sem >= 1 && sem <= 3) add(`nag|${base}|${sem}`, [tel], "Falta a sua resposta ⏳", `Você foi escalado para ${nome(e)} · ${quando} · ${funcao} e ainda não respondeu. Toque para confirmar ou recusar.`);
          // depois de 3 cobranças, avisa a liderança uma vez
          if (sem >= 4) add(`sem|${base}`, [...(L[k] || [])].filter(t => t !== tel), `${primeiro(p)} não responde ⏳`, `${nome(e)} · ${quando} · ${funcao}. Já foram 3 lembretes sem resposta. Vale chamar no WhatsApp.`);
        }

        // 3. três dias antes, a partir das 19h
        if (e.d === em(3) && h >= LEMBRETE_HORA && (!quieto || init)) {
          add(`d3|${base}`, agora ? [] : [tel],
            conf ? "Lembrete da escala 📅" : "Você ainda não respondeu ⏳",
            conf ? `${SEMANA[new Date(e.d + "T12:00:00Z").getUTCDay()]} você serve: ${nome(e)}${hora ? " às " + hora : ""} · ${funcao}.`
                 : `Você está escalado para ${nome(e)} · ${quando} · ${funcao} e ainda não confirmou. Toque para responder.`);
        }

        // 4. véspera, a partir das 19h
        if (e.d === em(1) && h >= LEMBRETE_HORA && (!quieto || init)) {
          add(`d1|${base}`, agora ? [] : [tel], "Amanhã você serve 🙌", `${nome(e)}${hora ? " às " + hora : ""} · ${funcao}.${conf ? "" : " Ainda falta confirmar."}`);
        }

        // 5. no dia, 3 horas antes (não vale para evento de dia inteiro)
        const ini = minutos(hIni);
        if (e.d === hoje && ini != null && !diaInteiro(e) && minAgora >= ini - 180 && minAgora < ini) {
          add(`d0|${base}`, [tel], `Hoje às ${hora} 📸`, `${nome(e)} · ${funcao}. Bom serviço!`);
        }
      }

      // 6. liderança: alguém confirmou pelo app
      for (const [pid, v] of Object.entries(e.cfs || {})) {
        const p = P[pid]; if (!p || !v) continue;
        const tels = [...(L[k] || [])].filter(t => t !== dig(p.tel));
        if (!(quieto && !init)) add(`cf|${k}|${e.id}|${pid}|${v.at || ""}`, tels, `${primeiro(p)} confirmou ✅`, `${nome(e)} · ${fmtD(e.d)}${eq}`);
      }
      // 7. liderança: alguém recusou
      for (const [pid, v] of Object.entries(e.rx || {})) {
        const p = P[pid]; if (!p || !v) continue;
        const tels = [...(L[k] || [])].filter(t => t !== dig(p.tel));
        const sug = sugestoes(team, e, pid);
        if (!(quieto && !init)) add(`rx|${k}|${e.id}|${pid}|${v.at || ""}`, tels, `${primeiro(p)} recusou ⚠️`, `${nome(e)} · ${fmtD(e.d)}${v.m ? " · “" + String(v.m).slice(0, 80) + "”" : ""}.${sug.length ? " Sugestões: " + sug.join(", ") + "." : ""} Toque para escalar outra pessoa.`);
      }
    }

    // 8. feedback enviado para a pessoa
    for (const f of team.fbs || []) {
      if (!f || !f.id || !f.pid) continue;
      if (f.d && f.d < em(-14)) continue;
      const p = P[f.pid]; if (!p) continue;
      if (!(quieto && !init)) add(`fb|${k}|${f.id}`, [dig(p.tel)], "Seu feedback chegou 💬", `${(EQUIPE[k] || "JNI")}: ${primeiro(p)}, seu feedback já está disponível. Toque para ver.`);
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
