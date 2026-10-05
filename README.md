

<div align="center">

  <!-- MHORPIX LOGO -->
  <img src="assets/logo.png" alt="Mhorpix Logo" width="200" height="200" style="border-radius: 20px; margin-bottom: 15px;" />

  #  Mhorpix

  **The ultimate, high-performance Discord music bot designed for uncompromised audio quality and infinite scale.**

  [![Version](https://img.shields.io/github/v/release/ShadowByte01/Mhorpix?style=for-the-badge&color=ff69b4)](https://github.com/ShadowByte01/Mhorpix/releases)
  [![License](https://img.shields.io/badge/License-Xentara%20OSL-blue.svg?style=for-the-badge&color=8a2be2)](#license)
  [![Downloads](https://img.shields.io/github/downloads/ShadowByte01/Mhorpix/total?style=for-the-badge&color=00ffcc)](https://github.com/ShadowByte01/Mhorpix/releases)

  <br />

  ### 🛠️ Built With

  [![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![Java (Lavalink)](https://img.shields.io/badge/Java-%23ED8B00.svg?style=for-the-badge&logo=openjdk&logoColor=white)](https://java.com/)
  [![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
  [![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)](https://postgresql.org)
  [![Redis](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io)
  [![Discord.js](https://img.shields.io/badge/discord.js-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.js.org/)

</div>

---

## 🌟 Overview

Mhorpix goes beyond traditional music bots by delivering crystal clear audio streams backed by a highly resilient microservice architecture. Whether you're running it for a small community or scaling across thousands of servers, Mhorpix seamlessly handles hybrid sharding, caching, and state persistence natively through Docker.

### 🚀 Highlights
- **Unrivaled Audio:** Powered by [Lavalink](https://github.com/lavalink-devs/Lavalink) and [Shoukaku](https://github.com/shipgirlproject/Shoukaku).
- **Infinite Scalability:** Hybrid sharding with centralized Redis caching and PostgreSQL persistence.
- **Audio Engineering:** Built-in Bassboost, Nightcore, Vaporwave, 8D, Tremolo, and parametric EQ.
- **Advanced Ecosystem:** Autoplay, AI Playlist generation, Spotify integration, and fairplay queue management.

---

## 📦 Releases & Downloads

Ready to deploy? Grab the latest pre-compiled build directly from our releases!

<div align="center">

  [![Download Latest Release](https://img.shields.io/badge/Download-Latest_Release-ffb6c1?style=for-the-badge&logo=github&logoColor=black)](https://github.com/ShadowByte01/Mhorpix/releases/latest)
  [![Download Source](https://img.shields.io/badge/Download-Source_Code-lightgrey?style=for-the-badge&logo=files&logoColor=black)](https://github.com/ShadowByte01/Mhorpix/archive/refs/heads/main.zip)

</div>

---

## 🐳 Docker Deployment (Recommended)

Mhorpix embraces a fully containerized architecture. We don't expose your sensitive `.env` tokens, but our standard `docker-compose.yml` seamlessly spins up your environment linking our TypeScript Bot, our database, and our cache.

```yaml
services:
  mhorpix:
    build: .
    container_name: mhorpix-bot
    restart: unless-stopped
    env_file: .env
    environment:
      - NODE_ENV=production
    depends_on:
      - pg
      - redis
```

**To start the bot:**
```bash
cp .env.example .env
# Fill out your .env with your secure tokens!
docker compose up -d --build
```

---

## 🦖 Pterodactyl Guide

1. Download the [Latest Release](https://github.com/ShadowByte01/Mhorpix/releases/latest/download/mhorpix.zip).
2. Set your server software to **Node.js 24**, with the startup file: `dist/index.js`.
3. Extract the files directly into your root directory (`/`).
4. Rename `.env.example` to `.env` and enter your credentials.
5. Start your server!

---

## 🎧 Command Arsenal

| Category | Commands |
| :--- | :--- |
| **Music** | `/play`, `/pause`, `/resume`, `/skip`, `/previous`, `/queue`, `/nowplaying`, `/seek`, `/volume`, `/shuffle`, `/loop`, `/filter`, `/stop`, `/clearqueue` |
| **Library** | `/favourite`, `/favourites`, `/history`, `/playlistcreate`, `/playlistadd`, `/playlisttracks`, `/playlistlist`, `/playlistai` |
| **Config** | `/config`, `/twentyfour_seven`, `/defaultvolume`, `/defaultautoplay`, `/defaultfairplay`, `/fairplayrole` |
| **General** | `/help`, `/botinfo`, `/ping`, `/support`, `/invite`, `/vote`, `/links`, `/documentation` |

---

## 🤝 Contributing

Read our [CONTRIBUTING.md](CONTRIBUTING.md) to understand our code of conduct and pull request process. Bugs should be reported directly to our [Issues Tracker](https://github.com/ShadowByte01/Mhorpix/issues).

---

## Acknowledgements

- **[NodeLink](https://github.com/PerformanC/NodeLink)**: For lyrics integration via `/lyrics`.

---

<div align="center">

**Made by Xentara and managed by Xentara HQ.**  
*© 2026 Abhinit. Licensed under the [Xentara Open Source License (Wrost Weights) v1](LICENSE).*

</div>
