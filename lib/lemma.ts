// lib/lemma.ts
// 词形还原：把 abandoned / running / went 这类变形词还原成词库里存在的原形。
//
// 只处理「屈折变化」（时态、单复数、比较级），不处理派生（-ly、-tion 之类），
// 因为派生出的是另一个词，硬还原会给出错误释义。

/**
 * 不规则变形表，按原形分组，读起来比 { went: "go", gone: "go" } 清楚。
 * 只收常用的，覆盖日常对话里绝大多数不规则动词。
 */
const IRREGULAR_GROUPS: Record<string, string[]> = {
  be: ["am", "is", "are", "was", "were", "been", "being"],
  have: ["has", "had", "having"],
  do: ["does", "did", "done", "doing"],
  go: ["goes", "went", "gone"],
  say: ["said"],
  make: ["made"],
  take: ["took", "taken"],
  come: ["came"],
  see: ["saw", "seen"],
  get: ["got", "gotten"],
  give: ["gave", "given"],
  know: ["knew", "known"],
  think: ["thought"],
  find: ["found"],
  tell: ["told"],
  become: ["became"],
  show: ["shown"],
  leave: ["left"],
  feel: ["felt"],
  bring: ["brought"],
  write: ["wrote", "written"],
  read: ["read"],
  speak: ["spoke", "spoken"],
  run: ["ran"],
  sit: ["sat"],
  stand: ["stood"],
  understand: ["understood"],
  begin: ["began", "begun"],
  break: ["broke", "broken"],
  choose: ["chose", "chosen"],
  drink: ["drank", "drunk"],
  drive: ["drove", "driven"],
  eat: ["ate", "eaten"],
  fall: ["fell", "fallen"],
  forget: ["forgot", "forgotten"],
  grow: ["grew", "grown"],
  hear: ["heard"],
  hold: ["held"],
  keep: ["kept"],
  lose: ["lost"],
  meet: ["met"],
  pay: ["paid"],
  put: ["put"],
  ride: ["rode", "ridden"],
  rise: ["rose", "risen"],
  sell: ["sold"],
  send: ["sent"],
  sing: ["sang", "sung"],
  sleep: ["slept"],
  spend: ["spent"],
  teach: ["taught"],
  throw: ["threw", "thrown"],
  wear: ["wore", "worn"],
  win: ["won"],
  wake: ["woke", "woken"],
  bear: ["bore", "borne", "born"],
  beat: ["beaten"],
  bend: ["bent"],
  bind: ["bound"],
  bite: ["bit", "bitten"],
  bleed: ["bled"],
  blow: ["blew", "blown"],
  breed: ["bred"],
  build: ["built"],
  burn: ["burnt"],
  buy: ["bought"],
  catch: ["caught"],
  cling: ["clung"],
  creep: ["crept"],
  deal: ["dealt"],
  dig: ["dug"],
  draw: ["drew", "drawn"],
  dream: ["dreamt"],
  feed: ["fed"],
  fight: ["fought"],
  flee: ["fled"],
  fly: ["flew", "flown"],
  forbid: ["forbade", "forbidden"],
  forgive: ["forgave", "forgiven"],
  freeze: ["froze", "frozen"],
  grind: ["ground"],
  hang: ["hung"],
  hide: ["hid", "hidden"],
  kneel: ["knelt"],
  lay: ["laid"],
  lead: ["led"],
  lean: ["leant"],
  leap: ["leapt"],
  learn: ["learnt"],
  lend: ["lent"],
  lie: ["lay", "lain"],
  light: ["lit"],
  mean: ["meant"],
  ring: ["rang", "rung"],
  seek: ["sought"],
  shake: ["shook", "shaken"],
  shine: ["shone"],
  shoot: ["shot"],
  shrink: ["shrank", "shrunk"],
  shut: ["shut"],
  sink: ["sank", "sunk"],
  slide: ["slid"],
  smell: ["smelt"],
  speed: ["sped"],
  spell: ["spelt"],
  spill: ["spilt"],
  spin: ["spun"],
  spit: ["spat"],
  split: ["split"],
  spread: ["spread"],
  spring: ["sprang", "sprung"],
  steal: ["stole", "stolen"],
  stick: ["stuck"],
  sting: ["stung"],
  stink: ["stank", "stunk"],
  strike: ["struck", "stricken"],
  string: ["strung"],
  strive: ["strove", "striven"],
  swear: ["swore", "sworn"],
  sweep: ["swept"],
  swell: ["swelled", "swollen"],
  swim: ["swam", "swum"],
  swing: ["swung"],
  tear: ["tore", "torn"],
  tread: ["trod", "trodden"],
  undertake: ["undertook", "undertaken"],
  weave: ["wove", "woven"],
  weep: ["wept"],
  wind: ["wound"],
  withdraw: ["withdrew", "withdrawn"],
  wring: ["wrung"],
  // 不规则复数
  child: ["children"],
  man: ["men"],
  woman: ["women"],
  foot: ["feet"],
  tooth: ["teeth"],
  mouse: ["mice"],
  goose: ["geese"],
  person: ["people"],
  ox: ["oxen"],
  analysis: ["analyses"],
  crisis: ["crises"],
  thesis: ["theses"],
  hypothesis: ["hypotheses"],
  phenomenon: ["phenomena"],
  criterion: ["criteria"],
};

