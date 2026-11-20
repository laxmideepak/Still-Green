"""The ./sg-local launcher: picks a Python, explains problems in plain words.

Each test copies the launcher, requirements.lock and sg_local/ to a temporary
folder and runs it with a PATH that holds only the tools it needs, so the
computer's own Python is not found by accident. The full first-time install
needs the network; the macOS CI job tests that from a clean checkout.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ("dirname", "readlink", "uname", "cmp", "mkdir", "rm", "rmdir", "chmod", "cp", "sleep", "cat")


# Fake Pythons ignore the launcher's isolation flags (-I, -s, -E).
SKIP_FLAGS = 'while [ "$1" = "-I" ] || [ "$1" = "-s" ] || [ "$1" = "-E" ]; do shift; done\n'


def python_without_websockets() -> str | None:
    """A Python 3.9+ on this computer that does not have websockets."""
    for name in ("python3", "python3.13", "python3.12", "python3.11", "python3.10", "python3.9"):
        for folder in ("/usr/bin", "/usr/local/bin", "/opt/homebrew/bin"):
            path = Path(folder) / name
            if not path.exists():
                continue
            probe = subprocess.run(
                [str(path), "-I", "-c", "import sys, importlib.util; "
                 "sys.exit(0 if sys.version_info >= (3, 9) and importlib.util.find_spec('websockets') is None else 1)"],
                capture_output=True,
            )
            if probe.returncode == 0:
                return str(path)
    return None


def has_packages(python: str) -> bool:
    code = "import websockets, sys\nif sys.version_info >= (3, 10): import truststore"
    return subprocess.run([python, "-c", code], capture_output=True).returncode == 0


@unittest.skipIf(sys.platform == "win32", "the launcher is a POSIX shell script")
class LauncherTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="sg-launcher-")
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.repo = root / "repo"
        self.repo.mkdir()
        shutil.copy2(ROOT / "sg-local", self.repo / "sg-local")
        shutil.copy2(ROOT / "requirements.lock", self.repo / "requirements.lock")
        shutil.copytree(ROOT / "sg_local", self.repo / "sg_local", ignore=shutil.ignore_patterns("__pycache__"))
        self.bin = root / "bin"
        self.bin.mkdir()
        for tool in TOOLS:
            found = shutil.which(tool)
            if found:
                (self.bin / tool).symlink_to(found)
        self.env = {
            "PATH": str(self.bin),
            "HOME": str(root),
            "SG_LOCAL_CONFIG_DIR": str(root / "config"),
            "SG_LOCAL_STATE_DIR": str(root / "state"),
        }

    def run_launcher(self, *args: str, **env: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["/bin/sh", str(self.repo / "sg-local"), *args],
            env={**self.env, **env},
            capture_output=True,
            text=True,
            timeout=60,
        )

    def fake_python(self, name: str, script: str) -> Path:
        path = self.bin / name
        path.write_text("#!/bin/sh\n" + script, encoding="utf-8")
        path.chmod(0o755)
        return path

    def test_explicit_python_runs_quietly(self) -> None:
        result = self.run_launcher("--version", SG_LOCAL_PYTHON=sys.executable)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(result.stdout.startswith("sg-local "))
        self.assertEqual(result.stderr, "")
        self.assertFalse((self.repo / ".venv").exists())

    def test_python_with_packages_is_used_without_setup(self) -> None:
        if not has_packages(sys.executable):
            self.skipTest("this Python lacks websockets/truststore")
        self.fake_python("python3", f'exec "{sys.executable}" "$@"\n')
        result = self.run_launcher("--version")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        self.assertFalse((self.repo / ".venv").exists())

    def test_ready_private_environment_is_used_quietly(self) -> None:
        # A .venv this launcher made and finished: its python is used at once.
        venv_bin = self.repo / ".venv" / "bin"
        venv_bin.mkdir(parents=True)
        # A wrapper, not a symlink: a symlinked venv python would lose its venv.
        wrapper = venv_bin / "python"
        wrapper.write_text(f'#!/bin/sh\nexec "{sys.executable}" "$@"\n', encoding="utf-8")
        wrapper.chmod(0o755)
        (self.repo / ".venv" / ".stillgreen").write_text("", encoding="utf-8")
        shutil.copy2(self.repo / "requirements.lock", self.repo / ".venv" / "stillgreen-requirements.lock")
        result = self.run_launcher("--version")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")

    def test_no_python(self) -> None:
        result = self.run_launcher("--version")
        self.assertEqual(result.returncode, 1)
        self.assertIn("Python is not installed", result.stderr)
        self.assertIn("https://www.python.org/downloads/", result.stderr)

    def test_python_too_old(self) -> None:
        self.fake_python("python3", 'echo "3.8.10"\n')
        result = self.run_launcher("--version")
        self.assertEqual(result.returncode, 1)
        self.assertIn("Python is too old", result.stderr)
        self.assertIn("3.8.10", result.stderr)
        self.assertIn("Python 3.9 or newer", result.stderr)
        self.assertIn("https://www.python.org/downloads/", result.stderr)

    def test_missing_venv_module_is_explained(self) -> None:
        # A Python 3.12 without packages whose venv module is broken, as on
        # Debian without python3-venv. Error explanations still run for real.
        self.fake_python(
            "python3",
            f"""{SKIP_FLAGS}case "$1 $2" in
    "-m venv") echo "The virtual environment was not created successfully because ensurepip is not available."; exit 1 ;;
    "-m sg_local.errors") exec "{sys.executable}" "$@" ;;
