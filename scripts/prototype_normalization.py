"""Pure normalization used by the original SQLite prototype and MA exports."""
import math

CATALOG_BATCH_SIZE = 10_000


def integer_or_none(value):
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def float_or_none(value):
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


def sqlite_integer(value):
    result = integer_or_none(value)
    if result is not None and not -(2**63) <= result < 2**63:
        raise OverflowError("Integer cannot be stored in the prototype SQLite INTEGER column")
    return result


def sqlite_float(value):
    result = float_or_none(value)
    # sqlite3 binds Python NaN as SQL NULL; infinities remain REAL values.
    if result is not None and math.isnan(result):
        return None
    # SQLite REAL affinity stores negative zero as the integer zero optimization.
    return 0.0 if result == 0 else result
