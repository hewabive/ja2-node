import { join } from 'node:path';
import { REPO_ROOT } from '../../src/node/repo.ts';
import { evaluateIntExpression, readSource, STRACCIATELLA_COMMIT, sequentialEnum, stripCComments, writeTable } from './c-source.ts';

const SENDER_ENUM_MARKER = 'MAIL_ENRICO=0';
const QUIZ_FUNCTION = 'static void CompileQuestionsInStatsAndWhatNot(void)';
const QUIZ_QUESTIONS = 16;
const NAMED_PROFILES = [
  'NAILS',
  'BIFF',
  'FLO',
  'BUBBA',
  'LARRY_NORMAL',
  'LARRY_DRUNK',
  'NUMB',
  'COUGAR',
  'SAL',
  'CARMEN',
  'DRUGGIST',
  'SLAY',
  'ANNIE',
  'CHRIS',
  'TIFFANY',
  'T_REX',
  'HERVE',
  'CARLO',
];
const TERRORIST_FUNCTION = 'static TerroristInfo const g_terrorist_infos[] =';

type QuizList = 'skill' | 'attitude' | 'personality';
type QuizEffect =
  | { readonly list: QuizList; readonly value: number }
  | { readonly list: 'skill'; readonly male: number; readonly female: number };

const QUIZ_CALLS: Readonly<Record<string, QuizList>> = {
  AddSkillToSkillList: 'skill',
  AddAnAttitudeToAttitudeList: 'attitude',
  AddAPersonalityToPersonalityList: 'personality',
};

function mailDefines(src: string): Map<string, number> {
  const values = new Map<string, number>();
  for (const line of stripCComments(src).split('\n')) {
    const m = /^#define\s+([A-Z0-9_]+)\s+(.+)$/.exec(line.trim());
    if (!m?.[1] || !m[2]) continue;
    const expression = m[2].trim();
    if (!/^[\w\s()+*-]+$/.test(expression)) continue;
    values.set(m[1], evaluateIntExpression(expression, values));
  }
  return values;
}

function anonymousEnum(src: string, marker: string, name: string): Map<string, number> {
  const at = src.indexOf(marker);
  const open = src.lastIndexOf('enum', at);
  if (at < 0 || open < 0) throw new Error(`enum with ${marker} not found`);
  return sequentialEnum(`${src.slice(0, open)}enum ${name}${src.slice(open + 'enum'.length)}`, name);
}

function sectorName(token: string): string | null {
  if (token === '0') return null;
  const m = /^SEC_([A-P]\d{1,2})$/.exec(token);
  if (!m?.[1]) throw new Error(`unknown sector ${token}`);
  return m[1];
}

function terroristInfos(src: string, ids: ReadonlyMap<string, number>): { profile: number; sectors: (string | null)[] }[] {
  const at = src.indexOf(TERRORIST_FUNCTION);
  if (at < 0) throw new Error('terrorist table not found');
  const body = stripCComments(src.slice(src.indexOf('{', at) + 1, src.indexOf('};', at)));
  return [...body.matchAll(/\{\s*(\w+)\s*,\s*\{([^}]*)\}\s*\}/g)].map((m) => ({
    profile: lookup(ids, m[1] ?? ''),
    sectors: (m[2] ?? '').split(',').map((s) => sectorName(s.trim())),
  }));
}

function lookup(names: ReadonlyMap<string, number>, name: string): number {
  const value = names.get(name);
  if (value === undefined) throw new Error(`unknown name ${name}`);
  return value;
}

function quizEffect(statement: string, enums: Readonly<Record<QuizList, ReadonlyMap<string, number>>>): QuizEffect | null {
  const m = /(\w+)\((.+)\)/.exec(statement);
  if (!m?.[1] || !m[2]) return null;
  const list = QUIZ_CALLS[m[1]];
  if (!list) throw new Error(`unknown quiz call ${m[1]}`);
  const gendered = /fCharacterIsMale\s*\?\s*(\w+)\s*:\s*(\w+)/.exec(m[2]);
  if (gendered?.[1] && gendered[2])
    return { list: 'skill', male: lookup(enums.skill, gendered[1]), female: lookup(enums.skill, gendered[2]) };
  return { list, value: lookup(enums[list], m[2].trim()) };
}

function quizQuestions(src: string, enums: Readonly<Record<QuizList, ReadonlyMap<string, number>>>): (QuizEffect | null)[][] {
  const at = src.indexOf(QUIZ_FUNCTION);
  if (at < 0) throw new Error('quiz compiler not found');
  const body = stripCComments(src.slice(at, src.indexOf('\nvoid ', at + QUIZ_FUNCTION.length)));
  const questions: (QuizEffect | null)[][] = [];
  for (const block of body.split(/switch\s*\(\s*iQuizAnswerList\[/).slice(1)) {
    const index = Number(/^(\d+)\]/.exec(block)?.[1]);
    const answers: (QuizEffect | null)[] = [];
    for (const c of block.matchAll(/case\s+(\d+)\s*:([^;]*);/g)) answers[Number(c[1])] = quizEffect(c[2] ?? '', enums);
    questions[index] = answers;
  }
  if (questions.length !== QUIZ_QUESTIONS) throw new Error(`expected ${QUIZ_QUESTIONS} quiz questions, got ${questions.length}`);
  return questions;
}

const profileTypes = readSource('game/Tactical/Soldier_Profile_Type.h');
const enums = {
  skill: sequentialEnum(profileTypes, 'SkillTrait'),
  attitude: sequentialEnum(profileTypes, 'Attitudes'),
  personality: sequentialEnum(profileTypes, 'PersonalityTrait'),
};
const emailHeader = readSource('game/Laptop/EMail.h');
const mail = mailDefines(emailHeader);
const senders = anonymousEnum(emailHeader, SENDER_ENUM_MARKER, 'EmailSenders');
const questions = quizQuestions(readSource('game/Laptop/IMP_Personality_Quiz.cc'), enums);
const profileIds = sequentialEnum(readSource('game/Tactical/Soldier_Profile.h'), 'NPCIDs');
const terrorists = terroristInfos(readSource('game/Tactical/Soldier_Profile.cc'), profileIds);

const out = {
  source: `JA2 Stracciatella ${STRACCIATELLA_COMMIT}: src/game/Laptop/EMail.h (mail offsets, lengths and senders), src/game/Laptop/IMP_Personality_Quiz.cc CompileQuestionsInStatsAndWhatNot`,
  license: 'Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA). See LICENSE.',
  format:
    'mail: every email.edt record define (offsets and lengths) by name; senders: the sender ids; impQuiz: per question the effect of each answer (null = none; skill, attitude or personality with its enum value, or a skill that depends on the sex); profiles: the profile ids the laptop code names; terrorists: g_terrorist_infos in order (profile, the five candidate sectors, null = preplaced)',
  mail: Object.fromEntries(mail),
  senders: Object.fromEntries(senders),
  impQuiz: questions.map((answers) => Array.from({ length: answers.length }, (_, k) => answers[k] ?? null)),
  profiles: Object.fromEntries(NAMED_PROFILES.map((name) => [name, lookup(profileIds, name)])),
  terrorists,
};
const target = join(REPO_ROOT, 'data/tables/laptop.json');
writeTable(target, out);
console.log(`${mail.size} mail defines, ${senders.size} senders, ${questions.length} quiz questions → ${target}`);
