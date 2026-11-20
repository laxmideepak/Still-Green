"""The logo switch is drawn by hand in three places: the website and dashboard
(components/brand.tsx), the daemon control page (sg_local/static/index.html)
and the extension popup (extension/popup.html), each with its own CSS. Keep
every copy on the approved artwork (logo-on.svg, logo-off-light.svg,
logo-off-dark.svg): the same shapes, the same colours, and the knob drawn at
its "off" spot so the "on" state slides it 28 viewBox units right."""

from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Copied from the approved SVGs. The knob and both faces at the "off" spot.
SHAPES = [
    'cx="18" cy="16" r="12.5"',
    # Laughing face: two happy arcs and an open grin.
    'd="M11.38 14.31A2.13 2.13 0 0 1 15.63 14.31"',
    'd="M20.38 14.31A2.13 2.13 0 0 1 24.63 14.31"',
    'd="M11.75 17H24.25A6.25 6.25 0 0 1 11.75 17Z"',
    # Sad face: two dot eyes and a frown.
    'cx="13.75" cy="14.13" r="1.38"',
    'cx="22.25" cy="14.13" r="1.38"',
    'd="M13.5 22.25A5.17 5.17 0 0 1 22.5 22.25"',
]
GRADIENT = ["#a3e635", "#10b981"]
OFF_LIGHT = ["#d4d4d8", "#a1a1aa"]
OFF_DARK = ["#3f3f46", "#71717a"]

MARKUP = {
    "components/brand.tsx": "components/brand.module.css",
    "sg_local/static/index.html": "sg_local/static/app.css",
    "extension/popup.html": "extension/popup.css",
}


def read(name: str) -> str:
    return (ROOT / name).read_text(encoding="utf-8")


class LogoMarkTests(unittest.TestCase):
    def test_shapes_match_the_artwork(self) -> None:
        for name in MARKUP:
            text = read(name)
            with self.subTest(file=name):
                self.assertIn('viewBox="0 0 64 32"', text)
                for shape in SHAPES:
                    self.assertIn(shape, text)
                for colour in GRADIENT:
                    self.assertIn(colour, text)

    def test_off_colours_match_the_artwork(self) -> None:
        for name in MARKUP.values():
            text = read(name).lower()
            with self.subTest(file=name):
                for colour in OFF_LIGHT + OFF_DARK:
                    self.assertIn(colour, text)
                # The light greys first, then the dark ones in both dark blocks
                # (system dark mode and the dark theme switch).
                self.assertEqual(text.count(OFF_DARK[0]), 2)
                self.assertEqual(text.count(OFF_DARK[1]), 2)

    def test_sad_eyes_are_not_stroked(self) -> None:
        # The off face sets a stroke for the frown; without this the dot eyes
        # inherit it and grow past r=1.38.
        rules = {
            "components/brand.module.css": r"\.faceOff circle\s*\{\s*stroke:\s*none;",
            "sg_local/static/app.css": r"\.logo-face-off circle\s*\{\s*stroke:\s*none;",
            "extension/popup.css": r"\.logo-face-off circle\s*\{\s*stroke:\s*none;",
        }
        for name, rule in rules.items():
            with self.subTest(file=name):
                self.assertRegex(read(name), rule)

    def test_on_slides_the_knob_right(self) -> None:
        for name in MARKUP.values():
            with self.subTest(file=name):
                self.assertIn("translateX(28px)", read(name))
                self.assertNotIn("translateX(-28px)", read(name))


if __name__ == "__main__":
    unittest.main()
