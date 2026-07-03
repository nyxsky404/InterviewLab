// Per-interview UI chimes, synthesized with the Web Audio API so no binary
// assets ship and every type sounds distinct. Each interview type provides a
// root note (`chime` in interviewTypes.jsx); we build a four-note major-ninth
// arpeggio from it — ascending, warm on start; descending, softer on end.
//
// One shared AudioContext, unlocked by the first user gesture (the Join click).

let ctx;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

// Major-9th intervals (semitones) → ratios, so any root yields a pleasant chord.
const STEPS = [0, 4, 7, 11]; // root, maj3, 5th, maj7
const ratio = (semis) => Math.pow(2, semis / 12);

// One plucked note: two slightly detuned oscillators through a gentle lowpass,
// with a quick attack and a long, soft decay.
function note(c, out, freq, at, { dur = 1.2, gain = 0.22, type = "triangle" } = {}) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  g.connect(out);

  for (const detune of [-4, 4]) {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    o.connect(g);
    o.start(at);
    o.stop(at + dur + 0.05);
  }
}

function play(rootHz, { descending, gain, step, dur, lp }) {
  const c = ac();
  if (!c) return;
  const now = c.currentTime + 0.02;

  const master = c.createGain();
  master.gain.value = gain;
  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = lp;
  master.connect(filter);
  filter.connect(c.destination);

  const seq = descending ? [...STEPS].reverse() : STEPS;
  seq.forEach((semis, i) => {
    note(c, master, rootHz * ratio(semis), now + i * step, { dur });
  });

  // A soft root pad underneath ties the arpeggio together.
  note(c, master, rootHz * (descending ? 0.5 : 1), now, {
    dur: step * seq.length + dur,
    gain: 0.12,
    type: "sine",
  });
}

// meta.chime is the root note; falls back to C5 if a type omits it.
export function playInterviewSound(meta, kind) {
  const root = meta?.chime || 523.25;
  if (kind === "end") {
    play(root, { descending: true, gain: 0.2, step: 0.16, dur: 1.4, lp: 2200 });
  } else {
    play(root, { descending: false, gain: 0.26, step: 0.1, dur: 1.1, lp: 3000 });
  }
}
