"""Unit tests for schedule parsing and evaluation."""

from __future__ import annotations

import unittest
from datetime import datetime, timezone

from sg_local import schedule
from sg_local.config import ConfigError


class ParseDaysTests(unittest.TestCase):
    def test_weekdays(self) -> None:
        self.assertEqual(
            schedule.parse_days("weekdays"),
            ["monday", "tuesday", "wednesday", "thursday", "friday"],
        )

    def test_weekends(self) -> None:
        self.assertEqual(schedule.parse_days("weekend"), ["saturday", "sunday"])

    def test_abbreviations_and_order(self) -> None:
        self.assertEqual(
            schedule.parse_days("fri,mon,wed"),
            ["monday", "wednesday", "friday"],
        )

    def test_range(self) -> None:
        self.assertEqual(
            schedule.parse_days("mon-fri"),
            ["monday", "tuesday", "wednesday", "thursday", "friday"],
        )

    def test_wrapping_range(self) -> None:
        self.assertEqual(
            schedule.parse_days("fri-mon"),
            ["monday", "friday", "saturday", "sunday"],
        )

    def test_daily(self) -> None:
        self.assertEqual(len(schedule.parse_days("daily")), 7)

    def test_zero_length_window_is_invalid(self) -> None:
        candidate = {
            "mode": "scheduled",
            "active_days": ["monday"],
            "start_time": "09:00",
            "end_time": "09:00",
            "timezone": "UTC",
        }
        ok, message = schedule.validate_schedule(candidate)
        self.assertFalse(ok)
        self.assertIn("differ", message)

    def test_bad_day(self) -> None:
        with self.assertRaises(ConfigError):
            schedule.parse_days("funday")


class ScheduleEvaluationTests(unittest.TestCase):
    def weekday_schedule(self) -> dict:
        return {
            "mode": "scheduled",
            "active_days": ["monday", "tuesday", "wednesday", "thursday", "friday"],
            "start_time": "09:00",
            "end_time": "17:00",
            "timezone": "UTC",
        }

    def test_always(self) -> None:
        self.assertTrue(schedule.is_within_schedule({"mode": "always"}))
        self.assertTrue(schedule.is_within_schedule(None))

    def test_boundaries(self) -> None:
        sched = self.weekday_schedule()
        monday = datetime(2026, 10, 26, tzinfo=timezone.utc)
        self.assertFalse(schedule.is_within_schedule(sched, monday.replace(hour=8, minute=59)))
        self.assertTrue(schedule.is_within_schedule(sched, monday.replace(hour=9, minute=0)))
        self.assertTrue(schedule.is_within_schedule(sched, monday.replace(hour=16, minute=59)))
        self.assertFalse(schedule.is_within_schedule(sched, monday.replace(hour=17, minute=0)))

    def test_weekend(self) -> None:
        sched = self.weekday_schedule()
        saturday = datetime(2026, 10, 31, 12, 0, tzinfo=timezone.utc)
        self.assertFalse(schedule.is_within_schedule(sched, saturday))

    def test_overnight_belongs_to_start_day(self) -> None:
        sched = {
            "mode": "scheduled",
            "active_days": ["monday"],
            "start_time": "22:00",
            "end_time": "06:00",
            "timezone": "UTC",
        }
        monday_late = datetime(2026, 10, 26, 23, 0, tzinfo=timezone.utc)
        tuesday_early = datetime(2026, 10, 27, 2, 0, tzinfo=timezone.utc)
        tuesday_after = datetime(2026, 10, 27, 6, 0, tzinfo=timezone.utc)
        tuesday_late = datetime(2026, 10, 27, 23, 0, tzinfo=timezone.utc)
        self.assertTrue(schedule.is_within_schedule(sched, monday_late))
        self.assertTrue(schedule.is_within_schedule(sched, tuesday_early))
        self.assertFalse(schedule.is_within_schedule(sched, tuesday_after))
        self.assertFalse(schedule.is_within_schedule(sched, tuesday_late))

    def test_timezone_conversion(self) -> None:
        sched = self.weekday_schedule()
        sched["timezone"] = "America/New_York"
        # Monday 2026-10-26 is still EDT (UTC-4).
        monday_1300_utc = datetime(2026, 10, 26, 13, 0, tzinfo=timezone.utc)
        monday_2100_utc = datetime(2026, 10, 26, 21, 0, tzinfo=timezone.utc)
        self.assertTrue(schedule.is_within_schedule(sched, monday_1300_utc))
        self.assertFalse(schedule.is_within_schedule(sched, monday_2100_utc))

    def test_naive_datetime_uses_schedule_timezone(self) -> None:
        sched = self.weekday_schedule()
        sched["timezone"] = "America/New_York"
        naive = datetime(2026, 10, 26, 10, 0)
        self.assertTrue(schedule.is_within_schedule(sched, naive))

    def test_invalid_time_keeps_presence_on(self) -> None:
        sched = self.weekday_schedule()
        sched["start_time"] = "bogus"
        self.assertTrue(schedule.is_within_schedule(sched, datetime.now(timezone.utc)))

    def test_next_boundary(self) -> None:
        sched = self.weekday_schedule()
        before = datetime(2026, 10, 26, 8, 0, tzinfo=timezone.utc)
        boundary = schedule.next_boundary(sched, before)
        self.assertIsNotNone(boundary)
        assert boundary is not None
        self.assertEqual(boundary, datetime(2026, 10, 26, 9, 0, tzinfo=timezone.utc))
        during = datetime(2026, 10, 26, 12, 0, tzinfo=timezone.utc)
        boundary = schedule.next_boundary(sched, during)
        self.assertEqual(boundary, datetime(2026, 10, 26, 17, 0, tzinfo=timezone.utc))

    def test_summary(self) -> None:
        self.assertEqual(schedule.schedule_summary({"mode": "always"}), "always on")
        summary = schedule.schedule_summary(self.weekday_schedule())
        self.assertIn("Mon, Tue, Wed, Thu, Fri", summary)
        self.assertIn("09:00-17:00", summary)


class MakeScheduleTests(unittest.TestCase):
    def test_defaults(self) -> None:
        sched = schedule.make_schedule(None, None, None, "UTC")
        self.assertEqual(sched["mode"], "scheduled")
        self.assertEqual(sched["start_time"], "09:00")
        self.assertEqual(sched["end_time"], "17:00")
        self.assertEqual(sched["active_days"][:5], schedule.parse_days("weekdays"))

    def test_bad_timezone(self) -> None:
        with self.assertRaises(ConfigError):
            schedule.make_schedule("weekdays", "09:00", "17:00", "Not/AZone")

    def test_bad_time(self) -> None:
        with self.assertRaises(ConfigError):
            schedule.make_schedule("weekdays", "9am", "17:00", "UTC")


if __name__ == "__main__":
    unittest.main()
