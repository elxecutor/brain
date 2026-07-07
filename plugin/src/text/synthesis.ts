import { CONFIG } from "../config.js";

export interface SynthesizedFact {
  derivedFrom: string[];
  fact: string;
}

interface Memory {
  id: string;
  content: string;
  createdAt: number;
}

function tokenize(content: string): string[] {
  return content
    .replace(/[^\w\s]/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function extractAll(content: string): {
  tokens: string[];
  years: string[];
  numbers: string[];
  named: string[];
  phrases: string[];
} {
  const tokens = tokenize(content);
  const years = (content.match(/\b(19[0-9]{2}|20[0-9]{2})\b/g) || []);
  const numbers = (content.match(/\b\d+(?:\.\d+)?\b/g) || []);
  const named = (content.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || []);
  const phrases = (content.match(/\b\w+(?:\s+\w+){1,4}\b/g) || []);
  return { tokens, years, numbers, named, phrases };
}

function findSharedConcepts(memories: Memory[]): Map<string, string[]> {
  const conceptMap = new Map<string, string[]>();
  for (const mem of memories) {
    const { tokens } = extractAll(mem.content);
    const unique = [...new Set(tokens)];
    for (const token of unique) {
      if (!conceptMap.has(token)) conceptMap.set(token, []);
      conceptMap.get(token)!.push(mem.id);
    }
  }
  return conceptMap;
}

function findSharedPhrases(memories: Memory[]): Map<string, string[]> {
  const phraseMap = new Map<string, string[]>();
  for (const mem of memories) {
    const { phrases } = extractAll(mem.content);
    const unique = [...new Set(phrases.map((p) => p.toLowerCase()))];
    for (const phrase of unique) {
      if (!phraseMap.has(phrase)) phraseMap.set(phrase, []);
      phraseMap.get(phrase)!.push(mem.id);
    }
  }
  return phraseMap;
}

export async function synthesizeMemories(
  memories: Array<{ id: string; content: string; createdAt: number }>,
): Promise<SynthesizedFact[]> {
  const maxFacts = CONFIG.synthesis.maxSynthesizedFacts;
  const facts: SynthesizedFact[] = [];
  const seen = new Set<string>();
  const currentYear = new Date().getFullYear();

  for (const mem of memories) {
    const { years, numbers, named } = extractAll(mem.content);

    for (const year of years) {
      const y = Number(year);
      if (y >= 1900 && y <= currentYear + 10) {
        const elapsed = currentYear - y;
        if (elapsed > 0 && elapsed < 100) {
          const key = `${mem.id}:year:${year}`;
          if (!seen.has(key)) {
            seen.add(key);
            facts.push({ derivedFrom: [mem.id], fact: `${elapsed} years since ${year}` });
          }
        }
      }
    }

    for (const num of numbers) {
      const key = `${mem.id}:num:${num}`;
      if (!seen.has(key)) {
        seen.add(key);
        facts.push({ derivedFrom: [mem.id], fact: `Number: ${num}` });
      }
    }

    for (const name of named) {
      const key = `${mem.id}:named:${name}`;
      if (!seen.has(key)) {
        seen.add(key);
        facts.push({ derivedFrom: [mem.id], fact: `Entity: ${name}` });
      }
    }
  }

  const conceptMap = findSharedConcepts(memories);
  for (const [concept, sourceIds] of conceptMap) {
    if (sourceIds.length >= 2) {
      const key = `concept:${concept}`;
      if (!seen.has(key)) {
        seen.add(key);
        facts.push({
          derivedFrom: [...new Set(sourceIds)],
          fact: `Shared: "${concept}" (${sourceIds.length} memories)`,
        });
      }
    }
  }

  const phraseMap = findSharedPhrases(memories);
  for (const [phrase, sourceIds] of phraseMap) {
    if (sourceIds.length >= 2 && phrase.split(" ").length >= 2) {
      const key = `phrase:${phrase}`;
      if (!seen.has(key)) {
        seen.add(key);
        facts.push({
          derivedFrom: [...new Set(sourceIds)],
          fact: `Repeated: "${phrase}" (${sourceIds.length} memories)`,
        });
      }
    }
  }

  return facts.slice(0, maxFacts);
}
