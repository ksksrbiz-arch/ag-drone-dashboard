# Parcel → Lead Import

Expands the leads database into the counties surrounding the Marion hazelnut belt
by pulling **real, qualified agricultural parcels** from a commercial parcel API —
owner, mailing/situs address, acreage, crop, and the **true parcel polygon**.

## Why a commercial API

Oregon counties don't publish owner names online (ORS privacy), and the free
USDA CDL crop service is on a blocked port. So qualified leads (a name to call +
confirmation it's farmland) require a licensed parcel provider. This integration
uses **[ReportAll USA](https://reportallusa.com)** (`REPORTALL_CLIENT_KEY`);
**[Regrid](https://regrid.com)** (`REGRID_API_TOKEN`) is scaffolded as an
alternative once its token has Oregon coverage.

## How it qualifies parcels

For each hazelnut-belt ZIP in a county (`COUNTY_ZIPS`), it queries
`land_use_class=Agricultural` and keeps parcels that are:

- **privately owned** (drops government / school / HOA / developer owners),
- **5–600 acres** (configurable),
- **actually cultivated** — `crop_cover` must show real cropland (orchards, grass
  seed, hops, berries, vegetables…), not just forest/pasture.

`crop_cover`'s "Other Tree Crops" signal flags orchards (the EFB-relevant ones).
One lead per `(owner, county)` to match the DB unique constraint; the true
boundary is written to `fields` so it renders on the maps.

## Quota awareness

Parcel APIs bill **per record returned**. The importer caps fetches per ZIP
(`perZipFetchCap`) and stops at a target per county (`perCountyTarget`), so a run
stays within budget. Valley "Agricultural" land skews to grass-seed/pasture, so
expect a modest orchard hit-rate per credit.

## Usage

```
# dry run (no writes, no quota spent beyond the fetch)
POST /api/leads/import-parcels?counties=Clackamas,Yamhill,Polk&target=50&dryRun=true

# real import
POST /api/leads/import-parcels?counties=Clackamas,Yamhill,Polk&target=50
```

Returns `{ fetched, qualified, inserted, fields, byCounty, sample }`.

## Code

- `src/lib/leads/parcel-import.ts` — provider client, qualification, WKT→GeoJSON, writes.
- `src/app/api/leads/import-parcels/route.ts` — the endpoint.
- Env: `REPORTALL_CLIENT_KEY` (or `REGRID_API_TOKEN`).
