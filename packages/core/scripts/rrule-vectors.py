#!/usr/bin/env python3
"""
The rrule check's test vectors from an INDEPENDENT reference implementation.

The reference is python-dateutil's rrule with zoneinfo (IANA zones): it steps
by wall-clock time in the DTSTART zone, reads a nonexistent local time with
the offset from before the gap, and an ambiguous one as the first occurrence
(PEP 495, fold=0) — the same as RFC 5545 3.3.5 asks for. A vector is
dateutil's output in UTC; our implementation is compared against it
(test/rrule/vectors.test.ts).

A development tool, not a runtime dependency: the vectors are in the repo,
and the test runs in Node, without Python. To regenerate:

    pip install python-dateutil       # Python 3.9 or later, for zoneinfo
    python3 packages/core/scripts/rrule-vectors.py            # writes
    python3 packages/core/scripts/rrule-vectors.py --check    # does it match

dateutil differs from the RFC or from our decisions in three places; those
cases are NOT included in the vectors, and the number of skips is in the file:

  - unsynchronized DTSTART (the rule would not produce DTSTART): per the RFC
    DTSTART is always the first occurrence, dateutil skips it;
  - sub-daily frequency where two wall-clock values fall on one instant (on
    the far side of the gap): per the RFC that is one occurrence, dateutil
    gives two;
  - negative BYWEEKNO, and ordinal BYDAY alongside BYWEEKNO, are not
    generated (dateutil only numbers the weeks that overlap the neighbouring
    year with positive numbers — per its own TODO).
"""

import json
import random
import sys
from datetime import datetime, timedelta, timezone
from itertools import islice
from pathlib import Path

import dateutil
from dateutil.rrule import rrulestr
from zoneinfo import ZoneInfo

CORE = Path(__file__).resolve().parent.parent
OUT = CORE / "test" / "rrule" / "vectors.json"
SEED = 5545
CASES = 900
MAX_OCCURRENCES = 24
ZONES = [
    "UTC",
    "America/New_York",
    "Europe/Budapest",
    "Europe/London",
    "Australia/Lord_Howe",
    "America/Santiago",
    "Asia/Kolkata",
    "Pacific/Chatham",
    "America/St_Johns",
]
FREQS = ["YEARLY", "MONTHLY", "WEEKLY", "DAILY", "HOURLY", "MINUTELY"]
DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]


def stamp(dt):
    return dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def sample(rng, values, k_max):
    k = rng.randint(1, k_max)
    return sorted(rng.sample(values, min(k, len(values))))


def make_rule(rng, freq):
    parts = [f"FREQ={freq}"]
    sub_daily = freq in ("HOURLY", "MINUTELY")
    interval = rng.choice([1, 1, 1, 2, 3]) if not sub_daily else rng.choice([1, 2, 3, 5, 7, 11])
    if interval != 1:
        parts.append(f"INTERVAL={interval}")
    end = rng.random()
    if end < 0.35:
        parts.append(f"COUNT={rng.randint(1, MAX_OCCURRENCES)}")
    if rng.random() < 0.3:
        parts.append("BYMONTH=" + ",".join(map(str, sample(rng, list(range(1, 13)), 4))))
    weekno = False
    if freq == "YEARLY" and rng.random() < 0.15:
        parts.append("BYWEEKNO=" + ",".join(map(str, sample(rng, list(range(1, 54)), 3))))
        weekno = True
    if freq == "YEARLY" and rng.random() < 0.15:
        parts.append("BYYEARDAY=" + ",".join(map(str, sample(rng, [n for n in range(-366, 367) if n != 0], 3))))
    if freq in ("YEARLY", "MONTHLY") and rng.random() < 0.3:
        parts.append("BYMONTHDAY=" + ",".join(map(str, sample(rng, [n for n in range(-31, 32) if n != 0], 3))))
    if rng.random() < 0.45:
        days = sample(rng, DAYS, 3)
        ordinal = freq in ("YEARLY", "MONTHLY") and not weekno and rng.random() < 0.4
        if ordinal:
            days = [f"{rng.choice([1, 2, 3, -1, -2])}{d}" for d in days]
        parts.append("BYDAY=" + ",".join(days))
    if freq in ("YEARLY", "MONTHLY", "WEEKLY", "DAILY") and rng.random() < 0.35:
        parts.append("BYHOUR=" + ",".join(map(str, sample(rng, list(range(0, 24)), 3))))
    if freq in ("YEARLY", "MONTHLY", "WEEKLY", "DAILY", "HOURLY") and rng.random() < 0.25:
        parts.append("BYMINUTE=" + ",".join(map(str, sample(rng, [0, 15, 30, 45, 5, 50], 2))))
    if freq == "MINUTELY" and rng.random() < 0.3:
        parts.append("BYHOUR=" + ",".join(map(str, sample(rng, list(range(0, 24)), 4))))
    if freq in ("MONTHLY", "YEARLY", "WEEKLY") and rng.random() < 0.2:
        parts.append("BYSETPOS=" + ",".join(map(str, sample(rng, [1, 2, 3, -1, -2], 2))))
    if freq == "WEEKLY" and rng.random() < 0.3:
        parts.append(f"WKST={rng.choice(DAYS)}")
    return parts


