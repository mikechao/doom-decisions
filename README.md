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

Get a Doom IWAD file. Download and extract [Freedoom Phase 1+2](https://freedoom.github.io/download.html), then select `freedoom1.wad` in the browser app.

Enter your own OpenAI API key. Requests go directly from the browser to OpenAI; the client and key stay in memory until refresh. This prototype requires trusting the page and its scripts. See [key handling](app/README.md#temporary-browser-direct-credentials).

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
   
