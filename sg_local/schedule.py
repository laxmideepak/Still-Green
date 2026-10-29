"""Schedule parsing and evaluation.

A schedule is either "always" or a weekly window:

    {"mode": "scheduled",
     "active_days": ["monday", ..., "friday"],
     "start_time": "09:00",
     "end_time": "17:00",
     "timezone": "local"}

Overnight windows (for example 22:00-06:00) belong to the day they start.
Timezone "local" uses the machine's current timezone; any IANA name
(``America/New_York``) is also accepted.
"""

from __future__ import annotations

import re
from datetime import datetime, time, timedelta, timezone
from typing import Any, Iterable
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .config import DAY_NAMES, ConfigError

DAY_ALIASES = {
    "mon": "monday",
    "monday": "monday",
    "tue": "tuesday",
    "tues": "tuesday",
    "tuesday": "tuesday",
    "wed": "wednesday",
    "wednesday": "wednesday",
    "thu": "thursday",
    "thur": "thursday",
    "thurs": "thursday",
    "thursday": "thursday",
    "fri": "friday",
    "friday": "friday",
    "sat": "saturday",
    "saturday": "saturday",
    "sun": "sunday",
    "sunday": "sunday",
}

_DAY_INDEX = {name: index for index, name in enumerate(DAY_NAMES)}
_TIME_RE = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")


def parse_time(value: str) -> time:
    """Parse HH:MM (24-hour) into a time."""
    match = _TIME_RE.fullmatch((value or "").strip())
    if not match:
        raise ConfigError(f"Invalid time {value!r}; use 24-hour HH:MM, e.g. 09:00")
    return time(hour=int(match.group(1)), minute=int(match.group(2)))


def format_time(value: str) -> str:
    parsed = parse_time(value)
    return f"{parsed.hour:02d}:{parsed.minute:02d}"


def parse_days(value: str | Iterable[str]) -> list[str]:
    """Parse day names into a canonical Monday-first list.

    Accepts comma-separated names, ranges (``mon-fri``), ``weekdays``,
    ``weekends``, ``everyday``/``daily``/``all``, and abbreviations.
    """
    if isinstance(value, str):
        text = value.strip().lower()
        if text in {"everyday", "every", "daily", "all", "7d"}:
            return list(DAY_NAMES)
        if text in {"weekdays", "weekday", "workdays"}:
            return list(DAY_NAMES[:5])
        if text in {"weekends", "weekend"}:
            return list(DAY_NAMES[5:])
        parts = [part.strip() for part in text.split(",") if part.strip()]
    else:
        parts = [str(part).strip().lower() for part in value if str(part).strip()]

    if not parts:
        raise ConfigError("At least one active day is required")

    selected: set[str] = set()
    for part in parts:
        if "-" in part:
            start_raw, end_raw = (piece.strip() for piece in part.split("-", 1))
            start = DAY_ALIASES.get(start_raw)
            end = DAY_ALIASES.get(end_raw)
            if not start or not end:
                raise ConfigError(f"Invalid day range {part!r}")
            start_index = _DAY_INDEX[start]
            end_index = _DAY_INDEX[end]
            if start_index <= end_index:
                selected.update(DAY_NAMES[start_index : end_index + 1])
            else:  # wrap, e.g. fri-mon
                selected.update(DAY_NAMES[start_index:])
                selected.update(DAY_NAMES[: end_index + 1])
            continue

        day = DAY_ALIASES.get(part)
        if not day:
            raise ConfigError(f"Unknown day {part!r}")
        selected.add(day)

    return [day for day in DAY_NAMES if day in selected]


def resolve_timezone(value: str | None) -> Any:
    """Resolve a schedule timezone name.

    ``local``/``system``/empty use the machine's current timezone. ``UTC`` and
    IANA names use zoneinfo.
    """
    text = (value or "local").strip()
    lowered = text.lower()
    if lowered in {"local", "system", "machine", ""}:
        return datetime.now().astimezone().tzinfo or timezone.utc
    if lowered in {"utc", "z"}:
        return timezone.utc
    try:
        return ZoneInfo(text)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        raise ConfigError(
            f"Unknown timezone {text!r}; use an IANA name such as "
            "'America/New_York' or 'local'"
        ) from None


