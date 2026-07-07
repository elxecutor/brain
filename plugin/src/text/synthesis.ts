import { CONFIG } from "../config.js";

export interface SynthesizedFact {
  derivedFrom: string[];
  fact: string;
}

export interface SynthesisRule {
  name: string;
  match: (content: string) => boolean;
  extract: (content: string) => Record<string, string> | null;
  synthesize: (data: Record<string, string>, context: SynthesisContext) => string | null;
}

interface SynthesisContext {
  memories: Array<{ id: string; content: string }>;
  currentDate: Date;
}

function extractYears(content: string): number[] {
  const years: number[] = [];
  const currentYear = new Date().getFullYear();
  const yearRegex = /\b(19[0-9]{2}|20[0-9]{2})\b/g;
  let m;
  while ((m = yearRegex.exec(content)) !== null) {
    const y = Number(m[1]);
    if (y >= 1900 && y <= currentYear + 10) years.push(y);
  }
  return [...new Set(years)];
}

function extractNumbers(content: string): number[] {
  const nums: number[] = [];
  const numRegex = /\b(\d{1,4})\b/g;
  let m;
  while ((m = numRegex.exec(content)) !== null) {
    nums.push(Number(m[1]));
  }
  return nums;
}

function extractNamedEntities(content: string): string[] {
  const entities: string[] = [];
  const entityRegex = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
  let m;
  while ((m = entityRegex.exec(content)) !== null) {
    const word = m[1];
    if (!["The", "This", "That", "When", "Where", "What", "How", "Why", "I", "My", "Your", "His", "Her", "Its", "Our", "Their"].includes(word)) {
      entities.push(word);
    }
  }
  return [...new Set(entities)];
}