def make_case(rng):
    zone = rng.choice(ZONES)
    tz = ZoneInfo(zone)
    freq = rng.choice(FREQS)
    year = rng.randint(2019, 2027)
    # A start near the clock changes, more often than not.
    month = rng.choice([3, 3, 4, 4, 9, 10, 10, 11, 11, 1, 6, 12])
    day = rng.randint(1, 28)
    hour = rng.choice([0, 1, 1, 2, 2, 3, 9, 12, 23])
    minute = rng.choice([0, 0, 30, 15, 45])
    dtstart = datetime(year, month, day, hour, minute, tzinfo=tz)
    parts = make_rule(rng, freq)
    if not any(p.startswith("COUNT=") for p in parts) and rng.random() < 0.3:
        span = {"YEARLY": 900, "MONTHLY": 200, "WEEKLY": 60, "DAILY": 20, "HOURLY": 2, "MINUTELY": 0.2}[freq]
        until = (dtstart + timedelta(days=rng.uniform(span / 4, span))).astimezone(timezone.utc)
        parts.append("UNTIL=" + until.strftime("%Y%m%dT%H%M%SZ"))
    rule = ";".join(parts)
    return zone, dtstart, rule


def occurrences_of(dtstart, rule):
    r = rrulestr(rule, dtstart=dtstart)
    bounded = "COUNT=" in rule or "UNTIL=" in rule
    return list(islice(iter(r), 200 if bounded else MAX_OCCURRENCES)), bounded


def generate():
    rng = random.Random(SEED)
    cases = []
    skipped = {"unsynchronized-dtstart": 0, "duplicate-instant": 0, "empty": 0, "too-many": 0}
    crossing = 0
    attempts = 0
    while len(cases) < CASES:
        attempts += 1
        zone, dtstart, rule = make_case(rng)
        found, bounded = occurrences_of(dtstart, rule)
        if not found:
            skipped["empty"] += 1
            continue
        if found[0] != dtstart or stamp(found[0]) != stamp(dtstart):
            skipped["unsynchronized-dtstart"] += 1
            continue
        stamps = [stamp(each) for each in found]
        if len(set(stamps)) != len(stamps):
            skipped["duplicate-instant"] += 1
            continue
        if bounded and len(found) >= 200:
            skipped["too-many"] += 1
            continue
        offsets = {each.utcoffset() for each in found}
        if len(offsets) > 1:
            crossing += 1
        cases.append(
            {
                "tzid": zone,
                "dtstart": dtstart.strftime("%Y%m%dT%H%M%S"),
                "rrule": rule,
                "bounded": bounded,
                "expected": stamps,
            }
        )
    return {
        # The $comment is written into the committed vectors.json, and --check
        # compares it byte for byte: change it only together with the file.
        "$comment": "The rrule check's vectors: the output of python-dateutil's rrule with zoneinfo, in UTC. Generated by packages/core/scripts/rrule-vectors.py. Do not edit by hand.",
        "generator": "python-dateutil",
        "dateutil": dateutil.__version__,
        "python": sys.version.split()[0],
        "seed": SEED,
        "attempts": attempts,
        "skipped": skipped,
        "crossingClockChange": crossing,
        "cases": cases,
    }


def main():
    data = generate()
    text = json.dumps(data, indent=0, ensure_ascii=False) + "\n"
    if "--check" in sys.argv:
        if not OUT.exists() or OUT.read_text(encoding="utf-8") != text:
            print("rrule-vectors: the vector file is stale or missing — run it again without --check", file=sys.stderr)
            sys.exit(1)
        print(f"rrule-vectors: {len(data['cases'])} cases, matches")
        return
    OUT.write_text(text, encoding="utf-8")
    print(f"rrule-vectors: {len(data['cases'])} cases ({data['crossingClockChange']} crossing a clock change), skipped {data['skipped']}")


if __name__ == "__main__":
    main()
