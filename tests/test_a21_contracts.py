"""Focused source contracts and executable timer checks; no map/browser claims."""
import hashlib
import json
from pathlib import Path
import re
import resource
import signal
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
ENGINE = ROOT / "references/doom.wasm/doomgeneric"
GAME = (ENGINE / "src/g_game.c").read_text()


def function(source, signature):
    start = source.index(signature + " {")
    brace = source.index("{", start)
    depth = 1
    end = brace + 1
    while depth:
        depth += (source[end] == "{") - (source[end] == "}")
        end += 1
    return source[brace + 1:end - 1]


class SourceContracts(unittest.TestCase):
    def test_stock_builder_preserves_every_statement_and_history_operation(self):
        body = function(GAME, "void G_BuildTiccmd(ticcmd_t *cmd, int maketic)")
        self.assertEqual(hashlib.sha256(re.sub(r"\s+", "", body).encode()).hexdigest(),
                         "760b89053a998c601d53b3223409de415e135b8a40a8918c2143112d98abbf28")

    def test_legacy_continuation_preserves_every_statement_and_order(self):
        start = GAME.index("  // get commands, check consistancy,")
        end = GAME.index("//\n// PLAYER STRUCTURE FUNCTIONS", start)
        body = re.sub(r"^.*G_A21(?:Install|Boundary)\([^;]*;\n", "", GAME[start:end], flags=re.M)
        normalized = re.sub(r"\s+", "", body)
        # Hash of the accepted pre-refactor continuation, including native comments.
        self.assertEqual(hashlib.sha256(normalized.encode()).hexdigest(), "d403f17c15bb2bc737237b1e993b1e39dc65b561f499e1acad88911c31c9dee4")
        ticker = function(GAME, "void G_Ticker(void)")
        self.assertLess(ticker.index("G_DoReborn"), ticker.index("while (gameaction"))
        self.assertLess(ticker.index("G_DoNewGame"), ticker.index("G_TickerContinuation"))

    def test_whole_prepare_has_no_ticker_or_builder_and_marker_follows_load(self):
        prepare = function(GAME, "int G_A21Prepare(void)")
        self.assertLess(prepare.index("G_DoNewGame();"), prepare.index("a21_load_complete = true"))
        for call in ("G_Ticker(", "G_TickerContinuation(", "G_BuildTiccmd(", "M_Ticker(", "I_A21CommitTic("):
            self.assertNotIn(call, prepare)
        self.assertIn("A21ZeroWork() && A21GameEligible() && A21NeutralInput()", prepare)

    def test_refusals_precede_mutations_and_only_continuation_is_called(self):
        step = function(GAME, "int G_A21Step(int input)")
        refusal = step.index("return -1;")
        self.assertLess(refusal, step.index("a21_active = true"))
        self.assertLess(refusal, step.index("M_Ticker();"))
        self.assertLess(refusal, step.index("gamekeydown[key_up] ="))
        self.assertLess(refusal, step.index("gamekeydown[key_right] ="))
        self.assertNotIn("a21_spent", GAME)
        self.assertNotIn("memset(gamekeydown", step)
        self.assertEqual(step.count("G_BuildTiccmd("), 1)
        self.assertEqual(step.count("G_TickerContinuation();"), 1)
        for call in ("G_Ticker(", "TryRunTics(", "BuildNewTic(", "RunTic(", "D_Display("):
            self.assertNotIn(call, step)
        self.assertLess(step.index("netcmds = previous"), step.index("++gametic"))
        self.assertLess(step.index("a21_events[i] == n + 1"), step.index("++gametic"))
        self.assertLess(step.index("++gametic"), step.index("I_A21CommitTic"))
        eligibility = function(GAME, "static boolean A21GameEligible(void)")
        for guard in ("menuactive", "paused", "gameaction != ga_nothing", "A21LiveActor()"):
            self.assertIn(guard, eligibility)

    def test_hooks_are_at_real_install_entry_and_body_end(self):
        self.assertLess(GAME.index("memcpy(cmd, &netcmds[i]"), GAME.index("G_A21Install(i, cmd)"))
        user = (ENGINE / "src/p_user.c").read_text()
        self.assertLess(user.index("G_A21PlayerEntry(player)"), user.index("player->mo->flags |= MF_NOCLIP"))
        tick = function((ENGINE / "src/p_tick.c").read_text(), "void P_Ticker(void)")
        self.assertLess(tick.index("P_RespawnSpecials();"), tick.index("leveltime++"))
        self.assertLess(tick.index("leveltime++"), tick.index("G_A21Boundary(A21_WORLD)"))
        self.assertNotIn("memcmp", function(GAME, "static boolean A21CommandEqual(const ticcmd_t *a, const ticcmd_t *b)"))


class NativeCommand(unittest.TestCase):
    def test_actual_comparator_checks_all_named_fields_and_ignores_padding(self):
        fields = ["forwardmove", "sidemove", "angleturn", "chatchar", "buttons", "consistancy",
                  "buttons2", "inventory", "lookfly", "arti"]
        comparator = "static boolean A21CommandEqual(const ticcmd_t *a, const ticcmd_t *b) {" + function(
            GAME, "static boolean A21CommandEqual(const ticcmd_t *a, const ticcmd_t *b)") + "}"
        with tempfile.TemporaryDirectory(prefix="doom-a21-command-") as directory:
            directory = Path(directory)
            source = directory / "command_test.c"
            program = '#include <assert.h>\n#include <string.h>\n#include "d_ticcmd.h"\n' + comparator
            program += "\nint main(void) { ticcmd_t a = {0}, b; memset(&b, 0xaa, sizeof(b));\n"
            program += "\n".join("b." + field + " = 0;" for field in fields)
            program += "\nassert(A21CommandEqual(&a, &b));\n"
            for field in fields:
                program += "b." + field + " = 1; assert(!A21CommandEqual(&a, &b)); b." + field + " = 0;\n"
            source.write_text(program + "return 0; }\n")
            executable = directory / "command_test"
            subprocess.run(["/usr/bin/clang", "-I" + str(ENGINE / "include"), str(source),
                            "-o", str(executable)], check=True, capture_output=True)
            subprocess.run([str(executable)], check=True, capture_output=True)


