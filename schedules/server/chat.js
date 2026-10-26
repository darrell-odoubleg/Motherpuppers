const Anthropic = require('@anthropic-ai/sdk');
const { db, FIRST_SLOT_MIN, SLOT_COUNT } = require('./db');

// Schedule assistant: answers questions about the work schedule only. Every
// tool is read-only; changes are still made by admins on the grid.
const MODEL = 'claude-opus-5-5';
const MAX_DAYS = 31;
const MAX_TURNS = 8;
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

const TOOLS = [
  {
    name: 'list_people',
    description: 'Everyone on the schedule: id, name, whether they have a login, and their notes (time-off requests, kids/childcare constraints). Notes are only included where the signed-in user may see them.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_schedule',
    description: `Real schedule for a date range (at most ${MAX_DAYS} days). Per day: each person's shifts as time ranges with hours and cell notes, open shifts, and the times nobody is scheduled. Also weekly hour totals per person.`,
    input_schema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'YYYY-MM-DD' },
        end_date: { type: 'string', description: 'YYYY-MM-DD, inclusive' },
      },
      required: ['start_date', 'end_date'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_permanent_schedule',
    description: 'The two-week permanent schedule (Week A or Week B) that real weeks are filled from, in the same per-day shift format.',
    input_schema: {
      type: 'object',
      properties: { week: { type: 'string', enum: ['A', 'B'] } },
      required: ['week'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_recent_changes',
    description: 'Recent edits to the schedule (who changed what, newest first).',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'integer', description: 'Up to 50; default 20' } },
      additionalProperties: false,
    },
  },
];

