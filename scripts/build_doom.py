#!/usr/bin/env python3
"""Admit a local Doom experiment; Make owns every build recipe."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import struct
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / "references/doom.wasm"
MAKE = Path("/usr/bin/make")
SHAREWARE_SHA256 = "1d7d43be501e67d927e415e0b8f3e29c3bf33075e859721816f652a526cac771"
_pending_signal = None


class BuildError(RuntimeError):
    pass


class BuildCancelled(BuildError):
    def __init__(self, signum):
        super().__init__(f"Cancelled by {signal.Signals(signum).name}")
        self.signum = signum


def check_cancellation():
    if _pending_signal is not None:
        raise BuildCancelled(_pending_signal)


def require(condition, message):
    if not condition:
        raise BuildError(message)


def safe_path(value):
    path = Path(value).absolute()
    resolved = path.resolve()
    for candidate in (path, resolved):
        require(re.fullmatch(r"[A-Za-z0-9_./@+-]+", str(candidate)),
                f"Path contains unsupported whitespace/Make/shell characters: {candidate}")
    return resolved


def identity(path):
    path = Path(path)
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024**2), b""):
            digest.update(chunk)
    return {"path": str(path), "bytes": path.stat().st_size, "sha256": digest.hexdigest()}


def executable_identity(invoked_path, admitted_target=None):
    invoked_path = Path(invoked_path).absolute()
    target = safe_path(invoked_path)
    require(target.is_file() and os.access(invoked_path, os.X_OK),
            f"Executable missing or inaccessible: {invoked_path}")
    if admitted_target is not None:
        require(str(target) == admitted_target, f"Executable target changed: {invoked_path}")
    return {**identity(target), "invoked_path": str(invoked_path)}


def revalidate_executable(admitted):
    current = executable_identity(admitted["invoked_path"], admitted_target=admitted["path"])
    require(current["sha256"] == admitted["sha256"] and current["bytes"] == admitted["bytes"],
            f"Executable contents changed: {admitted['invoked_path']}")


def atomic_json(path, value):
    temporary = path.with_name("." + path.name + ".tmp")
    with temporary.open("x") as stream:
        json.dump(value, stream, indent=2, sort_keys=True)
        stream.write("\n")
    os.replace(temporary, path)


def terminate_group(process):
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(process.pid, sig)
        except ProcessLookupError:
            pass
        except PermissionError as error:
            process.kill()
            process.wait(timeout=5)
            raise BuildError("Host denied process-group termination; containment unavailable") from error
        if sig == signal.SIGTERM:
            try:
                process.wait(timeout=0.1)
            except subprocess.TimeoutExpired:
                pass
            # Descendants may survive a reaped parent; still signal the group.
    process.wait(timeout=5)


def supervise(argv, cwd, env, out, stage, deadline):
    """Own one session child; deferred signals cannot interrupt registration."""
    check_cancellation()
    require(time.monotonic() < deadline, "Run deadline reached")
    process = None
    log = out / "evidence" / stage
    try:
        with log.with_suffix(".stdout.log").open("xb") as stdout, \
                log.with_suffix(".stderr.log").open("xb") as stderr:
            process = subprocess.Popen([str(x) for x in argv], cwd=cwd, env=env,
                                       stdout=stdout, stderr=stderr, start_new_session=True)
            check_cancellation()  # Handle registered before pending intent raises.
            while True:
                check_cancellation()
                require(time.monotonic() < deadline, "Run deadline reached")
                code = process.poll()
                check_cancellation()
                if code is not None:
                    require(code == 0, f"{stage} exited {code}; see {log}.stderr.log")
                    return
                time.sleep(0.05)
    except BaseException as error:
        if process is not None:
            try:
                terminate_group(process)
            except Exception as cleanup:
                raise BuildError(f"{type(error).__name__}: {error}; cleanup failed: {cleanup}") from error
        raise


def validate_wad(path, expected):
    require(path.name == "DOOM1.WAD" and path.is_file(), "Require a local file named DOOM1.WAD")
    require(expected == SHAREWARE_SHA256, "This profile admits only the checked shareware v1.9 SHA-256")
    require(path.stat().st_size == 4196020, "Expected shareware v1.9 length: 4,196,020")
    data = path.read_bytes()
    magic, count, offset = struct.unpack_from("<4sii", data)
    require(magic == b"IWAD" and count == 1264 and offset >= 12 and
            offset + 16 * count == len(data), "Invalid expected shareware IWAD directory")
    for i in range(count):
        position, size = struct.unpack_from("<ii", data, offset + i * 16)
        require(position >= 0 and size >= 0 and position + size <= len(data), "Invalid lump bounds")
    result = identity(path)
    require(result["sha256"] == expected, "Shareware SHA-256 mismatch")
    return result


def git_read(*arguments):
    return subprocess.check_output(["/usr/bin/git", "--no-optional-locks", "-c",
                                    "core.fsmonitor=false", *arguments], cwd=ROOT,
                                   env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"}, timeout=5)


def source_evidence(evidence):
    sources = evidence / "sources"
    sources.mkdir()
    patch = sources / "local.patch"
    patch.write_bytes(git_read("diff", "HEAD", "--binary", "--no-ext-diff", "--no-textconv", "--",
                              "references/doom.wasm", "scripts/build_doom.py", "scripts/inspect_doom.mjs"))
    for name in ("build_doom.py", "inspect_doom.mjs"):
        shutil.copyfile(ROOT / "scripts" / name, sources / name)
    inputs = [VENDOR / "Makefile", VENDOR / "utils/generate_code_for_embedded_file.py",
              VENDOR / "src/reachability_graph_for_wasm-metadce.json"]
    inputs += sorted((VENDOR / "src/wat").glob("*.wat"))
    # Include newly added profile inputs even before they are tracked by Git.
    inputs += sorted((VENDOR / "src").glob("reachability-*.json"))
    inputs += sorted((VENDOR / "doomgeneric/include").glob("a1_*.h"))
    return {"head": git_read("rev-parse", "HEAD").decode().strip(),
            "status": git_read("status", "--porcelain=v1", "--untracked-files=all").decode(),
            "local_patch": identity(patch),
            "entrypoints": [identity(sources / n) for n in ("build_doom.py", "inspect_doom.mjs")],
            "configuration": [identity(p) for p in inputs]}


def sdk_identity(sdk):
    sysroot = sdk / "share/wasi-sysroot"
    inputs = [sysroot / p for p in ("include/wasm32-wasi/stdio.h", "lib/wasm32-wasi/libc.a",
                                   "lib/wasm32-wasi/libm.a", "lib/wasm32-wasi/crt1-reactor.o")]
    builtins = list(sdk.glob("lib/clang/*/lib/wasi/libclang_rt.builtins-wasm32.a"))
    require(len(builtins) == 1, "Expected one WASI compiler builtins library")
    for path in inputs + builtins:
        require(path.is_file(), f"Missing SDK input: {path}")
    return {"expected_package": "wasi-sdk-24.0", "inputs": [identity(p) for p in inputs + builtins]}


def controlled_environment(out, jobs):
    return {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LC_ALL": "C", "TZ": "UTC",
            "PYTHONHASHSEED": "0", "PYTHONDONTWRITEBYTECODE": "1",
            "TMPDIR": str(out / "tmp"), "BINARYEN_CORES": str(jobs)}


def execute_build(args):
    started = time.monotonic()
    deadline = started + args.timeout
    check_cancellation()
    require(sys.version_info[:3] == (3, 14, 4), "Use the tested Python 3.14.4")
    require(os.name == "posix" and hasattr(os, "killpg"), "Requires POSIX process groups")
    safe_path(ROOT)
    raw_out = Path(args.out).absolute()
    require(not any(p.is_symlink() for p in [raw_out, *raw_out.parents]), "Output ancestry has symlinks")
    out = safe_path(raw_out)
    require(out.is_relative_to(VENDOR / "build") and out != VENDOR / "build",
            "Output must be beneath ignored references/doom.wasm/build/")
    require(not out.exists(), "Output already exists; choose a new directory")
    controlled = args.profile == "controlled-title"
    require(not controlled or (not args.embed_wad and not args.embed_sha256),
            "controlled-title forbids embedded WAD arguments")
    require(controlled or (args.embed_wad and args.embed_sha256),
            "upstream-shareware requires --embed-wad and --embed-sha256")
    wad = None if controlled else safe_path(args.embed_wad)
    sdk, binaryen = safe_path(args.wasi_sdk), safe_path(args.binaryen_bin)
    python = safe_path(sys.executable)
    node = safe_path(args.node or shutil.which("node") or "missing-node")
    tools = {"clang": (sdk / "bin/clang", r"^clang version 18\.1\.2-wasi-sdk\b"),
             "wasm-ld": (sdk / "bin/wasm-ld", r"^LLD 18\.1\.2\b"),
             "make": (MAKE, r"^GNU Make 3\.81\b"), "node": (node, r"^v22\.20\.0\s*$")}
    tools.update({name: (binaryen / name, rf"^{name} version 119\b")
                  for name in ("wasm-as", "wasm-merge", "wasm-metadce")})
    admitted = {name: executable_identity(path) for name, (path, _) in tools.items()}
    admitted["python"] = {**executable_identity(python), "version": sys.version}
    asset = None if controlled else validate_wad(wad, args.embed_sha256.lower())
    sdk_info = sdk_identity(sdk)
    require(git_read("check-ignore", str(out / "probe")).strip(), "Output is not Git-ignored")
    if wad is not None:
        require(git_read("check-ignore", str(wad)).strip(), "Shareware asset must remain Git-ignored")
    require(shutil.disk_usage(VENDOR).free >= 512 * 1024**2, "Require at least 512 MiB free disk")
    out.mkdir(parents=True, exist_ok=False)
    evidence = out / "evidence"
    evidence.mkdir()
    (out / "tmp").mkdir()
    env = controlled_environment(out, args.jobs)
    manifest = {"profile": args.profile, "status": "RUNNING", "asset": asset, "sdk": sdk_info,
                "tools": admitted, "environment": env, "jobs": args.jobs, "deadline_seconds": args.timeout,
                "storage_policy": "512 MiB free-space admission; no quota or continuous monitoring",
                "started_utc": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    try:
        atomic_json(evidence / "manifest.json", manifest)
        manifest["sources"] = source_evidence(evidence)
        for name, (path, pattern) in tools.items():
            supervise([path, "--version"], ROOT, env, out, "version-" + name, deadline)
            version = (evidence / ("version-" + name + ".stdout.log")).read_text()
            require(re.search(pattern, version, re.M), f"Mismatched {name}: {version[:200]}")
            admitted[name]["version"] = version
        command = [str(tools["make"][0]), "-rR", "-j" + str(args.jobs), "VERBOSE=1",
                   "BUILD_PROFILE=" + args.profile, "LOCAL_ADMITTED=1", "OUTPUT_DIR=" + str(out),
                   "LOCAL_WASI_SDK=" + str(sdk),
                   "LOCAL_BINARYEN_BIN=" + str(binaryen), "LOCAL_PYTHON=" + str(python), "local-build"]
        if wad is not None:
            command.insert(7, "LOCAL_EMBED_WAD=" + str(wad))
        manifest["make"] = {"argv": command, "cwd": str(VENDOR)}
        supervise(command, VENDOR, env, out, "make", deadline)
        final = out / "doom.wasm"
        require(final.is_file() and not final.is_symlink() and final.stat().st_size > 0,
                "Missing/invalid final copied module")
        manifest["final"] = identity(final)
        command = [str(node), str(ROOT / "scripts/inspect_doom.mjs"), str(final)]
        if controlled:
            command += ["--profile", args.profile]
        manifest["inspection"] = {"argv": command, "cwd": str(ROOT)}
        supervise(command, ROOT, env, out, "inspection", deadline)
        interface = json.loads((evidence / "inspection.stdout.log").read_text())
        require(interface.get("validate") is True and interface.get("instantiated") is False and
                interface.get("exportsCalled") is False and interface.get("startSection") is False and
                interface.get("sha256") == manifest["final"]["sha256"] and
                interface.get("bytes") == manifest["final"]["bytes"], "Invalid static inspection receipt")
        manifest["interface"] = interface
        for tool in admitted.values():
            revalidate_executable(tool)
        manifest["executables_revalidated_at_closeout"] = True
        check_cancellation()
        require(time.monotonic() < deadline, "Run deadline reached during final verification")
        manifest.update(status="BUILD PASS", a1_acceptance="NOT ESTABLISHED")
    except BaseException as error:
        manifest.update(status="FAIL", error=f"{type(error).__name__}: {error}")
        raise
    finally:
        manifest["duration_seconds"] = time.monotonic() - started
        try:
            manifest["output_bytes_before_manifest_closeout"] = sum(
                p.stat().st_size for p in out.rglob("*") if p.is_file() and not p.is_symlink())
        except OSError as error:
            manifest["size_measurement_error"] = str(error)
        atomic_json(evidence / "manifest.json", manifest)
    print(f"BUILD PASS (not A1 acceptance): {final}\nEvidence: {evidence / 'manifest.json'}")


def main(argv=None):
    global _pending_signal
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True, choices=["upstream-shareware", "controlled-title"])
    parser.add_argument("--embed-wad")
    parser.add_argument("--embed-sha256")
    parser.add_argument("--out", required=True)
    parser.add_argument("--jobs", type=int, choices=[1, 2], default=2)
    parser.add_argument("--timeout", type=int, choices=range(1, 121), default=120, metavar="1..120")
    parser.add_argument("--wasi-sdk", default=str(ROOT / "tools/wasi-sdk-24.0"))
    parser.add_argument("--binaryen-bin", default=str(ROOT / "tools/binaryen-119/bin"))
    parser.add_argument("--node", help="Installed Node path; otherwise resolved from PATH once")
    args = parser.parse_args(argv)
    previous_handlers = {sig: signal.getsignal(sig) for sig in (signal.SIGTERM, signal.SIGINT)}
    previous_pending = _pending_signal
    _pending_signal = None
    def defer_cancellation(signum, frame):
        global _pending_signal
        if _pending_signal is None:
            _pending_signal = signum
    try:
        for sig in previous_handlers:
            signal.signal(sig, defer_cancellation)
        check_cancellation()
        execute_build(args)
        check_cancellation()
        return 0
    except BuildCancelled as error:
        print(f"{error}; available evidence retained", file=sys.stderr)
        return 128 + error.signum
    except KeyboardInterrupt:
        print("Interrupted; available evidence retained", file=sys.stderr)
        return 130
    except Exception as error:
        print(f"Build refused/failed: {error}", file=sys.stderr)
        return 1
    finally:
        for sig, previous in previous_handlers.items():
            signal.signal(sig, previous)
        _pending_signal = previous_pending


if __name__ == "__main__":
    sys.exit(main())
