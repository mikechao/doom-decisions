# Doom Decisions

When OpenAI announced their [Decisions API](https://developers.openai.com/api/docs/guides/decisions) the lane choosing example looked like a game to me. So I thought since this model is multimodal can it "play" Doom. That is what this small project is. It's just a small wrapper around [doom.wasm](https://github.com/jacobenget/doom.wasm) with the Decisions API hooked up.

The basic flow is the following.

1. Take a screenshot of the current game.
2. Send the screenshot and a list of game commands to the Decisions API
3. Use the game command with the highest confidence and advance the game based on the number of tics entered (default 6)

There are 2 modes
1. "Next Decision" - Where the flow above is execute once per button click.
2. "Continuous Mode" - Where the flow above is executed a preconfigured number of times.

## Start a "game"

Get a Doom IWAD file. Download the [Freedoom Phase 1+2](https://freedoom.github.io/download.html)

Get an OpenAI API key and enter it.

Click "Next Decision"
or
Set an API budget and Click "Continuous Mode"

## Run locally

1. Clone this repo
2. Run
   ```bash
   ./script/setup_toolchain.sh install
    ```
   To install wasi-sdk-24.0-arm64-macos and binaryen-version_119-arm64-macos to build Doom in WASM.
3. Run
   ```bash
   ./build.sh
   ```
   To build the Doom Engine and the web page.
4. Run
   ```bash
   npm --prefix app install
   ```
   To install the dependencies for the web app
5. Run
   ```bash
   npm --prefix run dev
   ```
   To run the development Vite server
   
