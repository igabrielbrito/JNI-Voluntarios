# JNI Voluntários

App de escalas das equipes de voluntários da JNI (Fotografia e Storys).

- Site: GitHub Pages deste repositório.
- Dados: Firebase Firestore (projeto `jni-voluntarios`). Nada de pessoas, escalas ou fotos fica neste repositório.
- Para importar um backup: abra o site com `?importar` no fim do endereço.

Versão atual: v2.9.0 (build 55).

Notificações: `.github/workflows/notificacoes.yml` roda `scripts/notify.mjs` a cada 15 minutos (aviso de escala, lembrete na véspera às 18h, confirmações e recusas para líderes). Precisa do segredo `FIREBASE_SA` (chave da conta de serviço do Firebase).
