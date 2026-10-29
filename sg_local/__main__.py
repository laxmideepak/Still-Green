"""Allow ``python -m sg_local`` to run the CLI."""

from .cli import main

raise SystemExit(main())
