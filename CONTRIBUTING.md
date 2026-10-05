# Contributing to Mhorpix

Thanks for taking the time to contribute!

**Made by Xentara, managed by Xentara HQ.**

## Before you start

- Read the [Code of Conduct](CODE_OF_CONDUCT.md) and the [License](LICENSE).
- Check open issues to see if someone's already working on it.
- For anything beyond a small fix, open an issue first and discuss it with the maintainers before writing code — saves everyone a wasted PR.

## Prerequisites

- [Node.js](https://nodejs.org/) `>= 20.0.0`
- [PostgreSQL](https://www.postgresql.org/) 16+
- [Redis](https://redis.io/) 7+
- A running [Lavalink v4](https://github.com/lavalink-devs/Lavalink) node
- A [Discord Bot Application](https://discord.com/developers/applications) with a token & client ID
- [Git](https://git-scm.com/downloads)

## Getting Started

1. Fork the repo, then clone your fork:

   ```bash
   git clone <your-fork-url>
   cd Mhorpix
   ```

2. Create a branch for your change:

   ```bash
   git checkout -b feat/short-description
   ```

3. Install dependencies:

   ```bash
   npm install
   ```

4. Set up your environment:

   ```bash
   cp .env.example .env
   ```

   Fill in `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `POSTGRES_URL`, `REDIS_URL`, and the Lavalink vars. See the [README](README.md#2-configure-environment) for the full list.

5. Run database migrations:

   ```bash
   npm run migrate
   ```

6. Start the bot in dev mode:

   ```bash
   npm run dev
   ```

## Available Scripts

| Command              | What it does                                  |
| --------------------- | ---------------------------------------------- |
| `npm run dev`         | Runs the bot with `tsx`, no build step         |
| `npm run build`       | Compiles TypeScript to `dist/`                 |
| `npm run start`       | Runs the compiled bot                          |
| `npm run typecheck`   | Type-checks without emitting (`tsc --noEmit`)  |
| `npm run lint`        | Lints `./src` with Biome                       |
| `npm run format`      | Formats `./src` with Biome                     |
| `npm run migrate`     | Applies pending SQL migrations                 |

## Before you commit

Git hooks (via Husky) run automatically and will block you if these fail:

- **pre-commit** — `lint-staged` runs Biome format/lint on staged `.ts`/`.js` files.
- **pre-push** — `tsc --noEmit` must pass.
- **commit-msg** — commit messages are checked against [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) via commitlint.

Commit message format:

```
type(scope?): short description
```

e.g. `fix(queue): prevent duplicate track add`, `feat(filters): add 8D audio filter`. Valid types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`.

## Submitting a Pull Request

1. Make sure `npm run lint`, `npm run typecheck`, and `npm run build` all pass locally — the same checks run in CI on every PR and must be green before merge.
2. Keep PRs focused — one feature/fix per PR is easier to review than a bundle of unrelated changes.
3. Reference the issue your PR addresses (e.g. `Closes #123`) in the PR description.
4. Be responsive to review feedback — a maintainer will merge once approved and CI is green.

## Code Style

- Formatting/linting is enforced by [Biome](https://github.com/biomejs/biome) — run `npm run format` before committing rather than fighting the linter by hand.
- Reference [discord.js](https://discord.js.org/#/docs/main/stable/general/welcome) and [Shoukaku](https://github.com/shipgirlproject/Shoukaku) docs for API usage.
- Test your changes against a real Discord server before submitting — there's no automated test suite yet, so manual verification matters.

## Reporting Bugs

Open a GitHub issue using the bug report template — include repro steps and the bot version/commit you're on.

## Code of Conduct

This project follows the [Contributor Code of Conduct](CODE_OF_CONDUCT.md). Participating means agreeing to its terms.

## License

Licensed under the [Xentara Open Source License (Wrost Weights) v1](LICENSE).

---

*© 2026 Abhinit. Made by Xentara, managed by Xentara HQ.*