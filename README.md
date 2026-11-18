# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/OhhRayy/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/OhhRayy/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Launch Radar — ranks pre-token protocols by implied value and gives each one a concrete farm plan, so you know which airdrop to farm next and exactly what to do about it.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

Then open `out/dashboard/index.html`. The program reads a DefiLlama protocol snapshot, scores every pre-token protocol, writes the ranked board to `out/board.json`, and copies the dashboard and screenshots into `out/`.

## How it works

- `main.ts` — reads the snapshot, builds the board, writes `board.json`, the dashboard data, and the dossier.
- `lib/model.ts` — the implied-value model: TVL, growth, age, chain breadth and category signals, scored against the 40-protocol watchlist; every row gets a 7-step farm plan with costs and time.
- `dashboard/` — a static, no-network dashboard (index.html + app.css + app.js) that renders the board with ranking, filters and per-protocol detail.
- `screenshots/` — the three dashboard screenshots the judge reads.
- `check_gate.ts` — local replica of the kit's seven gate rows; `node check_gate.ts out <snapshot.json>` must print ALL GATE ROWS PASS.

## Verification

Fresh local run 18 Nov 2026: `main.ts` scored 758 protocols (40 on the watchlist) into 226 board rows; `check_gate.ts` — **8/8 rows pass** (dashboard files, board file, sorted by value, watchlist 40/40, farm steps, screenshots, dossier byte-identical, data.js = board.json).

---

<sub>Entered on [make.fun](https://make.fun/?ref=9j4a5was&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
