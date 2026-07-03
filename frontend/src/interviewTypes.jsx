// Display metadata for the four interview types. The interviewing behavior
// lives entirely on the server (backend/src/domain/interviewTypes.js) — this is
// presentation only: copy, icon, accent color, and the per-type voice-orb
// palette + start/end chime that give each interview its own identity.
//
// `orb` is [base, glow, highlight, shadow] — consumed by VoiceOrb (orb.css) as
// --o1..--o4. `chime` is the root note (Hz) the SFX synth builds each type's
// distinct start/end arpeggio from (see audio/sfx.js).

export const INTERVIEW_TYPES = [
  {
    id: "behavioral",
    label: "Behavioral",
    blurb: "Walk through past projects. Tests communication, STAR structure, and self-awareness.",
    interviewer: "Maya Chen",
    accent: "#0070f3",
    soft: "#e9f2ff",
    icon: "chat",
    orb: ["#0070f3", "#38b6ff", "#9fdcff", "#04213f"],
    chime: 523.25, // C5
  },
  {
    id: "technical",
    label: "Technical",
    blurb: "A spoken deep-dive into your stack. Tests depth of knowledge and problem-solving.",
    interviewer: "Alex Rivera",
    accent: "#7928ca",
    soft: "#f3ecfd",
    icon: "code",
    orb: ["#7928ca", "#b14dff", "#e0b8ff", "#1f0a3d"],
    chime: 587.33, // D5
  },
  {
    id: "system_design",
    label: "System Design",
    blurb: "Design a real system out loud. Tests architecture thinking and tradeoffs.",
    interviewer: "Priya Nair",
    accent: "#ab570a",
    soft: "#ffefcf",
    icon: "diagram",
    orb: ["#e07b1a", "#ffab3d", "#ffe0a8", "#3d1c00"],
    chime: 493.88, // B4
  },
  {
    id: "hr",
    label: "HR / Culture Fit",
    blurb: "The human conversation. Tests motivation, values, and situational judgment.",
    interviewer: "Jordan Blake",
    accent: "#eb367f",
    soft: "#fde7f0",
    icon: "people",
    orb: ["#eb367f", "#ff6faf", "#ffc2dd", "#4d0a29"],
    chime: 440.0, // A4
  },
];

export function typeMeta(id) {
  return INTERVIEW_TYPES.find((t) => t.id === id) || INTERVIEW_TYPES[0];
}

const ICON_PATHS = {
  chat: (
    <path
      d="M3 5.5A2.5 2.5 0 0 1 5.5 3h9A2.5 2.5 0 0 1 17 5.5v5a2.5 2.5 0 0 1-2.5 2.5H9l-3.6 3.1c-.5.4-1.4.1-1.4-.6V13A2.5 2.5 0 0 1 3 10.5v-5Z"
      fill="currentColor"
    />
  ),
  code: (
    <path
      d="m7.4 6.3-3.9 3.4a.4.4 0 0 0 0 .6l3.9 3.4a1 1 0 1 1-1.3 1.5l-4.4-3.8a1.9 1.9 0 0 1 0-2.8l4.4-3.8a1 1 0 0 1 1.3 1.5Zm5.2-1.5 4.4 3.8a1.9 1.9 0 0 1 0 2.8l-4.4 3.8a1 1 0 1 1-1.3-1.5l3.9-3.4a.4.4 0 0 0 0-.6l-3.9-3.4a1 1 0 0 1 1.3-1.5Z"
      fill="currentColor"
    />
  ),
  diagram: (
    <path
      d="M8 3h4a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v2h4a1 1 0 0 1 1 1v1h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1v-1H6v1h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1v-1a1 1 0 0 1 1-1h4V8H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
      fill="currentColor"
    />
  ),
  people: (
    <path
      d="M7 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7 0a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM2 15.4C2 12.9 4.2 11 7 11s5 1.9 5 4.4c0 .9-.7 1.6-1.6 1.6H3.6A1.6 1.6 0 0 1 2 15.4Zm11.5 1.6h2.9a1.6 1.6 0 0 0 1.6-1.6c0-2-1.8-3.6-4-3.6-.6 0-1.2.1-1.7.3 1.1 1 1.7 2.3 1.7 3.7 0 .4-.2.9-.5 1.2Z"
      fill="currentColor"
    />
  ),
  doc: (
    <path
      d="M5 2.5h5.2a1 1 0 0 1 .7.3l3.8 3.8a1 1 0 0 1 .3.7V16a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 16V4A1.5 1.5 0 0 1 5 2.5Zm5.5 1.9V6a1 1 0 0 0 1 1h1.6l-2.6-2.6ZM6.5 9.5a.75.75 0 0 0 0 1.5h7a.75.75 0 0 0 0-1.5h-7Zm0 3a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5H6.5Z"
      fill="currentColor"
    />
  ),
};

export function TypeIcon({ icon, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      {ICON_PATHS[icon] || ICON_PATHS.chat}
    </svg>
  );
}
