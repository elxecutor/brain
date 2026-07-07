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

interface KnowledgeGraph {
  namedEntities: Map<string, string[]>;
  relations: Array<{ subject: string; predicate: string; object: string; context: string }>;
  dates: string[];
  numbers: Map<string, string[]>;
  concepts: Map<string, Set<string>>;
}

function extractDates(content: string): string[] {
  const dates: string[] = [];
  const patterns = [
    /\b(\d{4})-(\d{2})-(\d{2})\b/g,
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})\b/gi,
    /\b(\d{1,2})\s*(?:st|nd|rd|th)\s+(?:of\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)\b/gi,
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\.?\s+(\d{1,2}),?\s*(\d{4})\b/gi,
    /\b(?:in|since|from|after|before|until|around)\s+(?:the\s+)?(?:year\s+)?(\d{4})\b/gi,
  ];
  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(content)) !== null) {
      dates.push(match[0]);
    }
  }
  return dates;
}

function extractNumbers(content: string): Map<string, string[]> {
  const numbers = new Map<string, string[]>();
  const patterns: Array<[RegExp, string]> = [
    [/\b(\$|€|£|¥)\s*(\d+(?:\.\d{2})?)\b/g, "money"],
    [/\b(\d+(?:\.\d+)?)\s*(%|percent)\b/g, "percentage"],
    [/\b(\d+(?:\.\d+)?)\s*(km|miles?|meters?|feet|inches?|cm|mm)\b/gi, "distance"],
    [/\b(\d+(?:\.\d+)?)\s*(kg|lbs?|g|oz|tons?)\b/gi, "weight"],
    [/\b(\d+(?:\.\d+)?)\s*(GB|MB|TB|KB|bytes?)\b/gi, "data_size"],
    [/\b(\d{4})\b/g, "year"],
    [/\b(\d{1,2}:\d{2}(?:\s*(?:am|pm))?)\b/g, "time"],
    [/\b(\d+)\s*(years?|months?|days?|hours?|minutes?|seconds?)\b/gi, "duration"],
  ];
  for (const [regex, type] of patterns) {
    let match;
    while ((match = regex.exec(content)) !== null) {
      if (!numbers.has(type)) numbers.set(type, []);
      numbers.get(type)!.push(match[0]);
    }
  }
  return numbers;
}

function extractNamedEntities(content: string): Map<string, string[]> {
  const entities = new Map<string, string[]>();

  const techPattern = /\b(python|javascript|typescript|java|c\+\+|ruby|go|rust|swift|kotlin|php|sql|html|css|react|vue|angular|node|django|flask|spring|rails)\b/gi;
  let m;
  while ((m = techPattern.exec(content)) !== null) {
    if (!entities.has("technology")) entities.set("technology", []);
    const val = m[1].toLowerCase();
    if (!entities.get("technology")!.includes(val)) entities.get("technology")!.push(val);
  }

  const platformPattern = /\b(windows|macos|linux|android|ios|ubuntu|debian|centos|fedora)\b/gi;
  while ((m = platformPattern.exec(content)) !== null) {
    if (!entities.has("platform")) entities.set("platform", []);
    const val = m[1].toLowerCase();
    if (!entities.get("platform")!.includes(val)) entities.get("platform")!.push(val);
  }

  const orgPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:Inc|Corp|Ltd|LLC|Company|Co|University|College|School|Institute)\b/g;
  while ((m = orgPattern.exec(content)) !== null) {
    if (!entities.has("organization")) entities.set("organization", []);
    if (!entities.get("organization")!.includes(m[0])) entities.get("organization")!.push(m[0]);
  }

  return entities;
}

