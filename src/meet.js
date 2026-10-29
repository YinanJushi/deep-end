import { menuFor, scoreFromEntry } from './dive.js';
import { wait, until } from './motion.js';

const $ = (id) => document.getElementById(id);
const shuffle = (a) => { const r = a.slice(); for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
const TITLES = { 10: '10 m platform', 3: '3 m springboard', free: 'Free swim' };

export class Meet {
  constructor(actors) {
    this.actors = actors; this.gen = null; this.event = '10'; this.pending = null; this.current = null;
    this.cards = [...document.querySelectorAll('#cards .card')];
  }

  start(ev) {
    this.event = ev; this.gen = null; this.pending = null; this.current = null;
    const A = this.actors;
    for (const d of A.divers || []) { d.reset(); d.total = 0; d.last = null; d.celebrate = false; d.mode = ev === 'free' ? 'free' : 'meet'; d.dives = []; }
    for (const j of A.judges || []) { j.want = 0; j.raise = 0; }
    this.clearCards();
    $('evTitle').textContent = TITLES[ev];
    $('curDiver').textContent = ev === 'free' ? 'Boards open' : 'Warming up…';
    $('curDive').textContent = ev === 'free' ? 'Divers jump, swim, shower and soak. Scoring is paused.' : 'Divers take their places on the bench.';
    $('total').innerHTML = '&nbsp;';
    this.renderTable();
  }

  update(dt) {
    if (!this.gen) this.gen = this.run();
    const r = this.gen.next(dt);
    if (r.done) this.gen = null;
  }

  clearCards() {
    for (const c of this.cards) { c.className = 'card'; c.textContent = '–'; }
    for (const j of this.actors.judges || []) j.want = 0;
  }

  renderTable() {
    const A = this.actors, body = document.querySelector('#table tbody');
    if (!body) return;
    const rows = [...(A.divers || [])].sort((a, b) => b.total - a.total);
    body.textContent = '';
    rows.forEach((d, i) => {
      const tr = document.createElement('tr');
      if (this.current === d) tr.className = 'now';
      for (const t of [String(i + 1), d.name, d.last == null ? '–' : d.last.toFixed(1), d.total.toFixed(1)]) { const td = document.createElement('td'); td.textContent = t; tr.appendChild(td); }
      body.appendChild(tr);
    });
  }

  /** called by a diver at the instant the entry happens */
  onEntry(diver, ev, dive) { this.pending = { diver, ev, dive }; }

  assign(height) {
    const menu = menuFor(height);
    for (const d of this.actors.divers) d.dives = shuffle(menu).slice(0, 3).sort((a, b) => a.dd - b.dd);
  }

  *run() {
    const ev = this.event, A = this.actors;
    if (ev === 'free') { for (;;) { yield; } }
    const height = ev === '10' ? 10 : 3, token = ev;
    this.assign(height);
    yield* wait(2);
    for (let round = 0; round < 3; round++) {
      const order = round === 0 ? shuffle(A.divers) : [...A.divers].sort((a, b) => a.total - b.total);
      for (const d of order) {
        const dive = d.dives[round];
        this.current = d; d.entry = null; this.pending = null;
        $('curDiver').textContent = d.name;
        $('curDive').textContent = `${dive.name} · DD ${dive.dd.toFixed(1)} · round ${round + 1} of 3`;
        $('total').innerHTML = '&nbsp;';
        this.clearCards(); this.renderTable();
        d.task = { dive, height, scored: true };
        let guard = 0;
        while (d.state !== 'ready' && guard < 120) { guard += yield; }
        guard = 0;
        while (A.divers.some((o) => o !== d && o.state === 'water') && guard < 40) { guard += yield; }
        yield* wait(0.5);
        d.go = true;
        guard = 0;
        while (!this.pending && guard < 25) { guard += yield; }
        if (!this.pending) continue;
        const p = this.pending; this.pending = null;
        yield* wait(2.6);
        yield* this.reveal(d, dive, p.ev);
        yield* wait(4.0);
      }
    }
    // results
    this.current = null; this.clearCards();
    const rank = [...A.divers].sort((a, b) => b.total - a.total);
    $('curDiver').textContent = 'Final results';
    $('curDive').textContent = `${rank[0].name} wins the ${TITLES[ev]} with ${rank[0].total.toFixed(1)} points.`;
    $('total').textContent = `Silver ${rank[1].name} · Bronze ${rank[2].name}`;
    this.renderTable();
    rank[0].celebrate = true;
    yield* wait(16);
    this.start(ev);
  }

  *reveal(d, dive, ev) {
    const A = this.actors;
    const scores = A.judges.map(() => scoreFromEntry(ev, dive));
    A.judges.forEach((j, i) => { j.draw(scores[i].toFixed(1), false); });
    for (let i = 0; i < 5; i++) {
      A.judges[i].want = 1;
      this.cards[i].className = 'card up'; this.cards[i].textContent = scores[i].toFixed(1);
      yield* wait(0.35);
    }
    yield* wait(1.2);
    const idx = scores.map((s, i) => [s, i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const lo = idx[0][1], hi = idx[idx.length - 1][1];
    for (const i of [lo, hi]) { this.cards[i].className = 'card drop'; A.judges[i].draw(scores[i].toFixed(1), true); }
    const mid = scores.filter((_, i) => i !== lo && i !== hi);
    const sum = mid.reduce((a, b) => a + b, 0), total = Math.round(sum * dive.dd * 100) / 100;
    d.last = total; d.total += total;
    yield* wait(1.0);
    $('total').textContent = `(${mid.map((m) => m.toFixed(1)).join(' + ')}) × ${dive.dd.toFixed(1)} = ${total.toFixed(2)}`;
    this.renderTable();
    yield* wait(3.2);
    for (const j of A.judges) j.want = 0;
  }
}
