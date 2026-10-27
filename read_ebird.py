import indexed_gzip
import csv
import io
import time
from collections import Counter

# ============================================================
# Configuration
# ============================================================

INPUT_FILE = "ebd_US_relSep-2026.txt.gz"
INDEX_FILE = "ebird.gzidx"
OUTPUT_FILE = "ebd_MA_2025.csv"

TARGET_YEAR = "2025"
ROWS_PER_COUNTY = 10000
PROGRESS_INTERVAL = 100000

# Estimated starting position in the uncompressed dataset.
# Set to 0.0 for a complete scan.
START_FRACTION = 0.7

COUNTIES = [
    "Barnstable",
    "Berkshire",
    "Bristol",
    "Dukes",
    "Essex",
    "Franklin",
    "Hampden",
    "Hampshire",
    "Middlesex",
    "Nantucket",
    "Norfolk",
    "Plymouth",
    "Suffolk",
    "Worcester",
]

COLUMNS = [
    "COMMON NAME",
    "SCIENTIFIC NAME",
    "OBSERVATION COUNT",
    "LATITUDE",
    "LONGITUDE",
    "OBSERVATION DATE",
    "LOCALITY",
    "LOCALITY ID",
    "SAMPLING EVENT IDENTIFIER",
    "PROTOCOL NAME",
    "ALL SPECIES REPORTED",
    "COUNTY",
    "COUNTY CODE",
]

# ============================================================
# Initialization
# ============================================================

start_time = time.time()

county_counts = Counter({county: 0 for county in COUNTIES})
county_set = set(COUNTIES)

processed = 0
saved = 0

print("Opening eBird dataset...", flush=True)

with indexed_gzip.IndexedGzipFile(INPUT_FILE) as f:

    print("Loading gzip index...", flush=True)
    f.import_index(INDEX_FILE)
    print("Index loaded!", flush=True)

    # Read original headers
    f.seek(0)
    header = (
        f.readline()
        .decode("utf-8-sig")
        .rstrip("\r\n")
        .split("\t")
    )

    # Validate columns
    required = set(COLUMNS) | {"STATE CODE"}

    missing = required - set(header)

    if missing:
        raise ValueError(f"Missing columns: {missing}")

    # Determine total uncompressed size
    total_size = f.seek(0, 2)

    print(
        f"Uncompressed size: "
        f"{total_size / 1024**3:,.2f} GiB",
        flush=True
    )

    # ========================================================
    # Seek to starting position
    # ========================================================

    start_position = int(total_size * START_FRACTION)

    print(
        f"Seeking to {START_FRACTION * 100:.0f}%...",
        flush=True
    )

    f.seek(start_position)

    if start_position > 0:
        # Skip the potentially incomplete first row
        f.readline()

    reader = csv.DictReader(
        io.TextIOWrapper(f, encoding="utf-8"),
        fieldnames=header,
        delimiter="\t"
    )

    print("Starting extraction...", flush=True)
    print("-" * 65, flush=True)

    scan_start = time.time()

    # ========================================================
    # Extract observations
    # ========================================================

    with open(
        OUTPUT_FILE,
        "w",
        newline="",
        encoding="utf-8"
    ) as out:

        writer = csv.DictWriter(
            out,
            fieldnames=COLUMNS
        )

        writer.writeheader()

        for row in reader:

            processed += 1

            date = row["OBSERVATION DATE"]
            county = row["COUNTY"]

            if (
                row["STATE CODE"] == "US-MA"
                and date.startswith(TARGET_YEAR + "-")
                and county in county_set
                and county_counts[county] < ROWS_PER_COUNTY
            ):

                writer.writerow({
                    col: row[col] for col in COLUMNS
                })

                county_counts[county] += 1
                saved += 1

                # Stop if every county has reached its limit
                if all(
                    count >= ROWS_PER_COUNTY
                    for count in county_counts.values()
                ):
                    print(
                        "\nAll 14 counties reached their limits!",
                        flush=True
                    )
                    break

            # =================================================
            # Progress reporting
            # =================================================

            if processed % PROGRESS_INTERVAL == 0:

                elapsed = time.time() - scan_start
                speed = processed / max(elapsed, 0.001)

                completed = sum(
                    count >= ROWS_PER_COUNTY
                    for count in county_counts.values()
                )

                print(
                    f"\nProcessed: {processed:,} | "
                    f"Saved: {saved:,} | "
                    f"Current year: {date[:4]} | "
                    f"Speed: {speed:,.0f} rows/s | "
                    f"Completed counties: {completed}/14",
                    flush=True
                )

                for county in COUNTIES:
                    count = county_counts[county]

                    print(
                        f"  {county:<12} "
                        f"{count:>6,} / {ROWS_PER_COUNTY:,}",
                        flush=True
                    )

                out.flush()

# ============================================================
# Final report
# ============================================================

elapsed = time.time() - start_time

print("\n" + "=" * 65)
print("EXTRACTION COMPLETED")
print("=" * 65)

for county in COUNTIES:
    count = county_counts[county]

    status = (
        "COMPLETE"
        if count >= ROWS_PER_COUNTY
        else "INCOMPLETE"
    )

    print(f"{county:<12} {count:>6,}  {status}")

print("-" * 65)
print(f"Total rows processed: {processed:,}")
print(f"Total rows saved:     {saved:,}")
print(f"Elapsed time:         {elapsed:.1f}s")
print(f"Output:               {OUTPUT_FILE}")