function extractRelations(content: string): Array<{ subject: string; predicate: string; object: string }> {
  const relations: Array<{ subject: string; predicate: string; object: string }> = [];

  const patterns: Array<[RegExp, string, number, number]> = [
    [/\b(My\s+)?(wife|husband|partner|girlfriend|boyfriend|friend|colleague|brother|sister|mother|father|parent|child|son|daughter)\s+([A-Z][a-z]+)\s+(?:is|was)\s+(?:a|an)?\s*(.+?)(?:\s*[.!?:;]|$)/gi, "relationship-person", 2, 4],
    [/\b(I|User|We)\s+(?:work|worked|works)\s+(?:at|for|with)\s+(.+?)(?:\s*[.!?:;]|$)/gi, "works-at", 1, 2],
    [/\b(I|User|We)\s+(?:live|lived|lives)\s+(?:in|at|on)\s+(.+?)(?:\s*[.!?:;]|$)/gi, "lives-in", 1, 2],
    [/\b(I|User|We)\s+(?:like|liked|love|loved|enjoy|enjoyed|prefer|prefer|prefer)\s+(.+?)(?:\s*[.!?:;]|$)/gi, "likes", 1, 2],
    [/\b(I|User|We)\s+(?:study|studied|learning|learn)\s+(.+?)(?:\s*[.!?:;]|$)/gi, "studies", 1, 2],
    [/\b(I|User|We)\s+(?:want|wanted|need|needed|desire|desire)\s+(.+?)(?:\s*[.!?:;]|$)/gi, "wants", 1, 2],
    [/\b(I|User|We)\s+(?:create|created|build|built|make|made|develop|developed|design|designed)\s+(.+?)(?:\s*[.!?:;]|$)/gi, "created", 1, 2],
    [/\b(I|User|We)\s+(?:buy|bought|purchase|purchased|acquire|acquired|obtain|obtained)\s+(.+?)(?:\s*[.!?:;]|$)/gi, "acquired", 1, 2],
    [/\b(I|User|We)\s+(?:sell|sold|trade|traded|exchange|exchanged)\s+(.+?)(?:\s*[.!?:;]|$)/gi, "traded", 1, 2],
    [/\b(I|User|We)\s+(?:visit|visited|go\s+to|went\s+to|travel|traveled\s+to|move|moved\s+to)\s+(.+?)(?:\s*[.!?:;]|$)/gi, "visited", 1, 2],
    [/\b(I|User|We)\s+(?:meet|met|talk|talked\s+to|speak|spoke\s+with)\s+(.+?)(?:\s*[.!?:;]|$)/gi, "met", 1, 2],
    [/\b(I|User|We)\s+(?:complete|completed|finish|finished|end|ended)\s+(.+?)(?:\s*[.!?:;]|$)/gi, "completed", 1, 2],
    [/\b(I|User|We)\s+(?:start|started|begin|began|initiate|initiated)\s+(.+?)(?:\s*[.!?:;]|$)/gi, "started", 1, 2],
    [/\b(I|User|We)\s+(?:stop|stopped|quit|abandon|abandoned|give\s+up)\s+(.+?)(?:\s*[.!?:;]|$)/gi, "stopped", 1, 2],
    [/\b(My\s+)?goal\s+is\s+to\s+(.+?)(?:\s*[.!?:;]|$)/gi, "goal", 0, 2],
    [/\b(is|was|are|were)\s+(?:a|an)?\s*(.+?)(?:\s*[.!?:;]|$)/gi, "is-a", 0, 2],
    [/\b(has|have|had)\s+(?:a|an)?\s*(.+?)(?:\s*[.!?:;]|$)/gi, "has", 0, 2],
  ];

  for (const [regex, predicate, subjectGroup, objectGroup] of patterns) {
    let match;
    while ((match = regex.exec(content)) !== null) {
      const subject = subjectGroup === 0 ? "" : (match[subjectGroup] || "").trim();
      const object = (match[objectGroup] || "").trim();
      if (object) {
        relations.push({ subject, predicate, object });
      }
    }
  }

  return relations;
}

