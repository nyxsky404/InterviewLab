// Display metadata for the four interview types. The interviewing behavior
// lives entirely on the server (backend/src/domain/interviewTypes.js) — this is
// presentation only: copy, icon, and accent color per type.

export const INTERVIEW_TYPES = [
  {
    id: "behavioral",
    label: "Behavioral",
    blurb: "Walk through past projects. Tests communication, STAR structure, and self-awareness.",
    interviewer: "Maya Chen",
    accent: "#4f46e5",
    soft: "#eef2ff",
    icon: "chat",
  },
  {
    id: "technical",
    label: "Technical",
    blurb: "A spoken deep-dive into your stack. Tests depth of knowledge and problem-solving.",
    interviewer: "Alex Rivera",
    accent: "#0d9488",
    soft: "#f0fdfa",
    icon: "code",
  },
  {
    id: "system_design",
    label: "System Design",
    blurb: "Design a real system out loud. Tests architecture thinking and tradeoffs.",
    interviewer: "Priya Nair",
    accent: "#d97706",
    soft: "#fffbeb",
    icon: "diagram",
  },
  {
    id: "hr",
    label: "HR / Culture Fit",
    blurb: "The human conversation. Tests motivation, values, and situational judgment.",
    interviewer: "Jordan Blake",
    accent: "#db2777",
    soft: "#fdf2f8",
    icon: "people",
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
};

export function TypeIcon({ icon, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      {ICON_PATHS[icon] || ICON_PATHS.chat}
    </svg>
  );
}
