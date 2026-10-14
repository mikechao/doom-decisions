"""Static WASM inspector checks with synthetic bytes; never instantiate or build Doom."""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[1]


def leb(value, signed=False):
    result = []
    while True:
        byte = value & 127
        value >>= 7
        finished = (value == 0 and (not signed or byte < 64)) or (signed and value == -1 and byte >= 64)
        result.append(byte if finished else byte | 128)
        if finished:
            return bytes(result)


def name(value):
    data = value.encode()
    return leb(len(data)) + data


def vector(items):
    return leb(len(items)) + b"".join(items)


def section(number, data):
    return bytes([number]) + leb(len(data)) + data


def module_fixture(*, controlled=False, without_a1_fixtures=False, start=False, wrong_import=False,
                   mutable_key=False, wrong_signature=False, wrong_export=False,
                   wrong_core_signature=False, wrong_memory=False, wrong_step_signature=False):
    """Hand-encoded inert core sections; no compiler, assembler or instantiation."""
    types = [([], []), ([127], []), ([127, 127], []), ([127, 127, 127], [127]),
             ([127, 127], [127]), ([127], [127]), ([], [126]), ([], [127])]
    imports = [("console", "onErrorMessage", 2), ("console", "onInfoMessage", 2),
               ("gameSaving", "writeSaveGame", 3), ("gameSaving", "readSaveGame", 4),
               ("gameSaving", "sizeOfSaveGame", 5), ("runtimeControl", "timeInMilliseconds", 6),
               ("ui", "unexpected" if wrong_import else "drawFrame", 1),
               ("loading", "readWads", 2), ("loading", "wadSizes", 2), ("loading", "onGameInit", 2)]
    if controlled:
        imports = [item for item in imports if item[0] != "runtimeControl"]
    if wrong_signature:
        imports[0] = ("console", "onErrorMessage", 1)
    keys = [("KEY_LEFTARROW", 172), ("KEY_RIGHTARROW", 174), ("KEY_UPARROW", 173),
            ("KEY_DOWNARROW", 175), ("KEY_STRAFE_L", 160), ("KEY_STRAFE_R", 161),
            ("KEY_FIRE", 163), ("KEY_USE", 162), ("KEY_SHIFT", 182), ("KEY_TAB", 9),
            ("KEY_ESCAPE", 27), ("KEY_ENTER", 13), ("KEY_BACKSPACE", 127), ("KEY_ALT", 184)]
    globals_ = [(True, 65536), (False, 0)] + [(mutable_key and i == 0, v) for i, (_, v) in enumerate(keys)]
    exports = [("memory", 2, 0), ("initGame", 0, 10), ("unexpected" if wrong_export else "tickGame", 0, 11),
               ("reportKeyDown", 0, 12), ("reportKeyUp", 0, 13)]
    if controlled:
        exports = [("memory", 2, 0), ("initControlled", 0, 9), ("renderControlled", 0, 10),
                   ("a1ReadCounter", 0, 11), ("a1WasiInitCount", 0, 12),
                   ("prepareE1M1Controlled", 0, 13), ("stepNeutralControlled", 0, 14),
                   ("a21ReadObservation", 0, 15)]
        if without_a1_fixtures:
            exports = [item for item in exports if item[0] not in ("a1ReadCounter", "a1WasiInitCount", "a21ReadObservation")]
        if wrong_step_signature:
            exports = [(n, k, 13 if n == "stepNeutralControlled" else i) for n, k, i in exports]
        if wrong_core_signature:
            exports[1] = ("initControlled", 0, 11)  # Valid module, wrong public function type.
    exports += [(n, 3, i + 2) for i, (n, _) in enumerate(keys)]
    data = b"\0asm\x01\0\0\0"
    data += section(1, vector([b"\x60" + vector([bytes([v]) for v in p]) +
                              vector([bytes([v]) for v in r]) for p, r in types]))
    data += section(2, vector([name(m) + name(n) + b"\0" + leb(t) for m, n, t in imports]))
    data += section(3, vector([leb(t) for t in ([7, 7, 5, 7, 7, 5, 5] if controlled else [0, 0, 1, 1])]))
    data += section(4, vector([b"\x70\x01" + leb(169) + leb(169)]))
    data += section(5, vector([b"\0" + leb(9 if wrong_memory else 8 if controlled else 72)]))
    data += section(6, vector([b"\x7f" + bytes([int(m)]) + b"\x41" + leb(v, True) + b"\x0b"
                              for m, v in globals_]))
    data += section(7, vector([name(n) + bytes([k]) + leb(i) for n, k, i in exports]))
    if start:
        data += section(8, leb(10))
    # Even the init/start function traps if ever called; static inspection must not call it.
    data += section(10, vector([leb(len(body)) + body for body in ([b"\0\0\x0b"] * 7 if controlled else [b"\0\0\x0b", *[b"\0\x0b"] * 3])]))
    return data


