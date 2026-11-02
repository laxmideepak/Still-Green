"""The design tokens and the plain-CSS component layer exist in more than one
place (website, daemon control page, extension). Keep the copies identical."""

from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MARKERS = re.compile(r"/\* @tokens:start.*?/\* @tokens:end \*/", re.S)


def token_block(path: Path) -> str:
    match = MARKERS.search(path.read_text(encoding="utf-8"))
    if not match:
        raise AssertionError(f"{path} has no @tokens:start/@tokens:end block")
    return match.group(0)


class DesignTokenTests(unittest.TestCase):
    def test_token_copies_match(self) -> None:
        daemon = token_block(ROOT / "sg_local/static/tokens.css")
        self.assertEqual(daemon, token_block(ROOT / "extension/tokens.css"))
        self.assertEqual(daemon, token_block(ROOT / "app/globals.css"))

    def test_ui_layer_copies_match(self) -> None:
        self.assertEqual(
            (ROOT / "sg_local/static/ui.css").read_text(encoding="utf-8"),
            (ROOT / "extension/ui.css").read_text(encoding="utf-8"),
        )

    def test_both_themes_define_the_same_colors(self) -> None:
        block = token_block(ROOT / "sg_local/static/tokens.css")
        light = block.split("@media (prefers-color-scheme: dark)")[0]
        light_colors = set(re.findall(r"(--[a-z0-9-]+):", light.split("Light theme")[1]))
        media = block.split("@media (prefers-color-scheme: dark)")[1].split(':root[data-theme="dark"]')[0]
        forced = block.split(':root[data-theme="dark"]')[1].split("@media (min-width")[0]
        self.assertEqual(light_colors, set(re.findall(r"(--[a-z0-9-]+):", media)))
        self.assertEqual(light_colors, set(re.findall(r"(--[a-z0-9-]+):", forced)))


if __name__ == "__main__":
    unittest.main()
