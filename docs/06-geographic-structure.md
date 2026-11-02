# 06 — Geographic Structure

## Overview

Our eBird dashboard currently supports two geographic levels:

- **State:** Massachusetts, California, Texas, etc.
- **County:** Middlesex County, Suffolk County, etc.

A county belongs to a state, while a state belongs to the United States.

```text
United States
├── Massachusetts (US-MA)
│   ├── Middlesex County (US-MA-017)
│   └── Suffolk County (US-MA-025)
├── California (US-CA)
│   └── ...
└── ...
```

## Geographic Columns

Our DuckDB summary tables contain the following geographic columns:

| Column | Purpose | Example |
|---|---|---|
| `region_level` | Geographic level of the record | `state`, `county` |
| `region_code` | Identifies the state or county | `US-MA-017` |
| `state_code` | Identifies the associated state | `US-MA` |

For example:

| region_level | region_code | state_code |
|---|---|---|
| state | US-MA | US-MA |
| county | US-MA-017 | US-MA |
| county | US-MA-025 | US-MA |
| state | US-CA | US-CA |

**Important:** In our database, `region` means a geographic area. It does not mean Northeast, Midwest, South, or West.

## Geographic Query Parameters

Our backend uses three geographic parameters with different responsibilities.

| Parameter | Meaning |
|---|---|
| `region` | The specific state or county being analyzed |
| `level` | Whether we are working with states or counties |
| `stateFilter` | Restricts a comparison to locations within a particular state |

### Example 1 — Analyze Massachusetts

```javascript
getRegionSummary("US-MA", "state", 2012, 2025);
```

Returns the recorded species richness and observation records for Massachusetts.

### Example 2 — Analyze Middlesex County

```javascript
getRegionSummary("US-MA-017", "county", 2012, 2025);
```

Returns the recorded species richness and observation records for Middlesex County.

### Example 3 — Compare all states

```javascript
getRichnessRanking("state", null, 2012, 2025);
```

Ranks U.S. states by recorded species richness.

### Example 4 — Compare Massachusetts counties

```javascript
getRichnessRanking("county", "US-MA", 2012, 2025);
```

Ranks counties within Massachusetts by recorded species richness.

In these examples, `region` selects **one location**, while `stateFilter` limits **a group of locations** being compared.

## U.S. Census Regions

The United States can also be divided into four Census regions:

- Northeast
- Midwest
- South
- West

These geographic classifications are **not currently stored in our DuckDB database**.

We could add them later using a separate state-to-region lookup table without reprocessing the original observation files.

## Current Scope

Our current database supports:

- State-level analysis
- County-level analysis
- Nationwide state comparisons
- County comparisons within a state

Comparisons by Census region would require an additional geographic lookup.

**Terminology convention:** Use *state* and *county* when referring to the two supported geographic levels. Reserve *Census region* for Northeast, Midwest, South, and West.