class Fixtures(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="doom-build-fixture-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()


@unittest.skipUnless(shutil.which("node"), "Installed Node required for fixture-only inspection")
class InspectorTests(Fixtures):
    def inspect(self, data, profile=None, without_a1_fixtures=False):
        path = self.root / "fixture.wasm"; path.write_bytes(data)
        argv = [shutil.which("node"), REPO / "scripts/inspect_doom.mjs", path]
        if profile:
            argv += ["--profile", profile]
        if without_a1_fixtures:
            argv += ["--without-a1-fixtures"]
        return subprocess.run(argv,
                              capture_output=True, text=True, timeout=10)

    def test_valid_typed_fixture_is_never_instantiated(self):
        result = self.inspect(module_fixture())
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertFalse(report["instantiated"])
        self.assertFalse(report["exportsCalled"])
        self.assertEqual(len(report["imports"]), 10)
        self.assertEqual(len(report["exports"]), 19)
        self.assertEqual(report["imports"][0]["signature"], [["i32", "i32"], []])
        self.assertEqual(report["memories"][0]["minimum"], 72)
        self.assertEqual(report["tables"][0]["maximum"], 169)

    def test_controlled_typed_fixture_and_profile_isolation(self):
        result = self.inspect(module_fixture(controlled=True), "controlled-title")
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(len(report["imports"]), 9)
        self.assertFalse(report["instantiated"])
        self.assertEqual(next(x["details"] for x in report["exports"]
                              if x["name"] == "initControlled"), [[], ["i32"]])
        signatures = {x["name"]: x["details"] for x in report["exports"] if x["kind"] == "function"}
        self.assertEqual(signatures["prepareE1M1Controlled"], [[], ["i32"]])
        self.assertEqual(signatures["stepNeutralControlled"], [["i32"], ["i32"]])
        self.assertEqual(signatures["a21ReadObservation"], [["i32"], ["i32"]])
        self.assertNotEqual(self.inspect(module_fixture(controlled=True, wrong_step_signature=True),
                                        "controlled-title").returncode, 0)
        self.assertNotEqual(self.inspect(module_fixture(), "controlled-title").returncode, 0)
        self.assertNotEqual(self.inspect(module_fixture(controlled=True)).returncode, 0)

    def test_invalid_interface_and_bytes_fail(self):
        for data, error in [(module_fixture(start=True), "start section"),
                            (module_fixture(wrong_import=True), "Unexpected import"),
                            (module_fixture(wrong_export=True), "Unexpected core export"),
                            (module_fixture(wrong_signature=True), "Unexpected import/signature"),
                            (module_fixture(mutable_key=True), "key global"),
                            (b"not wasm", "validate failed")]:
            with self.subTest(error=error):
                result = self.inspect(data)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(error, result.stderr)

    def test_fixture_disabled_exact_interface_and_isolation(self):
        data = module_fixture(controlled=True, without_a1_fixtures=True)
        result = self.inspect(data, "controlled-title", True)
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertFalse(report["a1Fixtures"])
        self.assertFalse(report["instantiated"])
        self.assertEqual(len(report["imports"]), 9)
        self.assertEqual(len(report["exports"]), 19)
        self.assertFalse({"a1ReadCounter", "a1WasiInitCount", "a21ReadObservation"} & {x["name"] for x in report["exports"]})
        self.assertNotEqual(self.inspect(data, "controlled-title").returncode, 0)
        self.assertNotEqual(self.inspect(module_fixture(controlled=True), "controlled-title", True).returncode, 0)
        self.assertNotEqual(self.inspect(module_fixture(), "upstream-shareware", True).returncode, 0)

    def test_fixture_disabled_rejects_wrong_signatures_keys_and_memory(self):
        for change, message in [("wrong_core_signature", "core export"), ("wrong_signature", "import/signature"),
                                ("mutable_key", "key global"), ("wrong_memory", "memory limits")]:
            with self.subTest(change=change):
                data = module_fixture(controlled=True, without_a1_fixtures=True, **{change: True})
                result = self.inspect(data, "controlled-title", True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(message, result.stderr)


if __name__ == "__main__":
    unittest.main()
