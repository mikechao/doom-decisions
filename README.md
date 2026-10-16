# Doom Decisions

When OpenAI announced their [Decisions API](https://developers.openai.com/api/docs/guides/decisions) the lane choosing example looked like a game to me. So I thought since this model is multimodal can it "play" Doom. That is what this small project is. It's just a small wrapper around [doom.wasm](https://github.com/jacobenget/doom.wasm) with the Decisions API hooked up.

The basic flow is the following.

1. Take a screenshot of the current game.
2. Send the screenshot and a list of game commands to the Decisions API
3. Use the game command chosen by the API and advance the game based on the number of tics entered (default 6)

There are 2 modes
1. "Next Decision" - Where the flow above is execute once per button click.
2. "Continuous Mode" - Where the flow above repeats up to a preconfigured maximum number of API attempts.

## Start a "game"

Get a Doom IWAD file, such as [Freedoom Phase 1](https://freedoom.github.io/download.html).

Choose **Sign in with OpenRouter** before selecting the WAD. Authorization creates an OpenRouter API key held only in page memory. Then select your local `freedoom1.wad`. **Use an API key instead** provides a manual OpenRouter-key alternative. Prompts and screenshots go directly through OpenRouter and may reach its downstream model provider; Decisions can incur charges. Refresh clears local access without revoking the remote key. This prototype requires trusting the page and its scripts. See [key handling](app/README.md#temporary-browser-direct-credentials).

Click "Next Decision"
or
Set "Max API attempts" and Click "Start Continuous Mode"

## Run locally

These instructions target macOS arm64 and require Node 22.20.0 and npm; see the [full prerequisites](app/README.md#prerequisites-and-clean-checkout).

1. Clone this repo
2. Run
   ```bash
   ./scripts/setup_toolchain.sh install
    ```
   To install wasi-sdk-24.0-arm64-macos and binaryen-version_119-arm64-macos to build Doom in WASM.
3. Run
   ```bash
   npm --prefix app ci
   ```
   To install the dependencies for the web app
4. Run
   ```bash
   ./build.sh
   ```
   To build the Doom Engine and the web page.
5. Run
   ```bash
   npm --prefix app run dev
   ```
   To run the development Vite server

OpenRouter is the default in ordinary development and production builds; no
`--mode openrouter` is required. Direct OpenAI is an experimental operator opt-in:
set `VITE_DECISION_PROVIDER=openai` at dev startup or production build time.
Browser CORS has failed in earlier direct OpenAI trials; it is not a verified
production fallback. There is no automatic provider switching. See
[provider selection and static hosting](app/README.md#provider-selection-and-static-hosting).

## Tech Stack

- TypeScript - App logic, decision controls, and communication with the game.
- HTML and CSS - The page layout, controls, and styling.
- Canvas 2D - Displays the game frames and captures screenshots.
- Web Workers - Run the game engine off the main browser thread.
- C and WebAssembly (doom.wasm) - The modified Doom engine running in the browser.
- OpenRouter Decisions API and official SDK - Send screenshots and action choices through OpenRouter; direct OpenAI and its SDK remain an explicit experimental alternative.
- Vite - The local development server and frontend bundling.
- Node.js and npm - Run build and verification scripts and manage app dependencies.
- Bash and Make - Coordinate and compile the engine build.
- WASI SDK and Binaryen - Compile the C engine to WebAssembly and process the WASM modules.
- Vitest - Offline app regression tests.
- Biome - TypeScript and JavaScript linting and formatting.
