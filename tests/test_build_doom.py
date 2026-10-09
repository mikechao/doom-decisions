"""Fail-closed checks with synthetic bytes and fake tools, never a Doom build."""
import argparse
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

REPO = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("build_doom", REPO / "scripts/build_doom.py")
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


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
                   wrong_core_signature=False, wrong_memory=False):
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
                   ("a1ReadCounter", 0, 11), ("a1WasiInitCount", 0, 12)]
        if without_a1_fixtures:
            exports = [item for item in exports if item[0] not in ("a1ReadCounter", "a1WasiInitCount")]
        if wrong_core_signature:
            exports[1] = ("initControlled", 0, 11)  # Valid module, wrong public function type.
    exports += [(n, 3, i + 2) for i, (n, _) in enumerate(keys)]
    data = b"\0asm\x01\0\0\0"
    data += section(1, vector([b"\x60" + vector([bytes([v]) for v in p]) +
                              vector([bytes([v]) for v in r]) for p, r in types]))
    data += section(2, vector([name(m) + name(n) + b"\0" + leb(t) for m, n, t in imports]))
    data += section(3, vector([leb(t) for t in ([7, 7, 5, 7] if controlled else [0, 0, 1, 1])]))
    data += section(4, vector([b"\x70\x01" + leb(169) + leb(169)]))
    data += section(5, vector([b"\0" + leb(9 if wrong_memory else 8 if controlled else 72)]))
    data += section(6, vector([b"\x7f" + bytes([int(m)]) + b"\x41" + leb(v, True) + b"\x0b"
                              for m, v in globals_]))
    data += section(7, vector([name(n) + bytes([k]) + leb(i) for n, k, i in exports]))
    if start:
        data += section(8, leb(10))
    # Even the init/start function traps if ever called; static inspection must not call it.
    data += section(10, vector([leb(len(body)) + body for body in ([b"\0\0\x0b"] * 4 if controlled else [b"\0\0\x0b", *[b"\0\x0b"] * 3])]))
    return data


