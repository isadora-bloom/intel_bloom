/**
 * Census Bureau ACS Demographic Ingestion
 * Free API key at: https://api.census.gov/data/key_signup.html
 *
 * Run: ts-node packages/ingestion/census/ingest-demographics.ts
 */

import { createClient } from "@supabase/supabase-js";

const CENSUS_BASE = "https://api.census.gov/data";
const CENSUS_KEY = process.env.CENSUS_API_KEY || "";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ACS 5-year variables:
// B01003_001E = total population
// B19013_001E = median household income
// B01002_001E = median age
async function ingestStateCounties(stateCode: string, year: number) {
  const url =
    `${CENSUS_BASE}/${year}/acs/acs5` +
    `?get=B01003_001E,B19013_001E,B01002_001E` +
    `&for=county:*&in=state:${stateCode}` +
    (CENSUS_KEY ? `&key=${CENSUS_KEY}` : "");

  const response = await fetch(url);
  if (!response.ok) {
    console.warn(`Census error for state ${stateCode} ${year}: ${response.status}`);
    return;
  }

  const data = await response.json();
  if (!Array.isArray(data) || data.length < 2) return;

  const [header, ...rows] = data;
  const popIdx = header.indexOf("B01003_001E");
  const incomeIdx = header.indexOf("B19013_001E");
  const ageIdx = header.indexOf("B01002_001E");
  const stateIdx = header.indexOf("state");
  const countyIdx = header.indexOf("county");

  const inserts = rows
    .map((row: string[]) => {
      const fipsCode = row[stateIdx] + row[countyIdx];
      const population = parseInt(row[popIdx]);
      const medianIncome = parseInt(row[incomeIdx]);
      const medianAge = parseFloat(row[ageIdx]);

      if (isNaN(population)) return null;

      return {
        fips_code: fipsCode,
        year,
        population: isNaN(population) ? null : population,
        median_income: isNaN(medianIncome) ? null : medianIncome,
        median_age: isNaN(medianAge) ? null : medianAge,
      };
    })
    .filter(Boolean);

  if (inserts.length > 0) {
    const { error } = await supabase
      .from("macro_demographic")
      .upsert(inserts as any[], { onConflict: "fips_code,year" });

    if (error) console.error(`DB error for state ${stateCode} ${year}:`, error.message);
  }
}

// US state FIPS codes (2-digit)
const STATE_FIPS = [
  "01","02","04","05","06","08","09","10","11","12","13","15","16","17","18",
  "19","20","21","22","23","24","25","26","27","28","29","30","31","32","33",
  "34","35","36","37","38","39","40","41","42","44","45","46","47","48","49",
  "50","51","53","54","55","56",
];

async function main() {
  const years = [2019, 2020, 2021, 2022, 2023];

  for (const year of years) {
    console.log(`\nIngesting demographics for ${year}...`);

    for (const stateFips of STATE_FIPS) {
      process.stdout.write(`  State ${stateFips}... `);
      await ingestStateCounties(stateFips, year);
      process.stdout.write("done\n");
      await sleep(300);
    }
  }

  console.log("\nCensus ingestion complete.");
}

main().catch(console.error);
