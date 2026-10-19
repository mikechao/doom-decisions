# Doom Decisions

When OpenAI announced their [Decisions API](https://developers.openai.com/api/docs/guides/decisions) the lane choosing example looked like a game to me. So I thought since this model is multimodal could it "play" Doom. That is what this small project is. It's just a small wrapper around [doom.wasm](https://github.com/jacobenget/doom.wasm) with the Decisions API hooked up.

Doom Decisions uses OpenRouter for inference, which lets you choose between different models. You can use your existing OpenAI or TypeSafe API keys through OpenRouter, or add credits to your OpenRouter account. When signing in with OpenRouter, you can also limit the key given to Doom Decisions to one hour.

The basic flow is the following.

1. Take a screenshot of the current game.
2. Send the screenshot and a list of game commands to the Decisions API
3. Use the game command chosen by the API and advance the game based on the number of tics entered (default 6)

There are 2 modes
1. "Next Decision" - Where the flow above is execute once per button click.
2. "Continuous Mode" - Where the flow above repeats up to a preconfigured maximum number of API attempts.

## Deployed at
There is current version of this deployed at [Doom Decisions](https://doom-decisions.pages.dev/)

## Start a "game"

1. Choose **Sign in with OpenRouter** or **Usage an API key instead** for inference.
2. Select the AI Model (GPT-6 Luna Decisions or Jev 1.14)
3. Select **Use include Freedoom** to down the include Freedoom Game Data or
Select **Choose local IWAD** to select a local Doom Game Data file.

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

For linked worktrees, install the repository-local [automatic local-tool setup](docs/local-worktrees.md)
once to copy the existing Doom toolchain and Impeccable inputs on `git worktree add`.

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