class ConsecutiveNative(unittest.TestCase):
    def test_actual_builder_step_hooks_history_refusals_and_faults(self):
        # Execute the real builder, step and P_PlayerThink with inert movement,
        # use-line and weapon dependencies. Real use-edge logic runs; map/weapon
        # effects and complete world ticking still require final WASM/Chrome.
        controls = (ENGINE / "src/m_controls.c").read_text()
        program = r"""#include <assert.h>
#include <string.h>
#include "doomstat.h"
#include "doomkeys.h"
#include "g_game.h"
#include "i_timer.h"
#include "m_controls.h"
#include "i_video.h"
#include "p_local.h"
#define INVERSECOLORMAP 32
#define A1_COUNT(x) ((void)0)
"""
        program += controls[controls.index("int key_right ="):controls.index("void M_BindBaseControls")]
        program += GAME[GAME.index("gameaction_t gameaction;"):GAME.index("#define MAXPLMOVE")]
        program += GAME[GAME.index("#define MAXPLMOVE"):GAME.index("static int savegameslot;")]
        program += "static int savegameslot; int ticdup = 1, gametic, leveltime; boolean menuactive; ticcmd_t *netcmds;\n"
        program += GAME[GAME.index("static boolean a21_load_attempted"):GAME.index("extern boolean advancedemo;")]
        program += r"""
int rndindex = 5, prndindex = 7;
GameMode_t gamemode = shareware;
int numvertexes, numlines, numsectors, numsegs, numsubsectors, numnodes;
static int eligible = 1, fault_kind;
static boolean A21Resources(void) { return true; }
static boolean A21LiveActor(void) { return players[0].playerstate == PST_LIVE; }
static boolean A21GameEligible(void) {
  return eligible && !menuactive && !paused && gameaction == ga_nothing && A21LiveActor();
}
static void M_Ticker(void) { }
static char HU_dequeueChatChar(void) { return 0; }
static int G_NextWeapon(int direction) { assert(0); return 0; }
void DG_SleepMs(uint32_t ms) { assert(0); }
static void G_TickerContinuation(void);
"""
        signatures = ["static void A21Require(boolean ok)", "void G_A21Boundary(int event)",
                      "static boolean A21CommandEqual(const ticcmd_t *a, const ticcmd_t *b)",
                      "static boolean A21NeutralInput(void)", "static boolean A21InputAvailable(void)",
                      "static boolean A21Contributors(void)", "int G_A21Ready(void)",
                      "void G_A21CheckPassive(void)", "void G_A21BuildEntry(int tick)",
                      "void G_A21Install(int player, const ticcmd_t *cmd)",
                      "void G_A21PlayerEntry(player_t *player)",
                      "void G_BuildTiccmd(ticcmd_t *cmd, int maketic)", "int G_A21Step(int input)"]
        for signature in signatures:
            program += signature + " {" + function(GAME, signature) + "}\n"
        program += "#ifndef DOOM_A1_NO_FIXTURES\n"
        for signature in ("static int A21CommandField(const ticcmd_t *cmd, int field)", "int G_A21Observe(int index)"):
            program += signature + " {" + function(GAME, signature) + "}\n"
        program += "#endif\n"
        program += r"""
static int use_calls, psprite_calls;
void P_UseLines(player_t *player) { ++use_calls; }
void P_MovePsprites(player_t *player) { ++psprite_calls; }
static void P_MovePlayer(player_t *player) { }
static void P_CalcHeight(player_t *player) { }
static void P_DeathThink(player_t *player) { assert(0); }
void P_PlayerInSpecialSector(player_t *player) { assert(0); }
"""
        user = (ENGINE / "src/p_user.c").read_text()
        program += "void P_PlayerThink(player_t *player) {" + function(user, "void P_PlayerThink(player_t *player)") + "}\n"
        program += r"""
static void G_TickerContinuation(void) {
  players[0].cmd = netcmds[0];
  if (fault_kind == 3) ++players[0].cmd.forwardmove;
  G_A21Install(0, &players[0].cmd);
  if (fault_kind == 2) G_A21BuildEntry(gametic);
  P_PlayerThink(&players[0]);
  ++leveltime;
  if (fault_kind != 1) G_A21Boundary(A21_WORLD);
  G_A21Boundary(A21_STATUS); G_A21Boundary(A21_AUTOMAP); G_A21Boundary(A21_HUD);
  if (fault_kind == 4) ++gametic;
  if (fault_kind == 5) G_A21Boundary(A21_WORLD);
  if (fault_kind == 6) players[0].mo = NULL;
  if (fault_kind == 7) players[0].usedown = true;
}
static void refusal(int input) {
  int events[A21_EVENT_LIMIT], keys[256];
  ticcmd_t built = a21_built, entered = a21_entered;
  int held = turnheld, dc1 = dclicktime, dc2 = dclicktime2, time = I_GetTime();
  int use = use_calls, sprites = psprite_calls, edge = players[0].usedown;
  int tick = a21_build_tick; ticcmd_t *previous = netcmds;
  memcpy(events, a21_events, sizeof(events));
  for (int i = 0; i < 256; ++i) keys[i] = gamekeydown[i];
  assert(G_A21Step(input) == -1);
  assert(!memcmp(events, a21_events, sizeof(events)));
  assert(!memcmp(&built, &a21_built, sizeof(built)) && !memcmp(&entered, &a21_entered, sizeof(entered)));
  for (int i = 0; i < 256; ++i) assert(keys[i] == gamekeydown[i]);
  assert(turnheld == held && dclicktime == dc1 && dclicktime2 == dc2 && I_GetTime() == time);
  assert(gametic == time && leveltime == time && a21_build_tick == tick && netcmds == previous);
  assert(use_calls == use && psprite_calls == sprites && players[0].usedown == edge);
  G_A21CheckPassive();
}
int main(int argc, char **argv) {
  sector_t sector = {0}; subsector_t sub = {.sector = &sector};
  mobj_t actor = {.subsector = &sub}; ticcmd_t prior[MAXPLAYERS] = {{0}};
  players[0].mo = a21_actor = &actor; a21_load_complete = true; netcmds = prior;
  for (int i = 0; i < BACKUPTICS; ++i) consistancy[0][i] = i + 1;
  for (int mask = 1; mask <= 63; ++mask) refusal(mask);
  refusal(64); refusal(-1);
  if (argc > 1) fault_kind = argv[1][0] - '0';
  int inputs[100] = {0,1,1,1,1,2,2,2,2,2,2,0,1,1,2,2,0,1,2,0,
                      51,51,51,51,51,51,8,0,4,8,32,32,0,32,16,0};
  int length = 36;
  for (int mask = 0; mask <= 63; ++mask)
    if ((mask & 5) != 5 && (mask & 10) != 10) inputs[length++] = mask;
  int held = 0, expected_uses = 0, previous_use = 0;
  for (int n = 0; n < length; ++n) {
    int input = inputs[n]; held = (input & 10) ? held + 1 : 0;
    if ((input & 32) && !previous_use) ++expected_uses;
    previous_use = !!(input & 32);
    assert(G_A21Step(input) == 0 && netcmds == prior);
    assert(gametic == n + 1 && leveltime == n + 1 && I_GetTime() == n + 1);
    for (int i = 0; i < A21_EVENT_LIMIT; ++i) assert(a21_events[i] == n + 1);
    assert(a21_build_tick == n && a21_built.consistancy == (n % BACKUPTICS) + 1);
    assert(turnheld == held && a21_built.forwardmove == ((input & 1) ? 25 : (input & 4) ? -25 : 0));
    int sign = (input & 8) ? 1 : (input & 2) ? -1 : 0;
    assert(a21_built.angleturn == sign * (held < 6 ? 320 : 640));
    assert(a21_built.buttons == (((input & 16) ? BT_ATTACK : 0) | ((input & 32) ? BT_USE : 0)));
    assert(players[0].usedown == !!(input & 32) && use_calls == expected_uses && psprite_calls == n + 1);
    assert(dclicktime == n + 1 && dclicktime2 == n + 1 && !dclickstate && !dclickstate2 && !dclicks && !dclicks2);
    int owned[] = {key_up, key_right, key_down, key_left, key_fire, key_use};
    for (int i = 0; i < 6; ++i) assert(gamekeydown[owned[i]] == !!(input & (1 << i)));
    for (int i = 0; i < 100; ++i) G_A21CheckPassive();
#ifndef DOOM_A1_NO_FIXTURES
    int snapshot[76];
    for (int i = 0; i < 76; ++i) snapshot[i] = G_A21Observe(i);
    for (int j = 0; j < 100; ++j)
      for (int i = 0; i < 76; ++i) assert(G_A21Observe(i) == snapshot[i]);
    assert(rndindex == 5 && prndindex == 7 && I_GetTime() == n + 1);
#endif
    refusal(64); refusal(-1); refusal(5); refusal(10); refusal(63);
    paused = true; refusal(input); paused = false;
    menuactive = true; refusal(input); menuactive = false;
    gameaction = ga_newgame; refusal(input); gameaction = ga_nothing;
    lowres_turn = true; refusal(input); lowres_turn = false;
    mousex = 1; refusal(input); mousex = 0;
    gamekeydown[key_speed] = true; refusal(input); gamekeydown[key_speed] = false;
    int *bindings[] = {&key_up, &key_right, &key_down, &key_left, &key_fire, &key_use};
    for (int i = 0; i < 6; ++i) {
      int saved = *bindings[i];
      *bindings[i] = *bindings[(i + 1) % 6]; refusal(input);
      *bindings[i] = key_speed; refusal(input);
      *bindings[i] = key_weapon1; refusal(input);
      *bindings[i] = -1; refusal(input);
      *bindings[i] = 256; refusal(input);
      *bindings[i] = saved;
    }
    int saved = joybspeed; joybspeed = 31; refusal(input); joybspeed = saved;
    saved = mousebfire; mousebfire = 100; refusal(input); mousebfire = saved;
    joyxmove = 1; refusal(input); joyxmove = 0;
    sendpause = true; refusal(input); sendpause = false;
    sendsave = true; refusal(input); sendsave = false;
    next_weapon = 1; refusal(input); next_weapon = 0;
    dclickstate = true; refusal(input); dclickstate = false;
  }
  return 0;
}
"""
        with tempfile.TemporaryDirectory(prefix="doom-a22-native-") as directory:
            directory = Path(directory)
            source = directory / "native_test.c"
            source.write_text(program)
            for disabled in (False, True):
                executable = directory / ("native_no_fixtures" if disabled else "native_trace")
                command = ["/usr/bin/clang", "-DDOOM_CONTROLLED_TITLE", "-I" + str(ENGINE),
                           "-I" + str(ENGINE / "include"), str(source), str(ENGINE / "src/i_timer.c"),
                           "-o", str(executable)]
                if disabled:
                    command.insert(1, "-DDOOM_A1_NO_FIXTURES")
                compiled = subprocess.run(command, capture_output=True, text=True)
                self.assertEqual(compiled.returncode, 0, compiled.stderr)
                subprocess.run([str(executable)], check=True, capture_output=True)
                def no_core():
                    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
                for kind in range(1, 8):
                    fault = subprocess.run([str(executable), str(kind)], capture_output=True, preexec_fn=no_core)
                    self.assertIn(fault.returncode, (-signal.SIGILL, -signal.SIGTRAP), "Contradiction must trap: " + str(kind))


