import { MessageCircle, Code2, Network, Users, FileText } from "lucide-react";

export const INTERVIEW_TYPES = [
  {
    id: "behavioral",
    label: "Behavioral",
    blurb: "Tell real stories from your experience. Tests communication, structure, and impact.",
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
    blurb: "Think through technical problems out loud. Tests depth of knowledge and problem-solving.",
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
    blurb: "Design systems, explain tradeoffs, defend your choices. Tests architecture thinking.",
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
    blurb: "Motivation, teamwork, conflict, and culture fit. Tests values and situational judgment.",
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

const ICONS = {
  chat: MessageCircle,
  code: Code2,
  diagram: Network,
  people: Users,
  doc: FileText,
};

export function TypeIcon({ icon, size = 20 }) {
  const Icon = ICONS[icon] || ICONS.chat;
  return <Icon size={size} aria-hidden="true" />;
}