const IRREGULAR = new Map<string, string>();
for (const [base, forms] of Object.entries(IRREGULAR_GROUPS)) {
  for (const form of forms) {
    if (!IRREGULAR.has(form)) IRREGULAR.set(form, base);
  }
}

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

/** 词尾双写辅音（stopped → stop、running → run） */
function undouble(stem: string): string | null {
  if (stem.length < 3) return null;
  const last = stem.at(-1);
  const prev = stem.at(-2);
  if (!last || last !== prev || VOWELS.has(last)) return null;
  return stem.slice(0, -1);
}

/**
 * 生成候选原形，按可能性从高到低排列。
 * 调用方逐个拿去查词库，命中即止 —— 所以这里允许多给一些不精确的候选。
 */
export function lemmaCandidates(word: string): string[] {
  const w = word.toLowerCase();
  const out: string[] = [];
  const seen = new Set<string>([w]);

  const add = (candidate: string | null | undefined) => {
    if (!candidate || candidate.length < 2) return;
    if (seen.has(candidate)) return;
    seen.add(candidate);
    out.push(candidate);
  };

  // 1. 不规则表最可靠
  add(IRREGULAR.get(w));

  // 2. -ies / -ied → -y（studies → study，studied → study）
  if (w.endsWith("ies") || w.endsWith("ied")) {
    add(`${w.slice(0, -3)}y`);
  }

  // 3. -ing（working → work，making → make，running → run，lying → lie）
  if (w.endsWith("ing") && w.length > 4) {
    const stem = w.slice(0, -3);
    add(stem);
    add(`${stem}e`);
    add(undouble(stem));
    if (stem.endsWith("y")) add(`${stem.slice(0, -1)}ie`);
  }

  // 4. -ed（worked → work，loved → love，stopped → stop，tried → try）
  if (w.endsWith("ed") && w.length > 3) {
    const stem = w.slice(0, -2);
    add(stem);
    add(w.slice(0, -1));
    add(undouble(stem));
  }

  // 5. -es / -s（boxes → box，watches → watch，works → work）
  if (w.endsWith("es") && w.length > 3) {
    add(w.slice(0, -2));
    add(w.slice(0, -1));
  } else if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) {
    add(w.slice(0, -1));
  }

  // 6. -ves → -f / -fe（wolves → wolf，knives → knife）
  if (w.endsWith("ves") && w.length > 4) {
    const stem = w.slice(0, -3);
    add(`${stem}f`);
    add(`${stem}fe`);
  }

  return out;
}

/** 判断两个词是否只差一个屈折变化（用于 UI 提示） */
export function isInflectionOf(form: string, base: string): boolean {
  return form.toLowerCase() !== base.toLowerCase() && lemmaCandidates(form).includes(base.toLowerCase());
}
