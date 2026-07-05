import { franc } from "franc-min";
import { iso6393To1 } from "iso-639-3";
import { CONFIG } from "../config.js";

const LANGUAGE_MAP = iso6393To1 as Record<string, string>;

const SEGMENTER_CACHE = new Map<string, Intl.Segmenter>();

function getSegmenter(locale: string, granularity: "sentence" | "word"): Intl.Segmenter {
  const key = `${locale}:${granularity}`;
  let seg = SEGMENTER_CACHE.get(key);
  if (!seg) {
    seg = new Intl.Segmenter(locale, { granularity });
    SEGMENTER_CACHE.set(key, seg);
  }
  return seg;
}

export function detectLanguage(content: string): string {
  if (content.length < 20 && CONFIG.autoCaptureLanguage) {
    return CONFIG.autoCaptureLanguage;
  }
  const francResult = franc(content);
  if (francResult === "und") {
    return CONFIG.autoCaptureLanguage || "eng";
  }
  return francResult;
}

export function francToSegmenterLocale(francLang: string): string {
  const locale = LANGUAGE_MAP[francLang] || "en";
  try {
    Intl.Segmenter.supportedLocalesOf([locale]);
    return locale;
  } catch {
    return "en";
  }
}

export function segmentSentences(content: string, lang?: string): string[] {
  const detected = lang || detectLanguage(content);
  const locale = francToSegmenterLocale(detected);
  const seg = getSegmenter(locale, "sentence");
  return [...seg.segment(content)].map((s) => s.segment.trim()).filter((s) => s.length > 0);
}

export function tokenizeWords(content: string, lang?: string): string[] {
  const detected = lang || detectLanguage(content);
  const locale = francToSegmenterLocale(detected);
  const seg = getSegmenter(locale, "word");
  return [...seg.segment(content)]
    .filter((s) => s.isWordLike)
    .map((s) => s.segment.toLowerCase())
    .filter((s) => s.length > 0);
}

let stopwordModule: any = null;

async function getStopwordsForLang(lang: string): Promise<string[]> {
  if (!stopwordModule) {
    stopwordModule = await import("stopword");
  }
  const list = stopwordModule[lang] || stopwordModule.eng;
  return Array.isArray(list) ? list : [];
}

export async function extractKeywords(content: string, lang?: string): Promise<string[]> {
  const detected = lang || detectLanguage(content);
  const tokens = tokenizeWords(content, detected);
  if (tokens.length === 0) return [];
  const stopwords = await getStopwordsForLang(detected);
  return tokens.filter((t) => !stopwords.includes(t));
}
