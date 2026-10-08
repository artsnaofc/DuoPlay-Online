# 🎮 DuoPlay Online

> Plataforma web de jogos multiplayer para jogar, competir e evoluir com amigos.

[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Supabase](https://img.shields.io/badge/Supabase-Backend-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com/)
[![Vercel](https://img.shields.io/badge/Vercel-Deploy-000000?logo=vercel&logoColor=white)](https://vercel.com/)
[![PWA](https://img.shields.io/badge/PWA-Ready-5A0FC8?logo=pwa&logoColor=white)](https://web.dev/progressive-web-apps/)

---

## 🕹️ Sobre

O **DuoPlay Online** é uma plataforma de jogos multiplayer para navegador, criada para partidas rápidas entre jogadores, interação social e progressão.

A plataforma possui uma infraestrutura multiplayer compartilhada, permitindo adicionar novos jogos sem precisar recriar todo o sistema.

---

## ✨ Recursos

- 🎮 Jogos multiplayer
- 👥 Salas privadas
- 🔎 Matchmaking
- 🔄 Rematch
- 🟢 Presença online/offline
- 👤 Perfis de jogadores
- 🤝 Sistema de amigos
- 💬 Chat privado
- ✉️ Convites para partidas
- 🔔 Notificações
- 📜 Histórico de partidas
- 📊 Estatísticas
- 🏆 Ranking
- ⭐ XP e níveis
- 🥇 Conquistas e badges
- 📱 Interface responsiva
- 📲 PWA

---

## 🎮 Jogos

### ❌⭕ Tic-Tac-Toe

Primeiro jogo multiplayer da plataforma.

- Partidas 1v1
- Multiplayer em tempo real
- Reconexão
- Histórico
- Rematch
- Ranking
- XP e progressão

### 🚧 Próximos jogos

A plataforma está sendo preparada para receber novos jogos multiplayer.

- 🐍 Cobrinha competitiva
- 🏓 Pong multiplayer
- 🎮 Outros jogos futuramente

---

## 👥 Social

O DuoPlay possui recursos para conectar jogadores:

- Adicionar amigos
- Aceitar e recusar solicitações
- Buscar jogadores
- Ver perfis públicos
- Ver status online/offline
- Convidar amigos para jogar
- Conversar por chat privado

---

## 🏆 Progressão

Os jogadores podem acompanhar sua evolução através de:

- Vitórias
- Derrotas
- Empates
- Taxa de vitória
- Sequências de vitórias
- Melhor sequência
- Rating
- Ranking
- XP
- Níveis
- Conquistas
- Badges

A progressão é integrada às partidas e preparada para futuras funcionalidades competitivas.

---

## 🏗️ Tecnologia

### Frontend

- React
- TypeScript
- Vite
- Tailwind CSS
- PWA

### Backend

- Supabase Auth
- PostgreSQL
- Supabase Realtime
- PostgreSQL RPC
- Row Level Security (RLS)

### Deploy

- Vercel
- GitHub

---

## 🔐 Segurança

O DuoPlay utiliza validações no backend para proteger as partidas e os dados dos jogadores.

Entre os recursos utilizados:

- Autenticação
- RLS
- RPCs
- Validação server-side
- Controle de permissões
- Operações idempotentes
- Sincronização e recuperação de partidas

Resultados de partidas, estatísticas, ranking e progressão não dependem de valores enviados diretamente pelo cliente.

---

## 📱 Responsivo e PWA

O projeto possui abordagem **mobile-first**, funcionando em:

- 📱 Celulares
- 📲 Tablets
- 💻 Notebooks
- 🖥️ Desktops

Também possui suporte a PWA para instalação em dispositivos compatíveis.

---

## 🧪 Testes

O projeto possui testes automatizados para diferentes áreas da aplicação, incluindo:

- Multiplayer
- Matchmaking
- Rematch
- Chat
- Notificações
- Estatísticas
- Ranking
- Progressão
- Segurança
- Validação dos jogos

Comandos principais:

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```
