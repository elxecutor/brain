import { CONFIG } from "../config.js";

export interface SynthesizedFact {
  derivedFrom: string;
  fact: string;
}

const YEAR_PATTERN = /\b(?:born\s+)?(?:in\s+)?(19[0-9]{2}|20[0-9]{2})\b/;
const ISO_DATE_PATTERN = /\b(19[0-9]{2}|20[0-9]{2})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])\b/;
const AGE_PATTERN = /\b(?:age|aged?)\s+(\d+)\b/i;

function extractYears(content: string): Array<{ year: number; context: string }> {
  const results: Array<{ year: number; context: string }> = [];
  const isoMatch = content.match(ISO_DATE_PATTERN);
  if (isoMatch) {
    results.push({ year: Number(isoMatch[1]), context: isoMatch[0] });
  }
  const yearMatch = content.match(YEAR_PATTERN);
  if (yearMatch && !isoMatch) {
    results.push({ year: Number(yearMatch[1]), context: yearMatch[0] });
  }
  return results;
}

export async function synthesizeMemories(
  memories: Array<{ id: string; content: string; createdAt: number }>,
): Promise<SynthesizedFact[]> {
  const facts: SynthesizedFact[] = [];
  const seen = new Set<string>();
  const currentYear = new Date().getFullYear();
  const maxFacts = CONFIG.synthesis.maxSynthesizedFacts;

  for (const mem of memories) {
    if (facts.length >= maxFacts) break;

    const years = extractYears(mem.content);
    for (const { year, context } of years) {
      if (facts.length >= maxFacts) break;
      if (year < 1900 || year > currentYear + 10) continue;

      const ageKey = `${mem.id}:age:${year}`;
      if (seen.has(ageKey)) continue;
      seen.add(ageKey);

      if (mem.content.toLowerCase().includes("born")) {
        const age = currentYear - year;
        facts.push({
          derivedFrom: mem.id,
          fact: `Implied age: ${age} years (born ${year})`,
        });
      } else {
        const elapsed = currentYear - year;
        facts.push({
          derivedFrom: mem.id,
          fact: `${elapsed} years have elapsed since ${year}`,
        });
      }
    }

    const ageMatch = mem.content.match(AGE_PATTERN);
    if (ageMatch && facts.length < maxFacts) {
      const ageKey = `${mem.id}:ageexplicit:${ageMatch[1]}`;
      if (!seen.has(ageKey)) {
        seen.add(ageKey);
        facts.push({
          derivedFrom: mem.id,
          fact: `Stated age: ${ageMatch[1]} years`,
        });
      }
    }
  }

  return facts;
}