class Fixtures(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="doom-build-fixture-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()

    def run_dir(self):
        out = self.root / "out"
        (out / "evidence").mkdir(parents=True)
        return out


class BuildTests(Fixtures):
    def setUp(self):
        super().setUp()
        self.vendor = self.root / "vendor"
        self.sdk, self.binaryen = self.root / "sdk", self.root / "binaryen"
        self.args = argparse.Namespace(profile="upstream-shareware", out=str(self.vendor / "build/run"),
            embed_wad=str(self.root / "DOOM1.WAD"), wasi_sdk=str(self.sdk),
            binaryen_bin=str(self.binaryen), node=str(self.root / "node"), jobs=2, timeout=120,
            without_a1_fixtures=False)
        files = ["vendor/Makefile", "vendor/utils/generate_code_for_embedded_file.py",
                 "vendor/src/reachability_graph_for_wasm-metadce.json", "vendor/src/wat/fixture.wat",
                 "scripts/build_doom.py", "scripts/inspect_doom.mjs", "make", "node",
                 "vendor/src/wat/controlled-title-init.wat", "vendor/src/wat/controlled-title-init-no-fixtures.wat",
                 "vendor/src/reachability-controlled-title.json", "vendor/src/reachability-controlled-title-no-fixtures.json",
                 "sdk/bin/clang", "sdk/bin/wasm-ld", "binaryen/wasm-as", "binaryen/wasm-merge",
                 "binaryen/wasm-metadce", "sdk/share/wasi-sysroot/include/wasm32-wasi/stdio.h",
                 "sdk/share/wasi-sysroot/lib/wasm32-wasi/libc.a", "sdk/share/wasi-sysroot/lib/wasm32-wasi/libm.a",
                 "sdk/share/wasi-sysroot/lib/wasm32-wasi/crt1-reactor.o",
                 "sdk/lib/clang/18/lib/wasi/libclang_rt.builtins-wasm32.a"]
        for name_ in files:
            path = self.root / name_
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("inert fixture; never executable code")
            path.chmod(0o755)
        # Synthetic directory structure; admission uses a fixture-only patched digest.
        data = bytearray(4196020)
        struct.pack_into("<4sii", data, 0, b"IWAD", 1264, len(data) - 16 * 1264)
        Path(self.args.embed_wad).write_bytes(data)
        self.args.embed_sha256 = hashlib.sha256(data).hexdigest()
        self.starts, self.mode, self.launch_event = [], "ok", None
        self.child = mock.Mock(pid=12345, poll=mock.Mock(return_value=0), wait=mock.Mock(return_value=0))
        stack = contextlib.ExitStack()
        self.addCleanup(stack.close)
        for field, value in [("ROOT", self.root), ("VENDOR", self.vendor), ("MAKE", self.root / "make"),
                             ("SHAREWARE_SHA256", self.args.embed_sha256)]:
            stack.enter_context(mock.patch.object(build, field, value))
        self.git = stack.enter_context(mock.patch.object(build.subprocess, "check_output", side_effect=self.git_output))
        self.start = stack.enter_context(mock.patch.object(build.subprocess, "Popen", side_effect=self.launch))
        self.signals = stack.enter_context(mock.patch.object(build.os, "killpg"))
        stack.enter_context(mock.patch.object(build.shutil, "disk_usage", return_value=mock.Mock(free=1024**3)))

    def git_output(self, argv, **kwargs):
        return b"fixture patch\n" if "diff" in argv else b"fixture metadata\n"

    def launch(self, argv, **kwargs):
        self.starts.append(argv)
        if argv[-1] == "--version":
            versions = {"clang": "clang version 18.1.2-wasi-sdk fixture", "wasm-ld": "LLD 18.1.2",
                        "make": "GNU Make 3.81", "node": "v22.20.0"}
            version = "wrong version" if self.mode == "version" else versions.get(Path(argv[0]).name, Path(argv[0]).name + " version 119")
            kwargs["stdout"].write((version + "\n").encode())
            return mock.Mock(poll=mock.Mock(return_value=0))
        if argv[-1] == "local-build":
            kwargs["stderr"].write(b"fixture Make log\n")
            if self.mode == "launch-error":
                raise OSError("fixture launch error")
            if self.mode != "missing":
                (Path(self.args.out) / "doom.wasm").write_bytes(module_fixture())
            if self.launch_event:
                self.launch_event()
            self.child.poll.return_value = 7 if self.mode == "make" else 0
            return self.child
        self.assertEqual(Path(argv[1]).name, "inspect_doom.mjs")
        final = build.identity(argv[2])
        kwargs["stdout"].write(json.dumps({**final, "validate": True, "instantiated": False,
                                          "exportsCalled": False, "startSection": False}).encode())
        return mock.Mock(poll=mock.Mock(return_value=9 if self.mode == "inspection" else 0))

    def invoke(self):
        with contextlib.redirect_stdout(io.StringIO()):
            build.execute_build(self.args)
        return self.manifest()

    def manifest(self):
        return json.loads((Path(self.args.out) / "evidence/manifest.json").read_text())

    def test_controlled_profile_omits_embed_input(self):
        self.args.profile = "controlled-title"
        self.args.embed_wad = self.args.embed_sha256 = None
        manifest = self.invoke()
        self.assertIsNone(manifest["asset"])
        self.assertFalse(any(a.startswith("LOCAL_EMBED_WAD=") for a in manifest["make"]["argv"]))
        self.assertEqual(manifest["inspection"]["argv"][-2:], ["--profile", "controlled-title"])
        self.assertTrue(manifest["controlled_title"]["a1_fixtures"])
        self.assertEqual(manifest["controlled_title"]["defines"], ["DOOM_CONTROLLED_TITLE"])
        self.assertFalse(any(a.startswith("A1_FIXTURES=") for a in manifest["make"]["argv"]))

    def test_fixture_disabled_mode_admission_and_selected_inputs(self):
        self.args.without_a1_fixtures = True
        with self.assertRaisesRegex(build.BuildError, "requires controlled-title"):
            self.invoke()
        self.start.assert_not_called()
        self.args.profile = "controlled-title"
        self.args.embed_wad = self.args.embed_sha256 = None
        manifest = self.invoke()
        selected = manifest["controlled_title"]
        self.assertFalse(selected["a1_fixtures"])
        self.assertEqual(selected["defines"], ["DOOM_CONTROLLED_TITLE", "DOOM_A1_NO_FIXTURES"])
        self.assertIn("A1_FIXTURES=0", manifest["make"]["argv"])
        self.assertEqual(manifest["inspection"]["argv"][-3:],
                         ["--profile", "controlled-title", "--without-a1-fixtures"])
        for key in ("init_wat", "reachability_graph"):
            path = Path(selected[key]["path"])
            self.assertIn("no-fixtures", path.name)
            self.assertEqual((Path(self.args.out) / "evidence/sources" / path.name).read_bytes(), path.read_bytes())
        self.assertIsNone(manifest["asset"])

    def test_controlled_profile_refuses_embed_arguments_before_tools(self):
        self.args.profile = "controlled-title"
        with self.assertRaisesRegex(build.BuildError, "forbids embedded"):
            build.execute_build(self.args)
        self.start.assert_not_called()

    def test_safe_invocation_manifest_and_source_evidence(self):
        manifest = self.invoke()
        argv = manifest["make"]["argv"]
        self.assertEqual(argv, [str(self.root / "make"), "-rR", "-j2", "VERBOSE=1",
            "BUILD_PROFILE=upstream-shareware", "LOCAL_ADMITTED=1", "OUTPUT_DIR=" + self.args.out,
            "LOCAL_EMBED_WAD=" + self.args.embed_wad, "LOCAL_WASI_SDK=" + str(self.sdk),
            "LOCAL_BINARYEN_BIN=" + str(self.binaryen), "LOCAL_PYTHON=" + str(Path(sys.executable).resolve()),
            "local-build"])
        self.assertEqual(manifest["make"]["cwd"], str(self.vendor))
        self.assertEqual(manifest["status"], "BUILD PASS")
        self.assertEqual(manifest["a1_acceptance"], "NOT ESTABLISHED")
        self.assertEqual(manifest["final"]["sha256"], hashlib.sha256(module_fixture()).hexdigest())
        self.assertTrue(manifest["executables_revalidated_at_closeout"])
        self.assertGreater(manifest["output_bytes_before_manifest_closeout"], manifest["final"]["bytes"])
        evidence = Path(self.args.out) / "evidence"
        self.assertEqual((evidence / "sources/local.patch").read_bytes(), b"fixture patch\n")
        for name_ in ("build_doom.py", "inspect_doom.mjs"):
            self.assertEqual((evidence / "sources" / name_).read_bytes(), (self.root / "scripts" / name_).read_bytes())
        self.assertEqual([p.name for p in evidence.rglob("*.json")], ["manifest.json"])
        self.assertEqual(len([a for a in self.starts if a[-1] == "local-build"]), 1)

    def test_existing_disallowed_and_symlink_outputs_start_nothing(self):
        out = Path(self.args.out)
        out.mkdir(parents=True)
        marker = out / "owner"; marker.write_text("keep")
        link = self.root / "link"; link.symlink_to(out, target_is_directory=True)
        for path, error in [(out, "already exists"), (self.root / "elsewhere", "beneath ignored"),
                            (link / "new", "symlinks")]:
            with self.subTest(path=path):
                self.args.out = str(path)
                with self.assertRaisesRegex(build.BuildError, error):
                    self.invoke()
        self.start.assert_not_called()
        self.assertEqual(marker.read_text(), "keep")

    def test_unsafe_supplied_and_resolved_inputs_rejected_before_processes(self):
        for target_name in ("unsafe target", "sdk$(shell fixture_payload)", "unsafe;payload"):
            target = self.root / target_name; target.mkdir()
            alias = self.root / "alias"; alias.symlink_to(target)
            for field in ("embed_wad", "wasi_sdk", "binaryen_bin", "node", "python"):
                with self.subTest(target=target_name, field=field):
                    obj, attr = (build.sys, "executable") if field == "python" else (self.args, field)
                    with mock.patch.object(obj, attr, str(alias)):
                        with self.assertRaisesRegex(build.BuildError, "unsupported whitespace/Make/shell"):
                            self.invoke()
            alias.unlink()
            with self.assertRaises(build.BuildError):
                build.safe_path(target)
        self.start.assert_not_called()
        self.git.assert_not_called()
        self.assertFalse(Path(self.args.out).exists())

    def test_missing_tools_sdk_inputs_and_nonignored_paths_fail_before_make(self):
        for relative, error in [("sdk/bin/clang", "Executable missing"),
                                ("sdk/share/wasi-sysroot/lib/wasm32-wasi/libc.a", "Missing SDK input")]:
            with self.subTest(path=relative):
                path = self.root / relative; saved = path.with_name("saved")
                path.rename(saved)
                with self.assertRaisesRegex(build.BuildError, error):
                    self.invoke()
                saved.rename(path)
        self.git.side_effect = None; self.git.return_value = b""
        with self.assertRaisesRegex(build.BuildError, "not Git-ignored"):
            self.invoke()
        self.start.assert_not_called()

    def test_wad_identity_and_structure_failures(self):
        wad = Path(self.args.embed_wad)
        original = wad.read_bytes()
        for kind, error in [("missing", "local file"), ("length", "length"), ("header", "directory"),
                            ("lump", "lump bounds"), ("hash", "SHA-256 mismatch")]:
            with self.subTest(kind=kind):
                if kind == "missing":
                    wad.unlink()
                else:
                    data = bytearray(original)
                    if kind == "length": data = data[:20]
                    if kind == "header": data[:4] = b"PWAD"
                    if kind == "lump": struct.pack_into("<ii", data, len(data) - 16 * 1264, len(data), 1)
                    if kind == "hash": data[12] = 1
                    wad.write_bytes(data)
                with self.assertRaisesRegex(build.BuildError, error):
                    self.invoke()
                wad.write_bytes(original)
        self.args.embed_sha256 = "0" * 64
        with self.assertRaisesRegex(build.BuildError, "checked shareware"):
            self.invoke()
        self.start.assert_not_called()

    def test_failures_preserve_manifest_and_never_report_success(self):
        for mode, error in [("version", "Mismatched"), ("missing", "final copied"),
                            ("inspection", "inspection exited"), ("launch-error", "launch error"),
                            ("make", "make exited 7")]:
            with self.subTest(mode=mode):
                self.mode = mode; self.args.out = str(self.vendor / "build" / mode)
                with self.assertRaisesRegex((build.BuildError, OSError), error):
                    self.invoke()
                manifest = self.manifest()
                self.assertEqual(manifest["status"], "FAIL")
                self.assertIn(error, manifest["error"])
                if mode == "version":
                    self.assertNotIn("make", manifest)
                else:
                    self.assertEqual(manifest["make"]["argv"][-1], "local-build")

    def test_unchanged_alias_passes_and_persistent_retarget_fails_closeout(self):
        for name_ in ("clang", "wasm-ld"):
            with self.subTest(tool=name_):
                self.launch_event = None
                self.args.out = str(self.vendor / "build" / (name_ + "-safe"))
                alias = self.sdk / "bin" / name_
                target = alias.with_name(name_ + "-target")
                alias.rename(target); alias.symlink_to(target)
                admitted = build.executable_identity(alias)
                manifest = self.invoke()
                self.assertEqual(manifest["tools"][name_]["invoked_path"], str(alias))
                self.assertEqual(manifest["tools"][name_]["path"], str(target))
                alternative = target.with_name(name_ + "-alternative")
                alternative.write_bytes(target.read_bytes()); alternative.chmod(0o755)
                self.args.out = str(self.vendor / "build" / (name_ + "-retarget"))
                def retarget():
                    alias.unlink(); alias.symlink_to(alternative)
                self.launch_event = retarget
                with self.assertRaisesRegex(build.BuildError, "Executable target changed"):
                    self.invoke()
                self.assertEqual(self.manifest()["status"], "FAIL")
                alias.unlink(); alias.symlink_to(target)
                target.write_text("changed bytes")
                with self.assertRaisesRegex(build.BuildError, "contents changed"):
                    build.revalidate_executable(admitted)
                alias.unlink()
                with self.assertRaisesRegex(build.BuildError, "missing"):
                    build.revalidate_executable(admitted)
                alias.symlink_to(target)

    def test_launch_and_postlaunch_signals_cleanup_evidence_exit_and_restoration(self):
        for signum in (build.signal.SIGTERM, build.signal.SIGINT):
            for during_launch in (True, False):
                with self.subTest(signal=signum, during_launch=during_launch):
                    self.args.out = str(self.vendor / "build" / f"cancel-{signum}-{during_launch}")
                    previous = {sig: mock.Mock() for sig in (build.signal.SIGTERM, build.signal.SIGINT)}
                    handlers = dict(previous)
                    def register(sig, handler):
                        handlers[sig] = handler
                    def cancel():
                        self.assertIsNone(handlers[signum](signum, None))
                    self.launch_event = cancel if during_launch else None
                    self.child.poll.reset_mock()
                    self.child.poll.side_effect = None if during_launch else lambda: (cancel(), None)[1]
                    self.signals.reset_mock()
                    with mock.patch.object(build.signal, "getsignal", side_effect=previous.get), \
                            mock.patch.object(build.signal, "signal", side_effect=register) as registration, \
                            contextlib.redirect_stderr(io.StringIO()):
                        argv = ["--profile", "upstream-shareware", "--embed-wad", self.args.embed_wad,
                                "--embed-sha256", self.args.embed_sha256, "--out", self.args.out,
                                "--wasi-sdk", str(self.sdk), "--binaryen-bin", str(self.binaryen),
                                "--node", self.args.node]
                        self.assertEqual(build.main(argv), 128 + signum)
                    self.assertEqual(self.signals.call_args_list, [mock.call(12345, build.signal.SIGTERM),
                                                                   mock.call(12345, build.signal.SIGKILL)])
                    self.child.wait.assert_called_with(timeout=5)
                    self.assertEqual(self.manifest()["status"], "FAIL")
                    self.assertIn("BuildCancelled", self.manifest()["error"])
                    self.assertTrue((Path(self.args.out) / "evidence/make.stderr.log").exists())
                    self.assertEqual(registration.call_count, 4)
                    self.assertEqual(handlers, previous)
                    self.assertIsNone(build._pending_signal)
                    if during_launch:
                        self.child.poll.assert_not_called()


class ExecutionTests(Fixtures):
    def test_timeout_nonzero_interrupt_and_launch_error(self):
        for kind, error in [("timeout", build.BuildError), ("nonzero", build.BuildError),
                            ("interrupt", KeyboardInterrupt), ("launch", OSError)]:
            with self.subTest(kind=kind):
                out = self.root / kind; (out / "evidence").mkdir(parents=True)
                child = mock.Mock(pid=12345, poll=mock.Mock(return_value=7), wait=mock.Mock(return_value=0))
                if kind == "interrupt": child.poll.side_effect = KeyboardInterrupt
                with mock.patch.object(build.subprocess, "Popen", return_value=child,
                                       side_effect=OSError("fixture") if kind == "launch" else None) as start, \
                        mock.patch.object(build.os, "killpg") as signals, \
                        mock.patch.object(build.time, "monotonic", side_effect=[0, 2] if kind == "timeout" else None,
                                          return_value=0):
                    with self.assertRaises(error):
                        build.supervise(["fixture"], self.root, {}, out, "fixture", 1)
                if kind == "launch":
                    signals.assert_not_called()
                    child.wait.assert_not_called()
                else:
                    self.assertTrue(start.call_args.kwargs["start_new_session"])
                    self.assertNotIn("preexec_fn", start.call_args.kwargs)
                    self.assertEqual(signals.call_count, 2)
                    child.wait.assert_called_with(timeout=5)

    def test_pending_cancellation_before_launch_and_handler_restoration(self):
        for signum in (build.signal.SIGTERM, build.signal.SIGINT):
            with self.subTest(signal=signum), mock.patch.object(build, "_pending_signal", signum), \
                    mock.patch.object(build.subprocess, "Popen") as start:
                with self.assertRaises(build.BuildCancelled) as error:
                    build.supervise(["fixture"], self.root, {}, self.root, "fixture", time.monotonic() + 1)
                self.assertEqual(error.exception.signum, signum)
                start.assert_not_called()
        for exception, result in [(None, 0), (build.BuildError("fixture"), 1), (KeyboardInterrupt(), 130)]:
            with self.subTest(result=result), mock.patch.object(build.signal, "signal") as register, \
                    mock.patch.object(build.signal, "getsignal", return_value=build.signal.SIG_DFL), \
                    mock.patch.object(build, "execute_build", side_effect=exception), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(build.main(["--profile", "upstream-shareware", "--embed-wad", "fixture",
                    "--embed-sha256", "fixture", "--out", "fixture"]), result)
                self.assertEqual(register.call_args_list[-2:], [mock.call(build.signal.SIGTERM, build.signal.SIG_DFL),
                                                               mock.call(build.signal.SIGINT, build.signal.SIG_DFL)])

    def test_escalation_reaping_and_signal_denial(self):
        child = mock.Mock(pid=12345)
        child.wait.side_effect = [subprocess.TimeoutExpired("fixture", 0.1), 0]
        with mock.patch.object(build.os, "killpg") as signals:
            build.terminate_group(child)
        self.assertEqual(signals.call_args_list, [mock.call(12345, build.signal.SIGTERM), mock.call(12345, build.signal.SIGKILL)])
        child.wait.assert_called_with(timeout=5)
        child.wait.side_effect = None
        with mock.patch.object(build.os, "killpg", side_effect=PermissionError("fixture")):
            with self.assertRaisesRegex(build.BuildError, "containment unavailable"):
                build.terminate_group(child)
        child.kill.assert_called_once()

    def test_invalid_cli_starts_nothing(self):
        with mock.patch.object(build.subprocess, "Popen") as start, contextlib.redirect_stderr(io.StringIO()):
            for argv in (["--profile", "controlled-no-embed"],
                         ["--profile", "upstream-shareware", "--jobs", "3"]):
                with self.assertRaises(SystemExit):
                    build.main(argv)
            start.assert_not_called()

    def test_environment_drops_ambient_injection(self):
        with mock.patch.dict(os.environ, {"MAKEFLAGS": "unsafe", "NODE_OPTIONS": "unsafe", "OPENAI_API_KEY": "fixture"}):
            env = build.controlled_environment(self.root, 2)
        self.assertFalse({"MAKEFLAGS", "NODE_OPTIONS", "OPENAI_API_KEY", "CFLAGS", "PYTHONPATH"} & env.keys())

    def test_git_read_disables_optional_writes_and_fsmonitor(self):
        with mock.patch.object(build.subprocess, "check_output", return_value=b"fixture") as read:
            build.git_read("status", "--porcelain=v1")
        self.assertIn("--no-optional-locks", read.call_args.args[0])
        self.assertIn("core.fsmonitor=false", read.call_args.args[0])
        self.assertNotIn("GIT_CONFIG_PARAMETERS", read.call_args.kwargs["env"])


@unittest.skipUnless(os.environ.get("DOOM_BUILD_PROCESS_INTEGRATION") == "1",
                     "Real group signaling requires separate authorization and a permitted host")
class ProcessGroupIntegrationTests(Fixtures):
    def test_real_timeout_reaps_inert_owned_process(self):
        out = self.run_dir()
        processes = []
        original_start = subprocess.Popen
        def start_owned(*args, **kwargs):
            process = original_start(*args, **kwargs)
            processes.append(process)
            return process
        with mock.patch.object(build.subprocess, "Popen", side_effect=start_owned):
            with self.assertRaisesRegex(build.BuildError, "deadline"):
                build.supervise([sys.executable, "-c", "import time; time.sleep(10)"],
                                self.root, build.controlled_environment(out, 1), out, "fixture",
                                time.monotonic() + 0.15)
        self.assertEqual(len(processes), 1)
        self.assertIsNotNone(processes[0].returncode)


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
        self.assertEqual(len(report["exports"]), 17)
        self.assertFalse({"a1ReadCounter", "a1WasiInitCount"} & {x["name"] for x in report["exports"]})
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
