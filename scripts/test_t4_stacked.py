from pathlib import Path
from itertools import combinations
from collections import Counter, defaultdict

import duckdb
import matplotlib.pyplot as plt


ROOT = Path(__file__).resolve().parents[1]

LOCATIONS_DB = ROOT / "database" / "ebird_locations.duckdb"
MAIN_DB = ROOT / "database" / "ebird.duckdb"

COUNTY_CODE = "US-MA-001"

LOCATION_IDS = [
    "L34242735",
    "L469234",
    "L1055176",
    "L207422",
]

LOCATIONS_PER_COMBINATION = 3

COLORS = [
    "#3D83B6",
    "#E29A43",
    "#438F70",
]


def load_data():
    # Read location information and species coverage.
    con = duckdb.connect(
        str(LOCATIONS_DB),
        read_only=True
    )

    try:
        location_rows = con.execute("""
            SELECT locality_id, locality_name
            FROM locations
            WHERE county_code = ?
              AND locality_id = ANY(?)
        """, [COUNTY_CODE, LOCATION_IDS]).fetchall()

        names = dict(location_rows)

        missing = set(LOCATION_IDS) - set(names)

        if missing:
            raise ValueError(
                f"Missing locations: {sorted(missing)}"
            )

        species_rows = con.execute("""
            SELECT DISTINCT locality_id, taxon_id
            FROM location_species
            WHERE county_code = ?
              AND locality_id = ANY(?)
        """, [COUNTY_CODE, LOCATION_IDS]).fetchall()

    finally:
        con.close()

    # Retrieve common names from the main database.
    taxon_ids = sorted({
        taxon_id
        for _, taxon_id in species_rows
    })

    con = duckdb.connect(
        str(MAIN_DB),
        read_only=True
    )

    try:
        taxa_rows = con.execute("""
            SELECT taxon_id, common_name
            FROM taxa
            WHERE taxon_id = ANY(?)
        """, [taxon_ids]).fetchall()

    finally:
        con.close()

    taxon_names = dict(taxa_rows)

    species_by_location = {
        locality_id: set()
        for locality_id in LOCATION_IDS
    }

    for locality_id, taxon_id in species_rows:
        species_by_location[locality_id].add(taxon_id)

    return names, species_by_location, taxon_names


def calculate_combinations(names, species_by_location):
    results = []

    for combo in combinations(
        LOCATION_IDS,
        LOCATIONS_PER_COMBINATION
    ):
        # Track exactly which hotspots recorded each species.
        species_locations = defaultdict(list)

        for locality_id in combo:
            for taxon_id in species_by_location[locality_id]:
                species_locations[taxon_id].append(locality_id)

        overlap_counts = Counter(
            len(locality_ids)
            for locality_ids in species_locations.values()
        )

        results.append({
            "locations": combo,
            "species_locations": species_locations,
            "overlap": overlap_counts,
            "total": len(species_locations),
        })

    results.sort(
        key=lambda result: result["total"],
        reverse=True
    )

    return results


def print_details(result, names, taxon_names):
    print("\n" + "=" * 75)
    print("DETAILED BREAKDOWN — HIGHEST-RICHNESS COMBINATION")
    print("=" * 75)

    print("\nSelected locations:")

    for locality_id in result["locations"]:
        print(f"  - {names[locality_id]}")

    print(f"\nTotal distinct species: {result['total']}")

    # Group species by the exact set of locations containing them.
    groups = defaultdict(list)

    for taxon_id, locality_ids in result["species_locations"].items():
        key = frozenset(locality_ids)
        groups[key].append(taxon_id)

    for level in range(1, LOCATIONS_PER_COMBINATION + 1):
        print("\n" + "-" * 75)
        print(f"EXACTLY {level} HOTSPOT(S)")
        print("-" * 75)

        for combo in combinations(result["locations"], level):
            key = frozenset(combo)
            species = groups.get(key, [])

            location_label = " + ".join(
                names[locality_id]
                for locality_id in combo
            )

            print(f"\n{location_label}")
            print(f"  Shared species count: {len(species)}")

    # Confirm the categories partition the distinct species.
    total = sum(len(species) for species in groups.values())

    assert total == result["total"]


def plot_combinations(results):
    labels = [
        f"Combination {i}"
        for i in range(1, len(results) + 1)
    ]

    fig, ax = plt.subplots(figsize=(12, 6))

    bottoms = [0] * len(results)

    for level in range(1, LOCATIONS_PER_COMBINATION + 1):
        values = [
            result["overlap"][level]
            for result in results
        ]

        bars = ax.bar(
            labels,
            values,
            bottom=bottoms,
            color=COLORS[level - 1],
            label=f"Exactly {level} hotspot(s)",
        )

        for bar, value in zip(bars, values):
            if value > 0:
                ax.text(
                    bar.get_x() + bar.get_width() / 2,
                    bar.get_y() + bar.get_height() / 2,
                    str(value),
                    ha="center",
                    va="center",
                    color="white",
                    fontweight="bold",
                )

        bottoms = [
            bottom + value
            for bottom, value in zip(bottoms, values)
        ]

    for index, result in enumerate(results):
        ax.text(
            index,
            result["total"] + 2,
            str(result["total"]),
            ha="center",
            fontweight="bold",
        )

    ax.set_title(
        "T4 — Species Richness and Overlap"
    )

    ax.set_ylabel("Distinct Species")
    ax.set_xlabel("Location Combination")

    ax.set_ylim(
        0,
        max(result["total"] for result in results) * 1.15
    )

    ax.legend()
    ax.grid(axis="y", alpha=0.2)
    ax.set_axisbelow(True)

    plt.tight_layout()
    plt.show()


def main():
    for db_path in [LOCATIONS_DB, MAIN_DB]:
        if not db_path.exists():
            raise FileNotFoundError(db_path)

    names, species_by_location, taxon_names = load_data()

    results = calculate_combinations(
        names,
        species_by_location
    )

    print("\nT4 — Multi-Location Species Coverage")
    print(f"County: {COUNTY_CODE}")
    print("=" * 65)

    for rank, result in enumerate(results, 1):
        print(f"\nCombination {rank}")

        for locality_id in result["locations"]:
            print(f"  {names[locality_id]}")

        for level in range(1, LOCATIONS_PER_COMBINATION + 1):
            print(
                f"  Exactly {level} hotspot(s): "
                f"{result['overlap'][level]}"
            )

        print(
            f"  Total distinct species: {result['total']}"
        )

    # Print species names and locations for the winning combination.
    if results:
        print_details(
            results[0],
            names,
            taxon_names
        )

        plot_combinations(results)


if __name__ == "__main__":
    main()