function buildKnowledgeGraph(memories: Memory[]): KnowledgeGraph {
  const graph: KnowledgeGraph = {
    namedEntities: new Map(),
    relations: [],
    dates: [],
    numbers: new Map(),
    concepts: new Map(),
  };

  for (const mem of memories) {
    const dates = extractDates(mem.content);
    graph.dates.push(...dates);

    const numbers = extractNumbers(mem.content);
    for (const [type, vals] of numbers) {
      if (!graph.numbers.has(type)) graph.numbers.set(type, []);
      graph.numbers.get(type)!.push(...vals);
    }

    const entities = extractNamedEntities(mem.content);
    for (const [type, vals] of entities) {
      if (!graph.namedEntities.has(type)) graph.namedEntities.set(type, []);
      for (const v of vals) {
        if (!graph.namedEntities.get(type)!.includes(v)) graph.namedEntities.get(type)!.push(v);
      }
    }

    const relations = extractRelations(mem.content);
    for (const rel of relations) {
      graph.relations.push({ ...rel, context: mem.content });
    }

    const words = mem.content.toLowerCase().split(/[\s,.;:!?'"]+/);
    for (const word of words) {
      if (word.length < 3) continue;
      if (!graph.concepts.has(word)) graph.concepts.set(word, new Set());
      graph.concepts.get(word)!.add(mem.id);
    }
  }

  return graph;
}

function inferFromGraph(graph: KnowledgeGraph, memories: Memory[]): SynthesizedFact[] {
  const facts: SynthesizedFact[] = [];
  const seen = new Set<string>();
  const currentYear = new Date().getFullYear();

  const yearNums = graph.numbers.get("year") || [];
  for (const yearStr of yearNums) {
    const year = Number(yearStr.match(/\d+/)?.[0]);
    if (!year || year < 1900 || year > currentYear + 10) continue;
    const elapsed = currentYear - year;
    if (elapsed > 0 && elapsed < 100) {
      const key = `year-${year}`;
      if (!seen.has(key)) {
        seen.add(key);
        const relatedMems = memories.filter((m) => m.content.includes(yearStr));
        facts.push({
          derivedFrom: relatedMems.map((m) => m.id),
          fact: `${elapsed} years since ${year}`,
        });
      }
    }
  }

  const durationNums = graph.numbers.get("duration") || [];
  for (const dur of durationNums) {
    const match = dur.match(/(\d+)\s*(years?|months?|days?|hours?|minutes?)/i);
    if (match) {
      const key = `duration-${dur}`;
      if (!seen.has(key)) {
        seen.add(key);
        const relatedMems = memories.filter((m) => m.content.includes(dur));
        facts.push({
          derivedFrom: relatedMems.map((m) => m.id),
          fact: `Duration: ${match[1]} ${match[2]}`,
        });
      }
    }
  }

  const moneyNums = graph.numbers.get("money") || [];
  for (const money of moneyNums) {
    const match = money.match(/[$€£¥]\s*(\d+(?:\.\d{2})?)/);
    if (match) {
      const amount = Number(match[1]);
      const key = `money-${money}`;
      if (!seen.has(key)) {
        seen.add(key);
        const relatedMems = memories.filter((m) => m.content.includes(money));
        facts.push({
          derivedFrom: relatedMems.map((m) => m.id),
          fact: `Financial: ${money} (${amount > 1000 ? "significant" : "minor"} amount)`,
        });
      }
    }
  }

  for (const rel of graph.relations) {
    if (rel.predicate === "works-at") {
      const yearMems = memories.filter((m) => {
        const lc = m.content.toLowerCase();
        return lc.includes(rel.object.toLowerCase()) &&
          (lc.includes("started") || lc.includes("since") || lc.includes("began") || lc.includes("in "));
      });
      for (const ym of yearMems) {
        const yearMatch = ym.content.match(/\b(19[0-9]{2}|20[0-9]{2})\b/);
        if (yearMatch) {
          const startYear = Number(yearMatch[1]);
          const duration = currentYear - startYear;
          const key = `work-${rel.object}-${startYear}`;
          if (!seen.has(key)) {
            seen.add(key);
            facts.push({
              derivedFrom: [ym.id],
              fact: `${rel.subject || "User"} at ${rel.object}: ~${duration} years (since ${startYear})`,
            });
          }
        }
      }
    }

    if (rel.predicate === "lives-in") {
      const locMems = memories.filter((m) => {
        const lc = m.content.toLowerCase();
        return lc.includes(rel.object.toLowerCase()) &&
          (lc.includes("is in") || lc.includes("is a") || lc.includes("is an") || lc.includes("located"));
      });
      for (const lm of locMems) {
        const locMatch = lm.content.match(
          new RegExp(`${rel.object.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+is\\s+(?:in|a|an)\\s+(.+?)(?:\\s*[.!?:;]|$)`, "i"),
        );
        if (locMatch) {
          const key = `loc-${rel.object}-${locMatch[1]}`;
          if (!seen.has(key)) {
            seen.add(key);
            facts.push({
              derivedFrom: [lm.id],
              fact: `${rel.object} is in ${locMatch[1].trim()}`,
            });
          }
        }
      }
    }

    if (rel.predicate === "likes") {
      const catMems = memories.filter((m) => {
        const lc = m.content.toLowerCase();
        return lc.includes(rel.object.toLowerCase()) &&
          (lc.includes("is a") || lc.includes("is an") || lc.includes("type"));
      });
      for (const cm of catMems) {
        const catMatch = cm.content.match(
          new RegExp(`${rel.object.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+is\\s+(?:a|an)?\\s*(.+?)(?:\\s*[.!?:;]|$)`, "i"),
        );
        if (catMatch) {
          const key = `cat-${rel.object}-${catMatch[1]}`;
          if (!seen.has(key)) {
            seen.add(key);
            facts.push({
              derivedFrom: [cm.id],
              fact: `Interest: ${rel.object} (${catMatch[1].trim()})`,
            });
          }
        }
      }
    }

    if (rel.predicate === "relationship-person") {
      const key = `rel-${rel.subject}-${rel.object}`;
      if (!seen.has(key)) {
        seen.add(key);
        facts.push({
          derivedFrom: [],
          fact: `${rel.subject}: ${rel.object} (${rel.predicate})`,
        });
      }
    }

    if (rel.predicate === "goal") {
      const key = `goal-${rel.object}`;
      if (!seen.has(key)) {
        seen.add(key);
        facts.push({
          derivedFrom: [],
          fact: `Goal: ${rel.object}`,
        });
      }
    }
  }

  const conceptCounts = new Map<string, number>();
  for (const [concept, memIds] of graph.concepts) {
    if (memIds.size >= 2 && concept.length > 4) {
      conceptCounts.set(concept, memIds.size);
    }
  }
  const topConcepts = [...conceptCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  for (const [concept, count] of topConcepts) {
    const key = `concept-${concept}`;
    if (!seen.has(key)) {
      seen.add(key);
      const relatedMems = memories.filter((m) => m.content.toLowerCase().includes(concept));
      facts.push({
        derivedFrom: relatedMems.map((m) => m.id),
        fact: `Recurring: "${concept}" (${count} mentions)`,
      });
    }
  }

  return facts;
}

export async function synthesizeMemories(
  memories: Array<{ id: string; content: string; createdAt: number }>,
): Promise<SynthesizedFact[]> {
  const maxFacts = CONFIG.synthesis.maxSynthesizedFacts;
  const graph = buildKnowledgeGraph(memories);
  const inferredFacts = inferFromGraph(graph, memories);

  const seen = new Set<string>();
  const uniqueFacts: SynthesizedFact[] = [];

  for (const fact of inferredFacts) {
    if (uniqueFacts.length >= maxFacts) break;
    const key = fact.fact.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueFacts.push(fact);
  }

  return uniqueFacts;
}
