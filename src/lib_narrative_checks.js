// ---------- Shared narrative checks (prepended by the build to agents that write free text) ----------
// Every task ID, number and date in model-written text must come from the computed facts, and
// names of out-of-scope tasks must not appear.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
const DATE_PATTERNS = [
  [/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m) => [m[1], m[2], m[3]]],
  [new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, 'gi'), (m) => [m[3], MONTHS.indexOf(m[1].toLowerCase().slice(0, 3)) + 1, m[2]]],
  [new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}(?:,?\\s+(\\d{4}))?`, 'gi'), (m) => [m[3], MONTHS.indexOf(m[2].toLowerCase().slice(0, 3)) + 1, m[1]]],
];

function extractDates(text, defaultYear) {
  const found = [];
  let rest = text;
  for (const [re, parts] of DATE_PATTERNS) {
    rest = rest.replace(re, (...m) => {
      const [y, mo, d] = parts(m);
      found.push({ raw: m[0], iso: `${y ?? defaultYear}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
      return ' ';
    });
  }
  return { found, rest };
}

// items: [{ where, text, task_ids }]; allowed: { ids:Set, nums:Set, pcts:Set, dates:Set, forbiddenNames:[] }
function checkNarrative(items, allowed, defaultYear) {
  const issues = [];
  let grounded = 0;
  for (const it of items) {
    const problems = [];
    const ids = [...new Set([...(it.text.match(/\bT\d{3}\b/g) ?? []), ...(it.task_ids ?? [])])];
    const outOfScope = ids.filter((id) => !allowed.ids.has(id));
    if (outOfScope.length) problems.push(`task not in scope: ${outOfScope.join(', ')}`);
    const lower = it.text.toLowerCase();
    const named = (allowed.forbiddenNames ?? []).filter((n) => lower.includes(n.toLowerCase()));
    if (named.length) problems.push(`mentions out-of-scope task: ${named.join(', ')}`);
    const { found, rest } = extractDates(it.text, defaultYear);
    found.filter((d) => !allowed.dates.has(d.iso)).forEach((d) => problems.push(`unsupported date “${d.raw}”`));
    const stripped = rest.replace(/\bT\d{3}\b/g, ' ').replace(/\b(sprint|phase|week|q)\s*\d+/gi, ' ');
    for (const m of stripped.matchAll(/(\d+(?:\.\d+)?)\s*(%|percent)?/g)) {
      const n = Number(m[1]);
      if (m[2] ? !allowed.pcts.has(n) : !allowed.nums.has(n)) problems.push(`unsupported ${m[2] ? 'percentage' : 'number'} “${m[0].trim()}”`);
    }
    if (problems.length) issues.push(`${it.where}: ${problems.join(', ')}`);
    else grounded++;
  }
  return { checked: items.length, grounded, score: items.length ? grounded / items.length : 1, issues };
}

// ---------- Agent code ----------
