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
        # Execute the real functions with inert dependencies. The continuation
        # fixture supplies boundaries; this is not an E1M1/runtime compatibility test.
        controls = (ENGINE / "src/m_controls.c").read_text()
        program = r"""#include <assert.h>
#include <string.h>
#include "doomstat.h"
#include "doomkeys.h"
#include "g_game.h"
#include "i_timer.h"
#include "m_controls.h"
#include "i_video.h"
#define A1_COUNT(x) ((void)0)
"""
        program += controls[controls.index("int key_right ="):controls.index("void M_BindBaseControls")]
        program += GAME[GAME.index("gameaction_t gameaction;"):GAME.index("#define MAXPLMOVE")]
        program += GAME[GAME.index("#define MAXPLMOVE"):GAME.index("static int savegameslot;")]
        program += "static int savegameslot; int ticdup = 1, gametic, leveltime; boolean menuactive; ticcmd_t *netcmds;\n"
        program += GAME[GAME.index("static boolean a21_load_attempted"):GAME.index("extern boolean advancedemo;")]
        program += r"""
int rndindex = 5, prndindex = 7;
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
static void G_TickerContinuation(void) {
  players[0].cmd = netcmds[0];
  if (fault_kind == 3) ++players[0].cmd.forwardmove;
  G_A21Install(0, &players[0].cmd);
  if (fault_kind == 2) G_A21BuildEntry(gametic);
  G_A21PlayerEntry(&players[0]);
  players[0].usedown = false;
  ++leveltime;
  if (fault_kind != 1) G_A21Boundary(A21_WORLD);
  G_A21Boundary(A21_STATUS); G_A21Boundary(A21_AUTOMAP); G_A21Boundary(A21_HUD);
  if (fault_kind == 4) ++gametic;
  if (fault_kind == 5) G_A21Boundary(A21_WORLD);
  if (fault_kind == 6) players[0].mo = NULL;
}
static void refusal(int input) {
  int events[A21_EVENT_LIMIT], keys[256];
  ticcmd_t built = a21_built, entered = a21_entered;
  int held = turnheld, dc1 = dclicktime, dc2 = dclicktime2, time = I_GetTime();
  memcpy(events, a21_events, sizeof(events));
  for (int i = 0; i < 256; ++i) keys[i] = gamekeydown[i];
  assert(G_A21Step(input) == -1);
  assert(!memcmp(events, a21_events, sizeof(events)));
  assert(!memcmp(&built, &a21_built, sizeof(built)) && !memcmp(&entered, &a21_entered, sizeof(entered)));
  for (int i = 0; i < 256; ++i) assert(keys[i] == gamekeydown[i]);
  assert(turnheld == held && dclicktime == dc1 && dclicktime2 == dc2 && I_GetTime() == time);
  G_A21CheckPassive();
}
int main(int argc, char **argv) {
  mobj_t actor = {0}; ticcmd_t prior[MAXPLAYERS] = {{0}};
  players[0].mo = a21_actor = &actor; a21_load_complete = true; netcmds = prior;
  for (int i = 0; i < BACKUPTICS; ++i) consistancy[0][i] = i + 1;
  refusal(1); refusal(2); refusal(3); refusal(-1);
  if (argc > 1) fault_kind = argv[1][0] - '0';
  int inputs[] = {0,1,1,1,1,2,2,2,2,2,2,0,1,1,2,2,0,1,2,0};
  int held = 0;
  for (int n = 0; n < 20; ++n) {
    int input = inputs[n]; held = input == 2 ? held + 1 : 0;
    assert(G_A21Step(input) == 0 && netcmds == prior);
    assert(gametic == n + 1 && leveltime == n + 1 && I_GetTime() == n + 1);
    for (int i = 0; i < A21_EVENT_LIMIT; ++i) assert(a21_events[i] == n + 1);
    assert(a21_build_tick == n && a21_built.consistancy == n + 1);
    assert(turnheld == held && a21_built.forwardmove == (input == 1 ? 25 : 0));
    assert(a21_built.angleturn == (input == 2 ? (held < 6 ? -320 : -640) : 0));
    assert(dclicktime == n + 1 && dclicktime2 == n + 1 && !dclickstate && !dclickstate2 && !dclicks && !dclicks2);
    assert(gamekeydown[key_up] == (input == 1) && gamekeydown[key_right] == (input == 2));
    for (int i = 0; i < 100; ++i) G_A21CheckPassive();
#ifndef DOOM_A1_NO_FIXTURES
    int snapshot[72];
    for (int i = 0; i < 72; ++i) snapshot[i] = G_A21Observe(i);
    for (int j = 0; j < 100; ++j)
      for (int i = 0; i < 72; ++i) assert(G_A21Observe(i) == snapshot[i]);
    assert(rndindex == 5 && prndindex == 7 && I_GetTime() == n + 1);
#endif
    refusal(3);
    paused = true; refusal(input); paused = false;
    menuactive = true; refusal(input); menuactive = false;
    gameaction = ga_newgame; refusal(input); gameaction = ga_nothing;
    lowres_turn = true; refusal(input); lowres_turn = false;
    mousex = 1; refusal(input); mousex = 0;
    gamekeydown[key_speed] = true; refusal(input); gamekeydown[key_speed] = false;
    int saved = key_up; key_up = key_fire; refusal(input); key_up = saved;
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
                for kind in range(1, 7):
                    fault = subprocess.run([str(executable), str(kind)], capture_output=True, preexec_fn=no_core)
                    self.assertIn(fault.returncode, (-signal.SIGILL, -signal.SIGTRAP), "Contradiction must trap: " + str(kind))


class HarnessIsolation(unittest.TestCase):
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