module.exports = function mountChat(app, h) {
  const { requireUser, listPeople, today, addDays, mondayOf, templateWeekFor, slotLabel, DAY_NAMES, isDate, toUTC } = h;
  const dayName = date => DAY_NAMES[(toUTC(date).getUTCDay() + 6) % 7];

  // Admins see everyone's notes; staff see only their own.
  const canSeeNotes = (user, p) => user.is_admin || p.id === user.person_id;

  // rows: { slot, lane, person_id, note } for one day -> shifts, open shifts, gaps.
  function describeDay(rows, people) {
    const bySlotPerson = new Map(); // person_id -> Map(slot -> note)
    const covered = new Set();
    for (const r of rows) {
      if (!r.person_id) continue;
      covered.add(r.slot);
      if (!bySlotPerson.has(r.person_id)) bySlotPerson.set(r.person_id, new Map());
      const m = bySlotPerson.get(r.person_id);
      m.set(r.slot, [m.get(r.slot), r.note].filter(Boolean).join(', '));
    }
    const ranges = slots => {
      const out = [];
      for (const s of slots) {
        const last = out[out.length - 1];
        if (last && s === last[1] + 1) last[1] = s; else out.push([s, s]);
      }
      return out;
    };
    const shifts = [], open = [];
    for (const [pid, m] of bySlotPerson) {
      const p = people.get(pid) || { name: 'Unknown' };
      for (const [a, b] of ranges([...m.keys()].sort((x, y) => x - y))) {
        const notes = [...new Set(Array.from({ length: b - a + 1 }, (_, i) => m.get(a + i)).filter(Boolean))];
        const s = { person: p.name, start: slotLabel(a), end: slotLabel(b, true), hours: (b - a + 1) / 2 };
        if (notes.length) s.notes = notes.join('; ');
        (p.is_open ? open : shifts).push(s);
      }
    }
    shifts.sort((x, y) => x.person.localeCompare(y.person));
    const gaps = ranges(Array.from({ length: SLOT_COUNT }, (_, i) => i).filter(i => !covered.has(i)))
      .map(([a, b]) => `${slotLabel(a)}–${slotLabel(b, true)}`);
    return { shifts, open_shifts: open, nobody_scheduled: gaps };
  }

  function hoursByPerson(rows, people) {
    const t = {};
    for (const r of rows) {
      const p = r.person_id && people.get(r.person_id);
      if (p && !p.is_open) t[p.name] = (t[p.name] || 0) + 0.5;
    }
    return t;
  }

  const tools = {
    list_people(user) {
      return listPeople().map(p => {
        const out = { id: p.id, name: p.name, open_shift_placeholder: !!p.is_open, has_login: !!p.login };
        if (canSeeNotes(user, p)) out.notes = p.notes || '';
        return out;
      });
    },
    get_schedule(user, { start_date, end_date }) {
      if (!isDate(start_date) || !isDate(end_date)) return { error: 'Dates must be YYYY-MM-DD' };
      let end = end_date;
      if (end < start_date) return { error: 'end_date is before start_date' };
      if (addDays(start_date, MAX_DAYS - 1) < end) end = addDays(start_date, MAX_DAYS - 1);
      const people = new Map(listPeople({ includeInactive: true }).map(p => [p.id, p]));
      const rows = db.prepare('SELECT date, slot, lane, person_id, note FROM cells WHERE date BETWEEN ? AND ?').all(start_date, end);
      const days = [];
      for (let d = start_date; d <= end; d = addDays(d, 1)) {
        days.push({ date: d, day: dayName(d), ...describeDay(rows.filter(r => r.date === d), people) });
      }
      const weeks = [];
      for (let m = mondayOf(start_date); m <= end; m = addDays(m, 7)) {
        const wr = db.prepare('SELECT person_id FROM cells WHERE date BETWEEN ? AND ?').all(m, addDays(m, 6));
        weeks.push({ week_of: m, permanent_week: templateWeekFor(m), hours: hoursByPerson(wr, people) });
      }
      return { start_date, end_date: end, truncated: end !== end_date, days, weekly_hours: weeks };
    },
    get_permanent_schedule(user, { week }) {
      if (!['A', 'B'].includes(week)) return { error: 'week must be A or B' };
      const people = new Map(listPeople({ includeInactive: true }).map(p => [p.id, p]));
      const rows = db.prepare('SELECT dow, slot, lane, person_id, note FROM template_cells WHERE week = ?').all(week);
      return {
        week,
        days: DAY_NAMES.map((day, dow) => ({ day, ...describeDay(rows.filter(r => r.dow === dow), people) })),
        hours: hoursByPerson(rows, people),
      };
    },
    get_recent_changes(user, { limit }) {
      const n = Math.min(Math.max(Number(limit) || 20, 1), 50);
      return db.prepare('SELECT at, user_name, summary FROM changes ORDER BY id DESC LIMIT ?').all(n);
    },
  };

  function systemPrompt(user) {
    const t = today();
    return `You are the scheduling assistant for Mother Puppers (a dog daycare/grooming business). You help staff and managers with the work schedule at schedules.motherpuppers.net.

You can only read the schedule, through your tools. You cannot change anything. When someone wants a change, suggest exactly what to change (who, day, times), and say a manager (Darrell or Tammie) makes it on the Schedule grid. Only answer questions about the schedule, staff availability and coverage; politely decline anything else.

How the schedule works: half-hour slots from ${slotLabel(0)} to ${slotLabel(SLOT_COUNT - 1, true)}, up to three people at once. "Open shift" means a slot that still needs someone and isn't counted as anyone's hours. The permanent schedule alternates Week A and Week B and is used to fill real weeks.

People's notes hold time-off requests and childcare/kids constraints. Check them before suggesting who could cover a shift, and mention any conflict. Never reveal a note to someone the list_people tool didn't show it to.

Always look things up with the tools rather than guessing. Keep answers short and plain, with times like 9:00am–1:30pm and days like Tue 11/3. Use simple lists, not tables.

Today is ${dayName(t)} ${t} (America/Denver). This week (week of ${mondayOf(t)}) is permanent Week ${templateWeekFor(mondayOf(t))}.
You are talking with ${user.name}${user.is_admin ? ', a manager who can edit the schedule' : ', a staff member (view-only)'}.`;
  }

  // Simple per-user limit so a stuck page can't run up the bill.
  const recent = new Map();
  function overLimit(userId) {
    const now = Date.now();
    const list = (recent.get(userId) || []).filter(t => now - t < 10 * 60000);
    list.push(now);
    recent.set(userId, list);
    return list.length > 40;
  }

  app.post('/api/chat', requireUser, async (req, res) => {
    if (!client) return res.status(503).json({ error: 'The assistant is not set up yet' });
    if (overLimit(req.user.id)) return res.status(429).json({ error: 'Too many questions — give it a few minutes' });
    const history = (Array.isArray(req.body && req.body.messages) ? req.body.messages : [])
      .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-20)
      .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
    if (!history.length || history[history.length - 1].role !== 'user') return res.status(400).json({ error: 'Ask a question' });
    while (history[0].role !== 'user') history.shift();

    const messages = history;
    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const resp = await client.beta.messages.create({
          model: MODEL,
          max_tokens: 16000,
          output_config: { effort: 'low' },
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system: systemPrompt(req.user),
          tools: TOOLS,
          messages,
        });
        if (resp.stop_reason === 'refusal') return res.json({ reply: "Sorry, I can't help with that one." });
        if (resp.stop_reason !== 'tool_use') {
          const reply = resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
          return res.json({ reply: reply || "Sorry, I didn't come up with an answer — try asking another way." });
        }
        messages.push({ role: 'assistant', content: resp.content });
        const results = resp.content.filter(b => b.type === 'tool_use').map(b => {
          let out;
          try {
            out = tools[b.name] ? tools[b.name](req.user, b.input || {}) : { error: 'Unknown tool' };
          } catch (err) {
            out = { error: err.message };
          }
          return { type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(out), is_error: !!(out && out.error) };
        });
        messages.push({ role: 'user', content: results });
      }
      res.json({ reply: 'That took too many lookups — try a narrower question.' });
    } catch (err) {
      console.error('chat error:', err.status || '', err.message);
      res.status(502).json({ error: 'The assistant is unavailable right now — try again in a minute' });
    }
  });
};
