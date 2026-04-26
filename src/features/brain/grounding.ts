import type { BrainCard } from '@/lib/db';

import { STOP_WORDS } from './constants';
import type { BrainPassage } from './types';

const normalizeForSearch = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const getSearchTerms = (value: string) =>
  Array.from(new Set(normalizeForSearch(value).split(' ')))
    .filter((term) => term.length > 2 && !STOP_WORDS.has(term));

const expandTerms = (terms: string[]) =>
  Array.from(new Set(terms.flatMap((term) => {
    if (term === 'ortb') return ['ortb', 'openrtb', 'rtb'];
    if (term === 'openrtb') return ['openrtb', 'ortb', 'rtb'];
    return [term];
  })));

const countTerm = (value: string, term: string) =>
  value.split(term).length - 1;

const isLikelyHeading = (line: string) => {
  const cleanLine = line.replace(/^#+\s*/, '').trim();
  return cleanLine.length > 0 &&
    cleanLine.length <= 80 &&
    cleanLine.split(/\s+/).length <= 8 &&
    !cleanLine.includes(':') &&
    !/[.!?]$/.test(cleanLine);
};

const splitIntoPassages = (card: BrainCard) => {
  const lines = card.content
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const passages: BrainPassage[] = [];
  let heading = card.title;
  let buffer: string[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    passages.push({
      cardTitle: card.title,
      heading,
      text: buffer.join('\n'),
      score: 0,
    });
    buffer = [];
  };

  for (const line of lines) {
    const cleanLine = line.replace(/^#+\s*/, '').trim();
    if (isLikelyHeading(line)) {
      flush();
      heading = cleanLine;
      continue;
    }

    const colonDefinition = cleanLine.match(/^([^:]{3,80}):\s+(.+)$/);
    if (colonDefinition) {
      passages.push({
        cardTitle: card.title,
        heading: colonDefinition[1].trim(),
        text: cleanLine,
        score: 0,
      });
    }

    buffer.push(cleanLine);
  }

  flush();

  if (passages.length === 0 && card.title) {
    passages.push({
      cardTitle: card.title,
      heading: card.title,
      text: card.content || card.title,
      score: 0,
    });
  }

  return passages;
};

const scorePassage = (passage: BrainPassage, terms: string[], question: string) => {
  const headingText = normalizeForSearch(`${passage.cardTitle} ${passage.heading}`);
  const bodyText = normalizeForSearch(passage.text);
  const fullText = `${headingText} ${bodyText}`;
  const phrase = terms.join(' ');
  const normalizedQuestion = normalizeForSearch(question);
  let score = 0;

  for (const term of terms) {
    if (headingText.includes(term)) score += 5;
    if (bodyText.includes(term)) score += 2 + Math.min(countTerm(bodyText, term), 4);
  }

  if (phrase && fullText.includes(phrase)) score += 8;
  if (normalizedQuestion.includes('cycle') && fullText.includes('cycle')) score += 6;
  if (normalizedQuestion.includes('step') && fullText.includes('step')) score += 6;
  if (normalizedQuestion.includes('process') && fullText.includes('process')) score += 4;

  return score;
};

const getRelevantLine = (text: string, terms: string[]) => {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const scoredLines = lines
    .map((line) => ({
      line,
      score: scorePassage({ cardTitle: '', heading: '', text: line, score: 0 }, terms, ''),
    }))
    .sort((a, b) => b.score - a.score);

  return scoredLines[0]?.score > 0 ? scoredLines[0].line : lines[0] || text;
};

const getDefinitionAnswer = (passage: BrainPassage, terms: string[]) => {
  const relevantLine = getRelevantLine(passage.text, terms);
  const colonDefinition = relevantLine.match(/^([^:]{3,80}):\s+(.+)$/);

  if (colonDefinition) {
    const subject = colonDefinition[1].replace(/\([^)]*\)/g, '').trim();
    const body = colonDefinition[2].trim();
    const firstChar = subject.charAt(0).toLowerCase();
    const article = ['a', 'e', 'i', 'o', 'u'].includes(firstChar) ? 'An' : 'A';
    return `${article} ${subject} is the step where ${body.charAt(0).toLowerCase()}${body.slice(1)}`;
  }

  return relevantLine;
};

const getStepAnswer = (passage: BrainPassage) => {
  const lines = passage.text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const stepLines = lines.filter((line) => line.includes(':') || line.length <= 180).slice(0, 8);

  if (stepLines.length < 2) {
    return passage.text;
  }

  return `${passage.heading}:\n${stepLines.map((line) => `- ${line}`).join('\n')}`;
};

export const getGroundingPassages = (question: string, cards: BrainCard[], limit = 6) => {
  const terms = expandTerms(getSearchTerms(question));
  if (terms.length === 0) return [];

  return cards
    .flatMap(splitIntoPassages)
    .map((passage) => ({
      ...passage,
      score: scorePassage(passage, terms, question),
    }))
    .filter((passage) => passage.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
};

export const getBrainResponse = (question: string, cards: BrainCard[]) => {
  const terms = expandTerms(getSearchTerms(question));
  if (terms.length === 0) {
    return 'Ask with a few specific words from your notes.';
  }

  const passages = getGroundingPassages(question, cards, 3);

  if (passages.length === 0) {
    return 'I do not have enough matching notes to answer that accurately. Add it to a Brain card first.';
  }

  const bestPassage = passages[0];
  const normalizedQuestion = normalizeForSearch(question);

  if (/\b(cycle|steps|process|flow)\b/.test(normalizedQuestion)) {
    return getStepAnswer(bestPassage);
  }

  if (/\b(what|define|meaning|explain)\b/.test(normalizedQuestion)) {
    return getDefinitionAnswer(bestPassage, terms);
  }

  return passages
    .map((passage) => getRelevantLine(passage.text, terms))
    .filter(Boolean)
    .join('\n\n');
};
