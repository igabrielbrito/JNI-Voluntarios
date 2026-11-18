# JNI Voluntários

App de escalas das equipes de voluntários da JNI (Fotografia e Storys).

- Site: GitHub Pages deste repositório.
- Dados: Firebase Firestore (projeto `jni-voluntarios`). Nada de pessoas, escalas ou fotos fica neste repositório.
- Para importar um backup: abra o site com `?importar` no fim do endereço.

Versão atual: v2.13.0 (build 62).

Agenda automática: o robô gera `cal/<código>.ics` para cada pessoa (código secreto, registrado em `cal/<celular>` no Firestore) e publica aqui. Título "JNI | Criatividade | Fotografia" (ou a função); status na descrição; recusada sai.

Notificações: `.github/workflows/notificacoes.yml` roda `scripts/notify.mjs` a cada 15 minutos (pedido de escala, cobrança semanal sem resposta, lembretes 3 dias antes e na véspera às 19h e 3h antes no dia, feedback enviado, confirmações e recusas para líderes). Precisa do segredo `FIREBASE_SA` (chave da conta de serviço do Firebase).
