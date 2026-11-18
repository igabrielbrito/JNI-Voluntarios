// Gera a agenda (.ics) de cada pessoa a partir do app/state. Função pura.
// Uma agenda por celular, juntando as equipes. Título "JNI | Criatividade | Fotografia"; status na descrição.
// Recusada sai da agenda.

const TIPO = { culto: "Culto", disc: "Discipulado", com: "Comunhão", ext: "Evento externo", trein: "Treinamento", camp: "Acampamento" };
const DEF = { culto: ["20:00", "22:00"], disc: ["18:00", "19:30"], com: ["22:00", "00:30"] };
const EQUIPE = { fo: "Fotografia", st: "Storys" };
const DIA = 864e5;

const dig = t => String(t || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
const nome = e => {
  const tp = TIPO[e.t] || "Evento", ti = String(e.ti || "").trim();
  if (!ti) return tp;
  if (["culto", "disc", "com"].includes(e.t) && !ti.toLowerCase().includes(tp.toLowerCase())) return `${tp} ${ti}`;
  return ti;
};
const papeis = (team, k) => { const g = team.cfg && team.cfg.g; return g ? [g.r1 || "Captação", g.r2 || "Edição"] : k === "st" ? ["Captação", "Edição"] : ["Foto", "Edição"]; };
const esc = s => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const fold = l => { const o = []; let s = l; while (Buffer.byteLength(s) > 74) { let n = 74; while (Buffer.byteLength(s.slice(0, n)) > 74) n--; o.push(s.slice(0, n)); s = " " + s.slice(n); } o.push(s); return o.join("\r\n"); };
// horário de São Paulo (UTC-3, sem horário de verão) para UTC no formato do .ics
const ms = (iso, hm, addDay = 0) => { const [h, m] = hm.split(":").map(Number); return Date.parse(iso + "T00:00:00Z") + addDay * DIA + (h + 3) * 3600e3 + m * 6e4; };
const fmtU = t => new Date(t).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const utc = (iso, hm, addDay = 0) => fmtU(ms(iso, hm, addDay));
const dval = (iso, add = 0) => new Date(Date.parse(iso + "T12:00:00Z") + add * DIA).toISOString().slice(0, 10).replace(/-/g, "");

// devolve { tel: { nome, txt } }
export function agendas(state, hojeIso, site) {
  const out = {};
  const teams = state.teams || {};
  const multi = Object.keys(teams).length > 1;
  const desde = new Date(Date.parse(hojeIso + "T12:00:00Z") - 60 * DIA).toISOString().slice(0, 10);
  const stamp = "20260101T000000Z";
  // pessoas por celular (a mesma pessoa em duas equipes vira uma agenda)
  const gente = {};
  for (const [k, team] of Object.entries(teams)) for (const p of team.people || []) {
    const tel = dig(p.tel); if (!/^\d{10,11}$/.test(tel) || p.status === "saiu") continue;
    (gente[tel] = gente[tel] || { nome: p.name, recs: [] }).recs.push([k, p.id]);
  }
  for (const [tel, g] of Object.entries(gente)) {
    const ev = [];
    for (const [k, pid] of g.recs) {
      const team = teams[k], [r1, r2] = papeis(team, k), P = {};
      for (const p of team.people || []) P[p.id] = p;
      for (const e of team.events || []) {
        if (!e || !e.d || e.d < desde) continue;
        const fn = [];
        if ((e.f || []).includes(pid)) fn.push(r1);
        if ((e.e || []).includes(pid)) fn.push(r2);
        if (!fn.length) continue;
        const conf = !!(e.cf && e.cf[pid]);
        // quem mais está escalado, em todas as equipes
        const junto = [];
        for (const [k2, t2] of Object.entries(teams)) {
          const e2 = (t2.events || []).find(x => x.id === e.id); if (!e2) continue;
          const [a, b] = papeis(t2, k2), P2 = {};
          for (const p of t2.people || []) P2[p.id] = p;
          for (const [rl, ids] of [[a, e2.f || []], [b, e2.e || []]]) for (const id of ids) {
            const p = P2[id]; if (!p || (k2 === k && id === pid)) continue;
            junto.push(`${p.name} · ${rl}${multi ? " (" + (EQUIPE[k2] || k2) + ")" : ""} · ${e2.cf && e2.cf[id] ? "confirmado" : "pendente"}`);
          }
        }
        const d = DEF[e.t] || [];
        const st = e.st || d[0] || "", en = e.en || d[1] || "";
        const semG = !(team.cfg && team.cfg.g) && k !== "st";
        const titulo = "JNI | Criatividade | " + fn.map(x => semG && x === "Foto" ? "Fotografia" : x).join("/");
        const hr = st ? st.slice(0, 2).replace(/^0/, "") + "h" + (st.slice(3) === "00" ? "" : st.slice(3)) + (en ? "–" + en.slice(0, 2).replace(/^0/, "") + "h" + (en.slice(3) === "00" ? "" : en.slice(3)) : "") : "";
        const desc = [
          nome(e) + (hr ? " · " + hr : ""),
          "Status: " + (conf ? "confirmada" : "pendente. Abra o app para confirmar ou recusar."),
          `Função: ${fn.join(" e ")}${multi ? " · " + (EQUIPE[k] || k) : ""}`,
          junto.length ? "Escalados junto:\n" + junto.map(x => "- " + x).join("\n") : "",
          site ? "App: " + site : ""
        ].filter(Boolean).join("\n\n");
        const L = ["BEGIN:VEVENT", `UID:${k}-${e.id}-${pid}@jni-voluntarios`, `DTSTAMP:${stamp}`];
        if (st) {
          L.push(`DTSTART:${utc(e.d, st)}`);
          if (en) { const vira = en <= st ? 1 : 0; L.push(`DTEND:${utc(e.d, en, vira)}`); }
          else L.push(`DTEND:${fmtU(ms(e.d, st) + 2 * 3600e3)}`);
        } else {
          L.push(`DTSTART;VALUE=DATE:${dval(e.d)}`, `DTEND;VALUE=DATE:${dval(e.d, 1)}`);
        }
        L.push(`SUMMARY:${esc(titulo)}`, `DESCRIPTION:${esc(desc)}`, `STATUS:${conf ? "CONFIRMED" : "TENTATIVE"}`, "TRANSP:OPAQUE");
        if (site) L.push(`URL:${site}`);
        L.push("END:VEVENT");
        ev.push([e.d + st, L]);
      }
    }
    ev.sort((a, b) => a[0].localeCompare(b[0]));
    const head = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//JNI//Voluntarios//PT-BR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
      `X-WR-CALNAME:${esc("JNI · Minhas escalas")}`, "X-WR-TIMEZONE:America/Sao_Paulo", `X-WR-CALDESC:${esc("Escalas de " + g.nome + " no JNI Voluntários")}`,
      "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"];
    const txt = [...head, ...ev.flatMap(x => x[1]), "END:VCALENDAR"].map(fold).join("\r\n") + "\r\n";
    out[tel] = { nome: g.nome, txt };
  }
  return out;
}
