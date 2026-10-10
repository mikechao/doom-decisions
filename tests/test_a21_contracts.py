"""Focused source contracts and executable timer checks; no map/browser claims."""
import hashlib
from pathlib import Path
import re
import resource
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
        self.assertEqual(step.count("G_BuildTiccmd("), 1)
        self.assertEqual(step.count("G_TickerContinuation();"), 1)
        for call in ("G_Ticker(", "TryRunTics(", "BuildNewTic(", "RunTic(", "D_Display("):
            self.assertNotIn(call, step)
        self.assertLess(step.index("netcmds = previous"), step.index("++gametic"))
        self.assertLess(step.index("a21_events[i] == 1"), step.index("++gametic"))
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


class NativeTimer(unittest.TestCase):
    def test_actual_timer_reads_are_passive_and_commit_is_one_shot(self):
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
  I_A21CommitTic(1);
  for (int i = 0; i < 100; ++i)
    assert(I_GetTime() == 1 && I_GetTimeMS() == 28 && I_GetTicks() == 28);
  if (argc > 1) I_A21CommitTic(2);
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
            fault = subprocess.run([str(executable), "second-commit"], capture_output=True, preexec_fn=no_core)
            self.assertLess(fault.returncode, 0, "Second commit must trap, not succeed/refuse")


if __name__ == "__main__":
    unittest.main()
