from pathlib import Path
from itertools import combinations
from collections import defaultdict

import duckdb
import matplotlib.pyplot as plt
from matplotlib.patches import Patch


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "database" / "ebird_locations.duckdb"

COUNTY_CODE = "US-MA-001"

LOCATION_IDS = [
    "L34242735",  # Andrews Property and Coombs Bog
    "L469234",    # A. Janet DeFulvio Wildlife Sanctuary
    "L1055176",   # Areys Pond
    "L207422",    # Ashumet Holly Wildlife Sanctuary
]

LOCATIONS_PER_COMBINATION = 3

# Each location keeps the same color across combinations.
LOCATION_COLORS = {
    "L34242735": "#3D83B6",
    "L469234": "#E29A43",
    "L1055176": "#438F70",
    "L207422": "#B07AA1",
}

SHORT_NAMES = {
    "L34242735": "Andrews Property",
    "L469234": "Janet DeFulvio",
    "L1055176": "Areys Pond",
    "L207422": "Ashumet Holly",
}

SHARED_COLOR = "#777777"


def load_data():
    con = duckdb.connect(
        str(DB_PATH),
        read_only=True
    )

    try:
        locations = con.execute("""
            SELECT locality_id, locality_name
            FROM locations
            WHERE county_code = ?
              AND locality_id = ANY(?)
        """, [COUNTY_CODE, LOCATION_IDS]).fetchall()

        names = dict(locations)

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

    species_by_location = {
        locality_id: set()
        for locality_id in LOCATION_IDS
    }

    for locality_id, taxon_id in species_rows:
        species_by_location[locality_id].add(taxon_id)

    return names, species_by_location


def calculate_combinations(species_by_location):
    results = []

    for combo in combinations(
        LOCATION_IDS,
        LOCATIONS_PER_COMBINATION
    ):
        # Map each species to the selected locations containing it.
        species_locations = defaultdict(set)

        for locality_id in combo:
            for taxon_id in species_by_location[locality_id]:
                species_locations[taxon_id].add(locality_id)

        # Species appearing at two or more selected locations.
        shared_count = sum(
            len(locality_ids) >= 2
            for locality_ids in species_locations.values()
        )

        # Species appearing exclusively at one selected location.
        unique_counts = {
            locality_id: sum(
                locality_ids == {locality_id}
                for locality_ids in species_locations.values()
            )
            for locality_id in combo
        }

        total = len(species_locations)

        # Every species must be counted exactly once.
        assert (
            shared_count + sum(unique_counts.values())
            == total
        )

        results.append({
            "locations": combo,
            "shared": shared_count,
            "unique": unique_counts,
            "total": total,
        })

    results.sort(
        key=lambda result: result["total"],
        reverse=True
    )

    return results


def print_results(results, names):
    print("\nT4 — Multi-Location Species Coverage")
    print(f"County: {COUNTY_CODE}")
    print("=" * 70)

    for rank, result in enumerate(results, 1):
        print(f"\nCOMBINATION {rank}")
        print("-" * 70)

        for locality_id in result["locations"]:
            print(f"  {names[locality_id]}")

        print("\nSpecies exclusive to each location:")

        for locality_id in result["locations"]:
            print(
                f"  {names[locality_id]}: "
                f"{result['unique'][locality_id]:,}"
            )

        print(
            f"\nSpecies shared by 2+ locations: "
            f"{result['shared']:,}"
        )

        print(
            f"Total distinct species: "
            f"{result['total']:,}"
        )


def plot_results(results, names):
    fig, ax = plt.subplots(figsize=(13, 7))

    x_positions = list(range(len(results)))
    bottoms = [0] * len(results)

    # Bottom segment: species shared by multiple locations.
    shared_values = [
        result["shared"]
        for result in results
    ]

    ax.bar(
        x_positions,
        shared_values,
        color=SHARED_COLOR,
        label="Shared by 2+ locations",
    )

    for i, value in enumerate(shared_values):
        if value > 0:
            ax.text(
                i,
                value / 2,
                str(value),
                ha="center",
                va="center",
                color="white",
                fontweight="bold",
            )

    bottoms = shared_values.copy()

    # Stack exclusive-species counts for each location.
    # Location colors remain consistent across all bars.
    for locality_id in LOCATION_IDS:
        values = [
            result["unique"].get(locality_id, 0)
            for result in results
        ]

        bars = ax.bar(
            x_positions,
            values,
            bottom=bottoms,
            color=LOCATION_COLORS[locality_id],
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

    # Display total species richness above each bar.
    for i, result in enumerate(results):
        ax.text(
            i,
            result["total"] + 3,
            str(result["total"]),
            ha="center",
            fontweight="bold",
            fontsize=11,
        )

    labels = [
        f"Combination {i}"
        for i in range(1, len(results) + 1)
    ]

    ax.set_xticks(x_positions)
    ax.set_xticklabels(labels)

    ax.set_ylabel("Distinct Species")
    ax.set_xlabel("Hotspot Combination")

    ax.set_title(
        "T4 — Distinct Species Richness by Location Contribution"
    )

    legend_items = [
        Patch(
            facecolor=SHARED_COLOR,
            label="Shared by 2+ locations"
        )
    ]

    for locality_id in LOCATION_IDS:
        legend_items.append(
            Patch(
                facecolor=LOCATION_COLORS[locality_id],
                label=SHORT_NAMES[locality_id]
            )
        )

    ax.legend(
        handles=legend_items,
        loc="upper center",
        bbox_to_anchor=(0.5, -0.12),
        ncol=5,
        frameon=False,
        fontsize=9,
    )

    # Leave space for the horizontal legend.
    plt.tight_layout(rect=(0, 0.08, 1, 1))

    # Display the chart.
    plt.show()


def main():
    if not DB_PATH.exists():
        raise FileNotFoundError(DB_PATH)

    names, species_by_location = load_data()

    results = calculate_combinations(
        species_by_location
    )

    print_results(results, names)
    plot_results(results, names)


if __name__ == "__main__":
    main()
