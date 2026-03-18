"""
Google Trends ingestion — free/unofficial via pytrends.

Run once locally to seed the macro_search_trends table.
Writes directly to Supabase via REST API.

Setup:
    pip install pytrends requests python-dotenv

Usage:
    python scripts/ingest-trends.py
    python scripts/ingest-trends.py --geo US-DC        # single geo
    python scripts/ingest-trends.py --geo US-DC US-VA  # multiple geos

Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from
apps/web/.env.local (or env vars if already set).

Notes:
- Google rate-limits aggressively. If you get 429s, wait 15-30 min and retry.
- Results are identical to SerpAPI — same data, same table. Swap to SerpAPI
  later by setting SERPAPI_KEY in Vercel (no other changes needed).
"""

import os
import sys
import time
import argparse
import requests
from datetime import datetime

try:
    from pytrends.request import TrendReq
except ImportError:
    print("pytrends not installed. Run: pip install pytrends requests python-dotenv")
    sys.exit(1)

try:
    from dotenv import load_dotenv
    # Load from apps/web/.env.local if running from repo root
    env_path = os.path.join(os.path.dirname(__file__), "..", "apps", "web", ".env.local")
    if os.path.exists(env_path):
        load_dotenv(env_path)
        print(f"Loaded env from {env_path}")
except ImportError:
    pass  # python-dotenv optional

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
    print("  Either set them as env vars or ensure apps/web/.env.local exists")
    sys.exit(1)

WEDDING_TERMS = [
    "wedding venue",
    "wedding venues",
    "barn wedding venue",
    "outdoor wedding venue",
    "wedding photographer",
]

SUPABASE_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates",
}


def get_venue_geos():
    """Fetch all unique google_trends_metro values from venues table."""
    res = requests.get(
        f"{SUPABASE_URL}/rest/v1/venues",
        params={"select": "google_trends_metro", "google_trends_metro": "not.is.null"},
        headers=SUPABASE_HEADERS,
    )
    venues = res.json()
    geos = list(set(v["google_trends_metro"] for v in venues if v.get("google_trends_metro")))
    return geos


def upsert_rows(rows):
    """Upsert rows into macro_search_trends."""
    res = requests.post(
        f"{SUPABASE_URL}/rest/v1/macro_search_trends",
        json=rows,
        headers={**SUPABASE_HEADERS, "Prefer": "resolution=merge-duplicates,return=minimal"},
    )
    if res.status_code not in (200, 201):
        print(f"  DB error {res.status_code}: {res.text[:200]}")
        return False
    return True


def fetch_term(pytrends_client, term, geo, retries=3):
    """Fetch 5 years of weekly interest for a single term + geo."""
    for attempt in range(retries):
        try:
            pytrends_client.build_payload(
                [term],
                timeframe="today 5-y",
                geo=geo,
            )
            df = pytrends_client.interest_over_time()

            if df.empty:
                print(f"  No data for '{term}' ({geo})")
                return []

            rows = []
            for date_idx, row in df.iterrows():
                week_start = date_idx.strftime("%Y-%m-%d")
                interest = int(row[term])
                rows.append({
                    "geo": geo,
                    "week_start": week_start,
                    "term": term,
                    "relative_interest": interest,
                })

            return rows

        except Exception as e:
            err = str(e)
            if "429" in err or "Too Many Requests" in err:
                wait = 30 * (attempt + 1)
                print(f"  Rate limited. Waiting {wait}s before retry {attempt+1}/{retries}...")
                time.sleep(wait)
            else:
                print(f"  Error fetching '{term}' ({geo}): {e}")
                return []

    print(f"  Failed after {retries} retries for '{term}' ({geo})")
    return []


def ingest_geo(geo):
    print(f"\nFetching trends for geo: {geo}")

    # Use a longer backoff to avoid rate limits
    pytrends = TrendReq(
        hl="en-US",
        tz=300,           # US Eastern
        timeout=(10, 30),
        retries=2,
        backoff_factor=0.5,
    )

    total = 0
    for i, term in enumerate(WEDDING_TERMS):
        print(f"  [{i+1}/{len(WEDDING_TERMS)}] '{term}'...", end=" ", flush=True)

        rows = fetch_term(pytrends, term, geo)
        if rows:
            ok = upsert_rows(rows)
            if ok:
                print(f"{len(rows)} weeks written")
                total += len(rows)
            else:
                print("write failed")
        else:
            print("no data")

        # Polite delay between terms — Google gets annoyed if you hammer it
        if i < len(WEDDING_TERMS) - 1:
            time.sleep(5)

    print(f"  {geo} complete: {total} data points")
    return total


def main():
    parser = argparse.ArgumentParser(description="Ingest Google Trends into Supabase")
    parser.add_argument(
        "--geo", nargs="+",
        help="SerpAPI geo codes to fetch (e.g. US-DC US-VA). Defaults to all venue geos."
    )
    args = parser.parse_args()

    if args.geo:
        geos = args.geo
    else:
        print("Fetching venue geos from Supabase...")
        geos = get_venue_geos()
        if not geos:
            print("No venues with google_trends_metro set. Update in Settings first.")
            print("Note: should be a SerpAPI geo code like 'US-DC', not 'Washington DC'")
            sys.exit(1)

    print(f"Will fetch trends for: {', '.join(geos)}")
    print(f"Terms: {', '.join(WEDDING_TERMS)}")
    print(f"Timeframe: 5 years weekly (~260 data points per term)\n")

    grand_total = 0
    for i, geo in enumerate(geos):
        grand_total += ingest_geo(geo)
        # Extra delay between geos
        if i < len(geos) - 1:
            print("  Pausing 15s between geos...")
            time.sleep(15)

    print(f"\nDone. {grand_total} total data points written to macro_search_trends.")
    print("The funnel seasonality chart should now show search interest overlays.")


if __name__ == "__main__":
    main()