esac
if [ "$1" = "-c" ]; then echo "3.12.1"; exit 0; fi
exit 1
""",
        )
        result = self.run_launcher("--version")
        self.assertEqual(result.returncode, 1)
        self.assertIn("first-time setup", result.stderr)
        self.assertIn("python3-venv", result.stderr)
        self.assertIn(".venv-setup.log", result.stderr)
        self.assertFalse((self.repo / ".venv").exists())
        self.assertFalse((self.repo / ".venv.lock").exists())

    def test_foreign_venv_is_never_deleted(self) -> None:
        foreign = self.repo / ".venv"
        (foreign / "bin").mkdir(parents=True)
        (foreign / "keep.txt").write_text("mine", encoding="utf-8")
        self.fake_python("python3", SKIP_FLAGS + 'if [ "$1" = "-c" ]; then echo "3.12.1"; exit 0; fi\nexit 1\n')
        result = self.run_launcher("--version")
        self.assertEqual(result.returncode, 1)
        self.assertIn("Stillgreen did not make it", result.stderr)
        self.assertTrue((foreign / "keep.txt").exists())

    def plant_module(self) -> tuple[Path, Path]:
        """A folder holding a websockets.py that leaves a mark when imported."""
        cwd = Path(self.temp.name) / "somewhere"
        cwd.mkdir()
        mark = Path(self.temp.name) / "PLANTED"
        (cwd / "websockets.py").write_text(
            f"open({str(mark)!r}, 'w').write('x')\n__version__ = '99'\n", encoding="utf-8"
        )
        return cwd, mark

    def test_modules_in_the_current_folder_are_not_imported(self) -> None:
        cwd, mark = self.plant_module()
        for env in ({"SG_LOCAL_PYTHON": sys.executable}, {}):
            with self.subTest(env=env):
                if not env:
                    # The python3 found on PATH: has_packages() must not be fooled.
                    self.fake_python("python3", f'exec "{sys.executable}" "$@"\n')
                result = subprocess.run(
                    ["/bin/sh", str(self.repo / "sg-local"), "--version"],
                    cwd=cwd, env={**self.env, **env}, capture_output=True, text=True, timeout=120,
                )
                self.assertFalse(mark.exists(), result.stderr)
                if not env and not has_packages(sys.executable):
                    continue  # it went on to a first-time setup; the mark is what matters
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertTrue(result.stdout.startswith("sg-local "))

    def test_relative_paths_still_use_the_current_folder(self) -> None:
        cwd, mark = self.plant_module()
        result = subprocess.run(
            ["/bin/sh", str(self.repo / "sg-local"), "doctor", "--offline", "--report", "report.txt"],
            cwd=cwd, env={**self.env, "SG_LOCAL_PYTHON": sys.executable},
            capture_output=True, text=True, timeout=120,
        )
        self.assertTrue((cwd / "report.txt").exists(), result.stdout + result.stderr)
        self.assertFalse(mark.exists())

    def test_missing_package_is_explained_without_a_traceback(self) -> None:
        python = python_without_websockets()
        if not python:
            self.skipTest("no Python without websockets on this computer")
        for command in ("status", "doctor"):
            with self.subTest(command=command):
                result = self.run_launcher(command, SG_LOCAL_PYTHON=python)
                self.assertEqual(result.returncode, 1)
                self.assertNotIn("Traceback", result.stderr)
                self.assertIn("A part Stillgreen needs is missing", result.stderr)
                self.assertIn("websockets", result.stderr)
                self.assertIn("SG_LOCAL_PYTHON is set", result.stderr)

    def test_launcher_is_posix_sh(self) -> None:
        text = (ROOT / "sg-local").read_text(encoding="utf-8")
        self.assertTrue(text.startswith("#!/bin/sh\n"))
        self.assertNotIn("[[", text)
        self.assertIsNone(re.search(r"^\s*(function|local)\s", text, re.M))
        dash = shutil.which("dash")
        for shell in filter(None, ["/bin/sh", dash]):
            with self.subTest(shell=shell):
                check = subprocess.run([shell, "-n", str(ROOT / "sg-local")], capture_output=True, text=True)
                self.assertEqual(check.returncode, 0, check.stderr)

    def test_requirements_lock_pins_with_hashes(self) -> None:
        lines = [
            line
            for line in (ROOT / "requirements.lock").read_text(encoding="utf-8").splitlines()
            if line and not line.startswith("#") and not line.lstrip().startswith("--hash")
        ]
        names = {line.split("==")[0] for line in lines}
        self.assertEqual(names, {"websockets", "truststore"})
        for line in lines:
            self.assertIn("==", line)
            self.assertTrue(line.endswith("\\"), line)  # followed by --hash lines


class PackagingTests(unittest.TestCase):
    def test_pyproject_supports_python_39_and_truststore(self) -> None:
        text = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
        self.assertIn('requires-python = ">=3.9"', text)
        self.assertIn("truststore", text)

    def test_venv_is_gitignored(self) -> None:
        text = (ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
        self.assertIn(".venv/", text)

    def test_no_runtime_code_needs_newer_python(self) -> None:
        # Python 3.9 cannot run these; keep them out of sg_local/.
        for path in (ROOT / "sg_local").glob("*.py"):
            source = path.read_text(encoding="utf-8")
            with self.subTest(file=path.name):
                self.assertNotIn("import tomllib", source)
                self.assertNotIn("datetime.UTC", source)
                self.assertNotIn("TaskGroup", source)
                self.assertNotIn("ExceptionGroup", source)
                self.assertNotIn("asyncio.timeout(", source)
                self.assertNotIn("except TimeoutError:", source)
        if sys.version_info >= (3, 9):
            for path in (ROOT / "sg_local").glob("*.py"):
                compile(path.read_text(encoding="utf-8"), str(path), "exec", dont_inherit=True)


if __name__ == "__main__":
    unittest.main()