function findRelatedContent(content: string, allMemories: string[]): string[] {
  const related: string[] = [];
  const contentWords = new Set(content.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
  for (const mem of allMemories) {
    if (mem === content) continue;
    const memWords = new Set(mem.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
    let overlap = 0;
    for (const w of contentWords) {
      if (memWords.has(w)) overlap++;
    }
    if (overlap >= 2) related.push(mem);
  }
  return related;
}

const rules: SynthesisRule[] = [
  {
    name: "age",
    match: (c) => /\b(?:born|birth|age|aged|years?\s+old)\b/i.test(c),
    extract: (c) => {
      const bornYear = c.match(/\b(?:born|birth)\s+(?:in\s+)?(\d{4})\b/i);
      const age = c.match(/\b(?:age|aged?)\s+(\d{1,3})\b/i);
      const yearsOld = c.match(/\b(\d{1,3})\s+years?\s+old\b/i);
      const birthday = c.match(/\b(?:birthday|born\s+on)\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})/i);
      return {
        bornYear: bornYear?.[1] ?? "",
        age: age?.[1] ?? yearsOld?.[1] ?? "",
        birthdayMonth: birthday?.[1] ?? "",
        birthdayDay: birthday?.[2] ?? "",
      };
    },
    synthesize: (d, ctx) => {
      const currentYear = ctx.currentDate.getFullYear();
      if (d.bornYear) {
        return `Age: ~${currentYear - Number(d.bornYear)} years (born ${d.bornYear})`;
      }
      if (d.age) {
        return `Stated age: ${d.age} years`;
      }
      if (d.birthdayMonth && d.birthdayDay) {
        const monthNum = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"].indexOf(d.birthdayMonth.toLowerCase()) + 1;
        const thisBirthday = new Date(currentYear, monthNum - 1, Number(d.birthdayDay));
        const lastBirthday = new Date(currentYear - 1, monthNum - 1, Number(d.birthdayDay));
        const ref = ctx.currentDate > thisBirthday ? thisBirthday : lastBirthday;
        const age = Math.floor((ctx.currentDate.getTime() - ref.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
        return `Current age: ~${age} years (birthday: ${d.birthdayMonth} ${d.birthdayDay})`;
      }
      return null;
    },
  },
  {
    name: "timeElapsed",
    match: (c) => /\b(?:since|from|started|began|founded|created|established|joined|in)\s+\d{4}\b/i.test(c),
    extract: (c) => {
      const years = extractYears(c);
      return { years: years.join(",") };
    },
    synthesize: (d) => {
      const years = d.years.split(",").map(Number).filter(Boolean);
      if (years.length === 0) return null;
      const currentYear = new Date().getFullYear();
      const elapsed = years.map((y) => `${currentYear - y} years since ${y}`);
      return elapsed.join("; ");
    },
  },
  {
    name: "location",
    match: (c) => /\b(?:live[sd]?\s+in|based\s+in|located\s+in|from|moved\s+to|in\s+[A-Z])\b/i.test(c),
    extract: (c) => {
      const patterns = [
        /\b(?:live[sd]?\s+(?:in|at)|based\s+in|located\s+in|from|moved\s+to)\s+([A-Z][a-zA-Z\s,]+?)(?:\s*[.!?:;]|\s*$)/,
        /\b(?:in|at)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/,
      ];
      for (const p of patterns) {
        const m = c.match(p);
        if (m) return { location: m[1].trim() };
      }
      return null;
    },
    synthesize: (d, ctx) => {
      const loc = d.location;
      for (const mem of ctx.memories) {
        if (mem.content === d.location) continue;
        const geoMatch = mem.content.match(
          new RegExp(`\\b${loc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(?:is|,|in|located)\\s+(?:in|part of|near)\\s+([A-Z][a-z]+(?:\\s+[A-Z][a-z]+)*)`, "i"),
        );
        if (geoMatch) return `Location hierarchy: ${loc} → ${geoMatch[1]}`;
      }
      return `Location: ${loc}`;
    },
  },
  {
    name: "work",
    match: (c) => /\b(?:work[sd]?\s+(?:at|for|in)|employed\s+(?:at|by|in)|job\s+(?:at|with)|started?\s+(?:at|with|for)|company)\b/i.test(c),
    extract: (c) => {
      const entities = extractNamedEntities(c);
      const years = extractYears(c);
      const action = c.match(/\b(work|employ|start|join|founded|hire)\w*/i)?.[1] ?? "";
      return {
        entities: entities.join(","),
        years: years.join(","),
        action,
      };
    },
    synthesize: (d, ctx) => {
      const entities = d.entities.split(",").filter(Boolean);
      const years = d.years.split(",").map(Number).filter(Boolean);
      if (entities.length === 0) return null;

      const results: string[] = [];
      for (const entity of entities) {
        for (const mem of ctx.memories) {
          if (mem.content === d.entities) continue;
          const yearMatch = mem.content.match(
            new RegExp(`\\b(?:started|began|joined|founded|created)\\s+(?:at|with|for)?\\s*${entity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(?:in\\s+)?(\\d{4})`, "i"),
          );
          if (yearMatch) {
            const startYear = Number(yearMatch[1]);
            const duration = new Date().getFullYear() - startYear;
            results.push(`${entity}: ~${duration} years (since ${startYear})`);
          }
        }
        if (results.length === 0 && years.length > 0) {
          results.push(`${entity}: since ${years[0]}`);
        }
      }
      return results.length > 0 ? results.join("; ") : null;
    },
  },
  {
    name: "relationship",
    match: (c) => /\b(?:wife|husband|partner|brother|sister|mother|father|parent|child|son|daughter|friend|colleague|teammate)\b/i.test(c),
    extract: (c) => {
      const rel = c.match(/\b(my\s+)?(wife|husband|partner|brother|sister|mother|father|friend|colleague)\s+([A-Z][a-z]+)/i);
      if (rel) return { relationship: rel[2], name: rel[3] };
      return null;
    },
    synthesize: (d, ctx) => {
      const name = d.name;
      for (const mem of ctx.memories) {
        if (mem.content.includes(name)) {
          const factMatch = mem.content.match(
            new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(?:works?|lives?|is|has|studies?)\\s+(.+?)(?:\\s*[.!?:;]|\\s*$)`, "i"),
          );
          if (factMatch) return `${d.relationship} ${name}: ${factMatch[1].trim()}`;
        }
      }
      return `${d.relationship}: ${name}`;
    },
  },
  {
    name: "likes",
    match: (c) => /\b(?:like[sd]?|enjoy[sd]?|prefer[sd]?|love[sd]?|fan\s+of|hobby|hobbies|interest)\b/i.test(c),
    extract: (c) => {
      const match = c.match(/\b(?:like[sd]?|enjoy[sd]?|prefer[sd]?|love[sd]?|fan\s+of|hobby|hobbies|interest(?:s)?)\s+(?:is\s+)?(.+?)(?:\s*[.!?:;]|\s*$)/i);
      return { item: match?.[1]?.trim() ?? "" };
    },
    synthesize: (d, ctx) => {
      const items = d.item.split(/,|\s+and\s+/).map((s) => s.trim()).filter(Boolean);
      for (const item of items) {
        for (const mem of ctx.memories) {
          if (mem.content === d.item) continue;
          const categoryMatch = mem.content.match(
            new RegExp(`\\b${item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(?:is|,|a|an|the)\\s+(?:a|an|the)?\\s*([\\w\\s]+?)(?:\\s*[.!?:;]|\\s*$)`, "i"),
          );
          if (categoryMatch) return `Interest: ${item} (${categoryMatch[1].trim()})`;
        }
      }
      return items.length > 0 ? `Interest: ${items.join(", ")}` : null;
    },
  },
  {
    name: "membership",
    match: (c) => /\b(?:member\s+of|belongs?\s+to|part\s+of|joined|in\s+(?:the\s+)?[A-Z])\b/i.test(c),
    extract: (c) => {
      const match = c.match(/\b(?:member\s+of|belongs?\s+to|part\s+of|joined)\s+(?:the\s+)?([A-Z][A-Za-z\s&]+?)(?:\s*[.!?:;]|\s*$)/i);
      return { group: match?.[1]?.trim() ?? "" };
    },
    synthesize: (d) => {
      return d.group ? `Member of: ${d.group}` : null;
    },
  },
  {
    name: "goal",
    match: (c) => /\b(?:want\s+to|goal\s+(?:is|to)|planning\s+to|aspire|dream\s+(?:is|of|to)|objective)\b/i.test(c),
    extract: (c) => {
      const match = c.match(/\b(?:want\s+to|goal\s+(?:is|to)|planning\s+to|aspir(?:e|ing)\s+to|dream\s+(?:is|of|to)|objective\s+(?:is|to))\s+(.+?)(?:\s*[.!?:;]|\s*$)/i);
      return { goal: match?.[1]?.trim() ?? "" };
    },
    synthesize: (d) => {
      return d.goal ? `Goal: ${d.goal}` : null;
    },
  },
];

export async function synthesizeMemories(
  memories: Array<{ id: string; content: string; createdAt: number }>,
): Promise<SynthesizedFact[]> {
  const facts: SynthesizedFact[] = [];
  const seen = new Set<string>();
  const maxFacts = CONFIG.synthesis.maxSynthesizedFacts;
  const context: SynthesisContext = {
    memories: memories.map((m) => ({ id: m.id, content: m.content })),
    currentDate: new Date(),
  };

  for (const mem of memories) {
    if (facts.length >= maxFacts) break;

    for (const rule of rules) {
      if (facts.length >= maxFacts) break;
      if (!rule.match(mem.content)) continue;

      const data = rule.extract(mem.content);
      if (!data) continue;

      const key = `${mem.id}:${rule.name}:${JSON.stringify(data)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const result = rule.synthesize(data, context);
      if (result) {
        facts.push({
          derivedFrom: [mem.id],
          fact: result,
        });
      }
    }
  }

  return facts;
}