class HarnessIsolation(unittest.TestCase):
    def test_isolated_turn_proof_and_generic_weapon_effects(self):
        # Execute actual JS proofs/action accounting with synthetic observations.
        # Hit/miss angles model observations only; no Doom weapon mechanics run.
        script = re.search(r"<script>(.*?)</script>", (ROOT / "experiments/stage-a/harness.html").read_text(), re.S).group(1)
        helpers = "\n".join(signature + " {" + function(script, signature) + "}"
                            for signature in ("function i11MaskValid(mask)",
                                              "function i11VerifyStep(mask, before, after)",
                                              "function i11VerifyIsolatedTurn(mask, before, after)",
                                              "function i11Action(mask, tics, step, observe)"))
        program = r"""
const assert = require('node:assert/strict');
HELPERS
const work = ['build','install','liveEntry','world','status','automap','hud','menu','outer'];
const clocks = ['nativeBuild','playerEntry','worldComplete','outerComplete','gametic','leveltime','virtualTicks'];
const copy = value => JSON.parse(JSON.stringify(value));
function pair(mask, angle, n = mask === 8 ? 2 : 1) {
  const held = mask === 8 ? 1 : 0;
  const before = {counters: Object.fromEntries(clocks.map(k => [k, n])), native: {
    ...Object.fromEntries(work.map(k => [k, n])), ready: 1, angle, flags: 0, reactiontime: 0,
    turnheld: held, dclicktime: n, dclicktime2: n, keyFire: 0, keyUse: 0, built: {buttons: 0}
  }};
  const cmd = {forwardmove: 0, sidemove: 0, angleturn: (mask & 2) ? -320 : 320,
    chatchar: 0, buttons: (mask & 16) ? 1 : 0, consistancy: 0, buttons2: 0, inventory: 0, lookfly: 0, arti: 0};
  const after = {status: 0, counters: {
    ...Object.fromEntries(clocks.map(k => [k, n + 1])), schedulerEntry: 0, netBody: 0, wipeEntry: 0, demoLoad: 0
  }, native: {
    ...Object.fromEntries(work.map(k => [k, n + 1])), ready: 1, angle, flags: 0, reactiontime: 0,
    virtualMs: Math.floor((n + 1) * 1000 / 35), buildTick: n, turnheld: held + 1, usedown: 0,
    keyUp: 0, keyRight: +Boolean(mask & 2), keyDown: 0, keyLeft: +Boolean(mask & 8), keyFire: +Boolean(mask & 16), keyUse: 0,
    installEqual: 1, entryEqual: 1, actorEqual: 1, contributorsValid: 1,
    dclicktime: n + 1, dclicktime2: n + 1, dclickstate: 0, dclicks: 0, dclickstate2: 0, dclicks2: 0,
    built: cmd, entered: {...cmd}
  }};
  return [before, after];
}
function action(mask, before, after) {
  let reads = 0;
  return i11Action(mask, 1, () => 0, () => reads++ === 0 ? before : after);
}
for (const [mask, start, expected] of [[2, 0x00010000, 0xfec10000], [8, 0xffff0000, 0x013f0000]]) {
  const [before, after] = pair(mask, start);
  // Correct command/entry/count evidence alone is insufficient for the script's effect proof.
  assert.doesNotThrow(() => i11VerifyStep(mask, before, after));
  assert.throws(() => i11VerifyIsolatedTurn(mask, before, after), /Isolated player rotation mismatch/);
  after.native.angle = expected; // Right underflow / left overflow, modulo 2^32.
  assert.doesNotThrow(() => i11VerifyIsolatedTurn(mask, before, after));

  before.native.reactiontime = 1; after.native.angle = start;
  assert.doesNotThrow(() => i11VerifyStep(mask, before, after));
  assert.throws(() => i11VerifyIsolatedTurn(mask, before, after), /INCONCLUSIVE/);
  before.native.reactiontime = 0; before.native.flags = 128;
  assert.doesNotThrow(() => i11VerifyStep(mask, before, after));
  assert.throws(() => i11VerifyIsolatedTurn(mask, before, after), /INCONCLUSIVE/);
  before.native.flags = 0; after.native.flags = 128; after.native.angle = 123;
  assert.doesNotThrow(() => i11VerifyStep(mask, before, after));
  assert.throws(() => i11VerifyIsolatedTurn(mask, before, after), /INCONCLUSIVE/);

  for (const [condition, angle] of [['fist hit', 123], ['fist miss', expected]]) {
    const fireMask = mask | 16;
    const [b, p] = pair(fireMask, start, 20);
    p.native.angle = angle; // A hit snaps to a target; a miss adds no weapon-driven rotation.
    assert.equal(p.native.flags, 0); // Punch reorientation has no chainsaw flag.
    assert.doesNotThrow(() => i11VerifyStep(fireMask, b, p), condition);
    const result = action(fireMask, b, p);
    assert.equal(result.outcome, 'APPLIED', condition); assert.equal(result.completedTics, 1);
    assert.equal(result.steps[0].native.built.angleturn, mask === 2 ? -320 : 320);
    assert.equal(result.steps[0].native.built.buttons, 1);
    assert.deepEqual(result.steps[0].native.built, result.steps[0].native.entered);
    assert.equal(result.counters.gametic, 21);
    // Weapon effects never excuse wrong commands or incomplete world/clock evidence.
    const badCommand = copy(p); badCommand.native.built.angleturn = badCommand.native.entered.angleturn = 0;
    const badClock = copy(p); badClock.counters.leveltime++;
    for (const bad of [badCommand, badClock]) {
      const fault = action(fireMask, b, bad);
      assert.equal(fault.outcome, 'FAULT'); assert.equal(fault.completedTics, 0); assert.equal(fault.steps.length, 0);
    }
  }
}
""".replace("HELPERS", helpers, 1)
        result = subprocess.run(["node", "-e", program], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_finite_worker_actions_prefix_faults_and_stop_boundary(self):
        # Actual JS helpers and Worker message path, inert exports; no WASM/Chrome.
        script = re.search(r"<script>(.*?)</script>", (ROOT / "experiments/stage-a/harness.html").read_text(), re.S).group(1)
        program = r"""
const vm = require('node:vm'), assert = require('node:assert/strict');
const elements = new Map();
const document = {querySelector(name) {
  if (!elements.has(name)) elements.set(name, {disabled: false, files: [], value: '',
    getContext: () => ({clearRect() {}, putImageData() {}}), toDataURL: () => 'inert PNG'});
  return elements.get(name);
}, querySelectorAll() { return []; }};
const context = vm.createContext({document, assert, performance: {now: () => 0},
  WebAssembly, setTimeout() {}, clearTimeout() {}, setImmediate,
  crypto: {subtle: {digest: async () => new ArrayBuffer(32)}}, navigator: {userAgent: 'inert fixture'},
  URL: {createObjectURL: () => 'blob:fixture', revokeObjectURL() {}}, Blob: class {}, ImageData: class {}});
vm.runInContext(SCRIPT, context);
vm.runInContext(`
  let calls, refuseAt, trapAt, corruptAt, state;
  let stuckTurnMask = 0;
  const copy = value => JSON.parse(JSON.stringify(value));
  const fields = ['forwardmove','sidemove','angleturn','chatchar','buttons','consistancy',
    'buttons2','inventory','lookfly','arti'];
  const keys = ['keyUp','keyRight','keyDown','keyLeft','keyFire','keyUse'];
  function reset() {
    calls = refuseAt = trapAt = corruptAt = 0;
    state = {counters: Object.fromEntries(a21Passive.map(k => [k, 0])), native: {
      ...Object.fromEntries(a21Work.map(k => [k, 0])), ...Object.fromEntries(keys.map(k => [k, 0])),
      ready: 1, contributorsValid: 1, buildTick: 0, turnheld: 0, usedown: 0, virtualMs: 0,
      angle: 0, reactiontime: 0, flags: 0,
      installEqual: 0, entryEqual: 0, actorEqual: 0, dclicktime: 0, dclicktime2: 0,
      dclickstate: 0, dclickstate2: 0, dclicks: 0, dclicks2: 0,
      built: Object.fromEntries(fields.map(k => [k, 0])), entered: Object.fromEntries(fields.map(k => [k, 0]))
    }};
  }
  function step(mask) {
    ++calls;
    if (calls === trapAt) throw new WebAssembly.RuntimeError('fixture trap');
    if (calls === refuseAt || !i11MaskValid(mask) || (state.counters.gametic === 0 && mask !== 0)) return -1;
    const p = state.native, n = state.counters.gametic;
    p.turnheld = (mask & 10) ? p.turnheld + 1 : 0;
    p.usedown = +Boolean(mask & 32);
    p.buildTick = n;
    p.virtualMs = Math.floor((n + 1) * 1000 / 35);
    p.dclicktime++; p.dclicktime2++;
    if (mask & 1) p.x = (p.x || 0) + 1; // Inert movement evidence for script plumbing only.
    keys.forEach((k, i) => { p[k] = +Boolean(mask & (1 << i)); });
    p.built = {...Object.fromEntries(fields.map(k => [k, 0])),
      forwardmove: (mask & 1) ? 25 : (mask & 4) ? -25 : 0,
      angleturn: ((mask & 8) ? 1 : (mask & 2) ? -1 : 0) * (p.turnheld < 6 ? 320 : 640),
      buttons: ((mask & 16) ? 1 : 0) | ((mask & 32) ? 2 : 0)};
    if (mask !== stuckTurnMask) p.angle = (p.angle + p.built.angleturn * 65536) >>> 0; // Inert effect evidence.
    p.entered = {...p.built}; p.installEqual = p.entryEqual = p.actorEqual = 1;
    a21Work.forEach(k => { p[k]++; });
    ['nativeBuild','playerEntry','worldComplete','outerComplete','gametic','leveltime','virtualTicks']
      .forEach(k => { state.counters[k]++; });
    if (calls === corruptAt) p.entered.forwardmove++;
    return 0;
  }
  reset();
  for (let mask = 0; mask <= 64; ++mask)
    assert.equal(i11MaskValid(mask), mask <= 63 && (mask & 5) !== 5 && (mask & 10) !== 10);
  for (const mask of [-1, 2.5, '1', null, NaN, Infinity, 4294967296]) {
    const result = i11Action(mask, 1, step, () => copy(state));
    assert.equal(result.outcome, 'REFUSED'); assert.equal(result.completedTics, 0);
  }
  for (const tics of [0, -1, 21, 1.5, '2', null, NaN, Infinity]) {
    const result = i11Action(0, tics, step, () => copy(state));
    assert.equal(result.outcome, 'REFUSED'); assert.equal(result.completedTics, 0);
  }
  assert.equal(calls, 0);
  const initial = copy(state);
  let result = i11Action(1, 20, step, () => copy(state));
  assert.equal(result.outcome, 'REFUSED'); assert.equal(result.completedTics, 0);
  assert.equal(JSON.stringify(state), JSON.stringify(initial));
  result = i11Action(0, 1, step, () => copy(state));
  assert.equal(result.outcome, 'APPLIED'); assert.equal(result.completedTics, 1);
  result = i11Action(51, 20, step, () => copy(state));
  assert.equal(result.outcome, 'APPLIED'); assert.equal(result.completedTics, 20);
  assert.equal(result.steps.length, 20); assert.equal(state.counters.gametic, 21);
  assert.equal(calls, 22); // One refused first-input call + 21 accepted; no expiry call.
  assert.equal(state.native.keyFire, 1); assert.equal(state.native.keyUse, 1);
  const expired = JSON.stringify(state);
  for (let i = 0; i < 100; ++i) copy(state);
  assert.equal(JSON.stringify(state), expired); // Observation/idle is not a scheduler.
  for (const mask of [64, 5, 10]) assert.equal(i11Action(mask, 1, step, () => copy(state)).completedTics, 0);
  assert.equal(calls, 22); assert.equal(JSON.stringify(state), expired);
  result = i11Action(0, 1, step, () => copy(state));
  assert.equal(result.completedTics, 1); assert.equal(state.counters.gametic, 22);
  keys.forEach(k => assert.equal(state.native[k], 0)); assert.equal(state.native.usedown, 0);
  refuseAt = calls + 3;
  result = i11Action(4, 6, step, () => copy(state));
  assert.equal(result.outcome, 'REFUSED'); assert.equal(result.completedTics, 2);
  assert.equal(result.steps.length, 2); assert.equal(state.counters.gametic, 24);
  trapAt = calls + 3;
  result = i11Action(8, 6, step, () => copy(state));
  assert.equal(result.outcome, 'FAULT'); assert.equal(result.completedTics, 2);
  assert.equal(result.currentTic, 'UNKNOWN'); assert.equal(result.steps.length, 2);
  assert.equal(result.counters.gametic, 26);
  corruptAt = calls + 2;
  result = i11Action(1, 3, step, () => copy(state));
  assert.equal(result.outcome, 'FAULT'); assert.equal(result.completedTics, 1);
  assert.equal(result.steps.length, 1); // A native return alone is insufficient evidence.

  // Drive the actual titleWorker action branch against inert native exports.
  const counterNames = ['cInit','engineCreate','titlePrepare','nativeBuild','playerEntry',
    'worldComplete','outerComplete','schedulerEntry','netBody','netIntercept','wipeEntry','demoLoad',
    'render','frame','gametic','leveltime','virtualTicks','titleReady'];
  const names = ['build','install','liveEntry','world','status','automap','hud','menu','outer',
    'ready','loadComplete','resources','liveActor','gameEligible','gamestate','gameaction',
    'episode','map','skill','playerstate','health','installEqual','entryEqual','actorEqual',
    'virtualMs','vertexes','lines','sectors','segs','subsectors','nodes','usedown'];
  const extras = ['x','y','angle','momx','momy','turnheld','dclicktime','dclickstate','dclicks',
    'dclicktime2','dclickstate2','dclicks2','rndindex','prndindex','keyUp','keyRight','contributorsValid',
    'buildTick','reactiontime','flags','keyDown','keyLeft','keyFire','keyUse'];
  globalThis.mockExports = {
    stepNeutralControlled: step, a1WasiInitCount: () => 0,
    a1ReadCounter: i => state.counters[counterNames[i]] || 0,
    a21ReadObservation: i => i < 32 ? state.native[names[i]] || 0 :
      i < 42 ? state.native.built[fields[i - 32]] : i < 52 ? state.native.entered[fields[i - 42]] :
      state.native[extras[i - 52]] || 0
  };
  globalThis.replies = []; globalThis.closed = false;
  globalThis.self = {postMessage(data) { replies.push(data); }, close() { closed = true; }};
  const workerSource = titleWorker.toString().replace('  self.onmessage = async',
    '  instance = {exports: mockExports}; a21 = a22 = i11 = true;\\n  self.onmessage = async');
  eval('(' + workerSource + ')()');
  globalThis.workerTest = async () => {
    reset();
    await self.onmessage({data: {op: 'action', mask: 0, tics: 1}});
    await self.onmessage({data: {op: 'action', mask: 51, tics: 6}});
    assert.equal(replies[1].result.outcome, 'APPLIED');
    assert.equal(replies[1].result.completedTics, 6);
    assert.equal(replies[1].result.steps[5].native.usedown, 1);
    assert.equal(replies[1].result.steps[5].native.built.angleturn, -640);
    assert.equal(calls, 7);
    await self.onmessage({data: {op: 'action', mask: 64, tics: 1}});
    await self.onmessage({data: {op: 'action', mask: 0, tics: 21}});
    assert.equal(calls, 7);
    trapAt = calls + 3;
    await self.onmessage({data: {op: 'action', mask: 4, tics: 5}});
    assert.equal(replies[4].result.outcome, 'FAULT');
    assert.equal(replies[4].result.completedTics, 2); assert.equal(closed, true);
    // Stop retires an in-flight Worker and marks the stop flag before cancellation.
    let terminated = false, cancelled = false;
    i11Worker = {terminate() { terminated = true; }};
    i11Cancel = () => { cancelled = true; assert.equal(i11Stopped, true); };
    i11StopButton.onclick();
    assert.equal(terminated, true); assert.equal(cancelled, true); assert.equal(i11Worker, undefined);

    // Main-thread stop/watchdog while a Worker action never replies. No real hang,
    // browser, or elapsed-time claim: manually fire the actual watchdog callback.
    const file = name => ({name, arrayBuffer: async () => new ArrayBuffer(1)});
    document.querySelector('#wasm').files = [file('fixture.wasm')];
    document.querySelector('#wad').files = [file('fixture.wad')];
    document.querySelector('#i11-hash').value = '0'.repeat(64);
    document.querySelector('#i11-browser').value = 'inert browser fixture';
    document.querySelector('#i11-sources').files =
      ['g_game.c','g_game.h','doom_wasm.h','harness.html','test_a21_contracts.py'].map(file);
    const timers = [], workers = [];
    let hangActions = true, unavailableTurnEvidence = false;
    globalThis.setTimeout = callback => { const timer = {callback, pending: true}; timers.push(timer); return timer; };
    globalThis.clearTimeout = timer => { timer.pending = false; };
    globalThis.setInterval = () => 1; globalThis.clearInterval = () => {};
    globalThis.Worker = class {
      constructor() { workers.push(this); }
      terminate() { this.terminated = true; }
      postMessage(data) {
        if (data.op === 'action' && hangActions) return; // Simulated missing reply; no native call.
        if (data.op === 'load-i11') {
          reset(); state.native.ready = 0;
          Object.assign(state.counters, {render: 0, frame: 0, netIntercept: 0});
        } else if (data.op === 'init') {
          ['wasiInit','cInit','engineCreate','titlePrepare','titleReady'].forEach(k => { state.counters[k] = 1; });
        } else if (data.op === 'prepare') {
          Object.assign(state.native, {ready: 1, loadComplete: 1, resources: 1, liveActor: 1,
            gameEligible: 1, episode: 1, map: 1, skill: 2, playerstate: 0, health: 100, gamestate: 0, gameaction: 0});
          if (unavailableTurnEvidence) delete state.native.flags;
        } else if (data.op === 'render') {
          state.counters.render++; state.counters.frame++;
          state.counters.netIntercept += state.counters.gametic ? 5 : 1;
        }
        const status = data.op === 'step' ? step(data.input) : 0;
        const result = data.op === 'action' ? i11Action(data.mask, data.tics, step, () => copy(state)) :
          {status, ...copy(state), ...(data.op === 'render' ? {frameSha256: 'inert-frame-' + state.counters.gametic} : {})};
        const reply = {ok: true, op: data.op, result,
          ...(data.op === 'render' ? {pixels: new ArrayBuffer(1024000)} : {})};
        Promise.resolve().then(() => this.onmessage({data: reply}));
      }
    };
    for (const watchdog of [false, true]) {
      const pending = runI11();
      for (let i = 0; i < 100 && receipt.activeOperation?.op !== 'action'; ++i)
        await new Promise(resolve => setImmediate(resolve));
      assert.equal(receipt.activeOperation?.op, 'action');
      assert.equal(calls, 1); // Only the refused first-input check reached inert native code.
      if (watchdog) timers.find(timer => timer.pending).callback();
      else i11StopButton.onclick();
      await pending;
      assert.equal(receipt.interruptedAction.outcome, 'UNKNOWN/FAULT');
      assert.equal(receipt.interruptedAction.completedTics, null);
      assert.equal(receipt.interruptedAction.tics, 1);
      assert.equal(receipt.interruptedAction.requestedTics, 1);
      assert.equal(receipt.watchdogFired, watchdog);
      assert.equal(workers.at(-1).terminated, true);
      assert.equal(calls, 1); assert.equal(i11Worker, undefined); assert.equal(running, false);
    }
    // Exercise the complete prepared script with inert responses and a manually
    // completed wait. This proves orchestration/counting, never Doom rendering.
    hangActions = false;
    for (const mask of [2, 8]) {
      stuckTurnMask = mask;
      await runI11();
      assert.equal(receipt.checkpoint.startsWith('FAULT'), true);
      assert.match(receipt.error, /Isolated player rotation mismatch/);
      assert.equal(receipt.turnProofs.at(-1).outcome, 'FAULT');
      assert.equal(receipt.turnProofs.at(-1).verifiedTics, 0);
      assert.equal(receipt.turnProofs.filter(p => p.outcome === 'VERIFIED').length, mask === 2 ? 0 : 1);
      assert.equal(state.counters.gametic, mask === 2 ? 2 : 3);
      assert.equal(receipt.operations.some(op => op.op === 'action' && (op.result.mask & 16)), false);
      assert.equal(workers.at(-1).terminated, true);
    }
    stuckTurnMask = 0;
    unavailableTurnEvidence = true;
    await runI11();
    assert.equal(receipt.checkpoint, 'INCONCLUSIVE — stopped; retain verified prefix');
    assert.match(receipt.error, /Isolated turn setup unavailable/);
    assert.equal(receipt.turnProofs.length, 1);
    const proof = receipt.turnProofs[0];
    assert.equal(proof.outcome, 'INCONCLUSIVE'); assert.equal(proof.verifiedTics, 0);
    assert.equal(proof.before.native.flags, undefined); assert.equal(proof.after.native.flags, undefined);
    const completed = receipt.operations.filter(op => op.op === 'action');
    assert.equal(JSON.stringify(completed.map(op => [op.result.mask, op.result.outcome, op.result.completedTics])),
      JSON.stringify([[0, 'APPLIED', 1], [2, 'APPLIED', 1]]));
    assert.equal(state.counters.gametic, 2); assert.equal(proof.after.counters.gametic, 2);
    assert.equal(calls, 3); // First-input refusal plus two contract-verified native tics; no further steps.
    assert.equal(receipt.retired, true); assert.equal(workers.at(-1).terminated, true);
    assert.equal(i11Worker, undefined); assert.equal(running, false);
    unavailableTurnEvidence = false;
    const pending = runI11();
    for (let i = 0; i < 100 && !receipt.checkpoint.startsWith('WAITING'); ++i)
      await new Promise(resolve => setImmediate(resolve));
    assert.equal(receipt.checkpoint.startsWith('WAITING'), true);
    assert.equal(state.counters.gametic, 13);
    const messagesBeforeWait = receipt.operations.length, callsBeforeWait = calls;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(receipt.operations.length, messagesBeforeWait); assert.equal(calls, callsBeforeWait);
    const timer = timers.find(timer => timer.pending); timer.pending = false; timer.callback();
    await pending;
    assert.equal(receipt.checkpoint.startsWith('SCRIPT CHECKS PASSED'), true, receipt.error);
    assert.equal(receipt.freshRunNeutralFirstVerified, true); assert.equal(receipt.wait.unchanged, true);
    assert.equal(JSON.stringify(receipt.turnProofs.map(p => [p.mask, p.outcome, p.verifiedTics])),
      JSON.stringify([[2, 'VERIFIED', 1], [8, 'VERIFIED', 1]]));
    const actions = receipt.operations.filter(op => op.op === 'action');
    assert.equal(JSON.stringify(actions.slice(0, 4).map(op => [op.result.mask, op.result.requestedTics])),
      JSON.stringify([[0, 1], [2, 1], [8, 1], [51, 6]]));
    assert.equal(actions.reduce((n, op) => n + op.result.completedTics, 0), 15);
    assert.equal(actions.at(-2).result.counters.gametic, 14);
    assert.equal(actions.at(-1).result.counters.gametic, 1);
    assert.equal(receipt.operations.filter(op => op.op === 'load-i11').length, 2);
    assert.equal(receipt.retired, true);
  };
`, context);
vm.runInContext('workerTest()', context).catch(error => { console.error(error); process.exitCode = 1; });
"""
        program = program.replace("SCRIPT", json.dumps(script), 1)
        result = subprocess.run(["node", "-e", program], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_fixed_pattern_normalization_passivity_and_message_free_wait(self):
        # Run only JS harness helpers with inert DOM/Worker state; never WASM or Chrome.
        script = re.search(r"<script>(.*?)</script>", (ROOT / "experiments/stage-a/harness.html").read_text(), re.S).group(1)
        program = r"""
const vm = require('node:vm'), assert = require('node:assert/strict');
const elements = new Map();
const document = {querySelector(name) {
  if (!elements.has(name)) elements.set(name, {disabled: false, textContent: '',
    getContext: () => ({clearRect() {}})});
  return elements.get(name);
}, querySelectorAll() { return []; }};
let timer;
const context = vm.createContext({document, assert, performance: {now: () => 123},
  setTimeout: callback => { timer = callback; }, clearTimeout() {}, clearInterval() {}});
vm.runInContext(SCRIPT, context);
vm.runInContext(`
  const accepted = a22Plan.filter(p => p[0] === 'step' && !p[2]).map(p => p[1]);
  assert.equal(JSON.stringify(accepted), JSON.stringify([0,1,1,1,1,2,2,2,2,2,2,0,1,1,2,2,0,1,2,0]));
  const waitAt = a22Plan.findIndex(p => p[0] === 'wait');
  assert.equal(a22Plan.slice(0, waitAt).filter(p => p[0] === 'step' && !p[2]).length, 10);
  const counters = Object.fromEntries(a21Passive.map(k => [k, 0]));
  Object.assign(counters, {render: 1, frame: 1, netIntercept: 1});
  const native = {contributorsValid: 1, rndindex: 17, prndindex: 31, turnheld: 5, x: 12, angle: 42};
  const before = {counters, native};
  const after = {counters: {...counters}, native: {...native}, elapsedMs: 10000};
  a22Verify('snapshot', undefined, before, after);
  assert.throws(() => a22Verify('snapshot', undefined, before,
    {...after, native: {...native, prndindex: 32}}));
  assert.throws(() => a22Verify('snapshot', undefined, before,
    {...after, counters: {...counters, virtualTicks: 1}}));
  const render = {...after, frameSha256: 'abc'};
  assert.equal(JSON.stringify(a22Normalize('render', undefined, render)),
    JSON.stringify(a22Normalize('render', undefined, {...render,
      elapsedMs: 2000, counters: {...counters, render: 999, frame: 999, netIntercept: 999}})));
  assert.notEqual(JSON.stringify(a22Normalize('render', undefined, render)),
    JSON.stringify(a22Normalize('render', undefined, {...render, frameSha256: 'def'})));
  a22Cursor = waitAt; a22WaitMs = 10000; a21Last = before;
  a21Worker = {postMessage() { throw Error('Worker message during wait'); }};
  receipt = {experiment: 'a2.2', operations: []};
`, context);
const pending = vm.runInContext('a22NextButton.onclick()', context);
assert.equal(vm.runInContext('running', context), true);
assert.equal(typeof timer, 'function');
timer();
pending.then(() => {
  assert.equal(vm.runInContext('running', context), false);
  assert.equal(vm.runInContext('receipt.wait.requestedMs', context), 10000);
  assert.equal(vm.runInContext('receipt.operations.length', context), 0);
}).catch(error => { console.error(error); process.exitCode = 1; });
"""
        program = program.replace("SCRIPT", json.dumps(script), 1)
        result = subprocess.run(["node", "-e", program], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)


class NativeTimer(unittest.TestCase):
    def test_actual_timer_reads_are_passive_and_commits_are_exact(self):
        with tempfile.TemporaryDirectory(prefix="doom-a21-timer-") as directory:
            directory = Path(directory)
            source = directory / "timer_test.c"
            source.write_text(r'''#include <assert.h>
#include <stdint.h>
#include "i_timer.h"
uint64_t I_GetTicks(void);
void DG_SleepMs(uint32_t ms) { assert(0); }
int main(int argc, char **argv) {
  for (int i = 0; i < 100; ++i)
    assert(I_GetTime() == 0 && I_GetTimeMS() == 0 && I_GetTicks() == 0);
  for (int n = 1; n <= 20; ++n) {
    I_A21CommitTic(n);
    for (int i = 0; i < 100; ++i)
      assert(I_GetTime() == n && I_GetTimeMS() == n * 1000 / 35 && I_GetTicks() == n * 1000 / 35);
  }
  if (argc > 1) I_A21CommitTic(argv[1][0] == 'd' ? 20 : 22);
  return 0;
}
''')
            executable = directory / "timer_test"
            subprocess.run(["/usr/bin/clang", "-DDOOM_CONTROLLED_TITLE", "-I" + str(ENGINE),
                            "-I" + str(ENGINE / "include"), str(source), str(ENGINE / "src/i_timer.c"),
                            "-o", str(executable)], check=True, capture_output=True)
            subprocess.run([str(executable)], check=True, capture_output=True)
            def no_core():
                resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
            for kind in ("duplicate", "skipped"):
                fault = subprocess.run([str(executable), kind], capture_output=True, preexec_fn=no_core)
                self.assertIn(fault.returncode, (-signal.SIGILL, -signal.SIGTRAP), kind + " commit must trap")


if __name__ == "__main__":
    unittest.main()
