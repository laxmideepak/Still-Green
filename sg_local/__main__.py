"""Allow ``python -m sg_local`` to run the CLI.

Before the CLI is imported, check that this Python can run Stillgreen at all,
so a missing package or an old Python gives plain words (and a next step)
instead of a traceback. Keep this file free of newer syntax: it must at least
start on old Pythons to say that they are too old.
"""

import sys


def _missing_part():
    """The error-catalogue code for a missing requirement, or None."""
    if sys.version_info < (3, 9):
        return "python_too_old", "This is Python %d.%d." % sys.version_info[:2]
    import importlib.util

    if importlib.util.find_spec("websockets") is None:
        return "missing_dependency", "The missing package is: websockets."
    return None


def _explain(code, detail):
    try:
        from . import errors

        text = errors.format_text(errors.entry(code))
    except Exception:  # an old Python cannot import errors.py
        text = (
            "Problem: Python is too old\n"
            "Stillgreen needs Python 3.9 or newer.\n"
            "What to do: Install a newer Python from https://www.python.org/downloads/ "
            "and run ./sg-local again."
        )
    lines = [text, detail]
    if code == "missing_dependency":
        lines.append("Python used: " + sys.executable)
        import os

        if os.environ.get("SG_LOCAL_PYTHON"):
            lines.append(
                "SG_LOCAL_PYTHON is set, so ./sg-local uses that Python as it is and installs "
                "nothing. Remove SG_LOCAL_PYTHON, or install the packages into that Python with: "
                "python3 -m pip install --require-hashes -r requirements.lock"
            )
    sys.stderr.write("\n".join(lines) + "\n")


_problem = _missing_part()
if _problem:
    _explain(*_problem)
    raise SystemExit(1)

from .cli import main  # noqa: E402

raise SystemExit(main())
