# Doom Decisions

Watch Doom in the browser while OpenAI's Decisions API chooses the next action.
The owner-accepted **v0.2.0 Continuous Mode MVP** uses vanilla TypeScript, Vite,
CSS and a modified Doom WASM engine running in an app-owned module Worker.

Select your local **Doom IWAD** to attempt E1M1 preparation automatically,
including one mandatory neutral tic without an API request. Each **Next Decision**
click requests one of seven actions: neutral, forward, turn right, backward,
turn left, fire or use. You choose any **positive JavaScript safe integer** of tics,
initially **6**, captured separately for each admitted decision.
**Start Continuous Mode** admits sequential decisions
with a frozen per-run API-attempt budget: any positive JavaScript safe integer,
default **2**, including failed or canceled calls. N changes affect later decisions.
**Stop** closes admission and finishes cleanup or current-action verification.
API waits and idle advance no gameplay; there are no automatic retries or restarts.
Refresh starts a new session. See [Continuous Mode](app/README.md#continuous-mode).

The IWAD stays local and is not bundled or redistributed. Selection is best-effort:
the controlled engine expects compatible Doom E1M1 data and may reject other files.
Freedoom 0.13.0 Phase 1 and the owner's local Doom shareware `DOOM1.WAD` have worked
in owner-run trials. See [local IWAD support and limitations](app/README.md#local-iwad-support).
Supply your own OpenAI API key in the browser: calls go directly to OpenAI,
and credentials remain in memory for the session. This temporary BYOK prototype
requires trust in the served page and its scripts; it is not a production
credential-security design. See the [credential limitations](app/README.md#temporary-browser-direct-credentials).

## Run locally

First provision the tools in the [setup guide](app/README.md#prerequisites-and-clean-checkout).
From the repository root:

```sh
npm --prefix app ci --no-audit --no-fund
./build.sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory app/dist
```

Open `http://127.0.0.1:8000/`, select the IWAD, enter a key and click
**Next Decision**, or set **Max API attempts** and choose **Start Continuous Mode**;
use **Stop** to end the run. The build generates and verifies the bundled engine
without embedding a WAD. Later frontend-only builds can use `./build.sh --frontend-only`
when the existing native artifact and evidence still verify. In agent sessions,
follow [AGENTS.md](AGENTS.md) for execution approval requirements.

## Source and evidence

- [App guide](app/README.md): setup, checks, browser procedure and credentials.
- [Engine build guide](docs/doom-build.md): toolchain, staging and fixture boundaries.
- [Vendor provenance](docs/doom-vendor-provenance.md): pinned source, licenses and unresolved example-asset rights.
- [Prototype evidence](app/README.md#prototype-acceptance-and-evidence): owner-reported gameplay and remaining proof gaps.

Automated checks and builds do not establish browser/API runtime success.
Retired experiments, historical reports and superseded plans are recoverable
from Git history; ignored raw evidence is not. Review redistribution rights and corresponding-source
obligations before public distribution.