def validate_schedule(schedule: dict[str, Any]) -> tuple[bool, str]:
    mode = schedule.get("mode", "always")
    if mode not in {"always", "scheduled"}:
        return False, "schedule mode must be 'always' or 'scheduled'"

    try:
        resolve_timezone(schedule.get("timezone", "local"))
    except ConfigError as exc:
        return False, str(exc)

    if mode == "always":
        return True, ""

    try:
        parse_days(schedule.get("active_days", []))
        start = parse_time(schedule.get("start_time", "00:00"))
        end = parse_time(schedule.get("end_time", "23:59"))
    except ConfigError as exc:
        return False, str(exc)

    if start == end:
        # A zero-length window is almost always a mistake. Treating it as a
        # full day would silently keep presence on around the clock.
        return False, "start and end time must differ"
    return True, ""


def is_within_schedule(
    schedule: dict[str, Any] | None, now: datetime | None = None
) -> bool:
    """Return True when ``now`` falls inside the schedule."""
    if not schedule:
        return True
    if schedule.get("mode", "always") == "always":
        return True

    try:
        tz = resolve_timezone(schedule.get("timezone", "local"))
    except ConfigError:
        return True
    if now is None:
        current = datetime.now(tz)
    elif now.tzinfo is None:
        current = now.replace(tzinfo=tz)
    else:
        current = now.astimezone(tz)

    try:
        active_days = parse_days(schedule.get("active_days", []))
        start = parse_time(schedule.get("start_time", "00:00"))
        end = parse_time(schedule.get("end_time", "23:59"))
    except ConfigError:
        # A broken schedule should not silently switch presence off.
        return True

    index = current.weekday()
    current_day = DAY_NAMES[index]
    start_minutes = start.hour * 60 + start.minute
    end_minutes = end.hour * 60 + end.minute
    current_minutes = current.hour * 60 + current.minute

    if start == end:
        return current_day in active_days

    if start_minutes < end_minutes:
        return current_day in active_days and start_minutes <= current_minutes < end_minutes

    # Overnight window: it starts on the previous day if we are before end.
    if current_minutes < end_minutes:
        owner_day = DAY_NAMES[(index - 1) % 7]
        return owner_day in active_days
    return current_day in active_days and current_minutes >= start_minutes


def next_boundary(schedule: dict[str, Any] | None, now: datetime | None = None) -> datetime | None:
    """Return the next schedule transition (best effort), or None for always."""
    if not schedule or schedule.get("mode", "always") == "always":
        return None
    try:
        tz = resolve_timezone(schedule.get("timezone", "local"))
    except ConfigError:
        return None
    current = now.astimezone(tz) if now else datetime.now(tz)

    # Minute resolution is enough; scan two weeks so all weekly windows are
    # covered. This is only used for human-readable status output.
    cursor = current.replace(second=0, microsecond=0)
    was_active = is_within_schedule(schedule, cursor)
    for _ in range(14 * 24 * 60):
        cursor += timedelta(minutes=1)
        if is_within_schedule(schedule, cursor) != was_active:
            return cursor
    return None


def schedule_summary(schedule: dict[str, Any]) -> str:
    if schedule.get("mode", "always") == "always":
        return "always on"
    days = schedule.get("active_days") or list(DAY_NAMES)
    try:
        pretty_days = ", ".join(day[:3].title() for day in parse_days(days))
        start = format_time(schedule.get("start_time", "00:00"))
        end = format_time(schedule.get("end_time", "23:59"))
        tz = schedule.get("timezone", "local")
    except ConfigError:
        return "invalid schedule"
    return f"{pretty_days} {start}-{end} ({tz})"


def make_schedule(
    days: str | Iterable[str] | None,
    start_time: str | None,
    end_time: str | None,
    timezone_value: str | None,
) -> dict[str, Any]:
    """Build and validate a scheduled config from CLI arguments."""
    schedule: dict[str, Any] = {
        "mode": "scheduled",
        "active_days": parse_days(days if days is not None else "weekdays"),
        "start_time": format_time(start_time or "09:00"),
        "end_time": format_time(end_time or "17:00"),
        "timezone": timezone_value or "local",
    }
    ok, message = validate_schedule(schedule)
    if not ok:
        raise ConfigError(message)
    return schedule
