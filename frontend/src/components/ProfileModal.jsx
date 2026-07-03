import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import "../styles/modal.css";

const LEVELS = [
  { value: "junior", label: "Junior" },
  { value: "mid", label: "Mid" },
  { value: "senior", label: "Senior" },
];

const RESUME_MAX_CHARS = 3500;

export default function ProfileModal({ onClose }) {
  const { user, updateUser } = useAuth();
  const [form, setForm] = useState({
    name: user.name || "",
    jobRole: user.jobRole || "",
    experienceLevel: user.experienceLevel || "mid",
    yearsExperience: user.yearsExperience ?? "",
    skills: user.skills || "",
    resumeText: user.resumeText || "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Close on Escape.
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    setBusy(true);
    setError("");
    try {
      const { user: updated } = await api.updateProfile({
        name: form.name,
        jobRole: form.jobRole,
        experienceLevel: form.experienceLevel,
        yearsExperience: form.yearsExperience === "" ? null : form.yearsExperience,
        skills: form.skills,
        resumeText: form.resumeText,
      });
      updateUser(updated);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const resumeLen = form.resumeText.length;

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal fade-up"
        role="dialog"
        aria-modal="true"
        aria-label="Edit profile"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2>Your profile</h2>
            <p className="muted small">
              Your resume and skills let the interviewer ask questions about your real work — and
              power the resume-vs-interview gap analysis in your report.
            </p>
          </div>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="field-row">
            <div>
              <label htmlFor="p-name">Full name</label>
              <input id="p-name" value={form.name} onChange={set("name")} placeholder="Casey Candidate" />
            </div>
            <div>
              <label htmlFor="p-role">Target job role</label>
              <input id="p-role" value={form.jobRole} onChange={set("jobRole")} placeholder="Backend Engineer" />
            </div>
          </div>

          <div className="field-row">
            <div>
              <label>Experience level</label>
              <div className="segmented" role="radiogroup" aria-label="Experience level">
                {LEVELS.map((l) => (
                  <button
                    key={l.value}
                    type="button"
                    className={form.experienceLevel === l.value ? "active" : ""}
                    onClick={() => setForm((f) => ({ ...f, experienceLevel: l.value }))}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="years-field">
              <label htmlFor="p-years">Years of experience</label>
              <input
                id="p-years"
                type="number"
                min="0"
                max="60"
                value={form.yearsExperience}
                onChange={set("yearsExperience")}
                placeholder="4"
              />
            </div>
          </div>

          <label htmlFor="p-skills">Key skills</label>
          <input
            id="p-skills"
            value={form.skills}
            onChange={set("skills")}
            placeholder="Node.js, PostgreSQL, distributed systems, React"
          />

          <label htmlFor="p-resume">Resume</label>
          <textarea
            id="p-resume"
            className="resume-input"
            value={form.resumeText}
            onChange={set("resumeText")}
            maxLength={RESUME_MAX_CHARS}
            placeholder="Paste your resume here: experience, projects, and the technologies you've used."
            rows={9}
          />
          <div className="resume-foot">
            <span className="subtle small">
              {`${resumeLen.toLocaleString()} / ${RESUME_MAX_CHARS.toLocaleString()}`}
            </span>
          </div>

          {error && <div className="error-banner">{error}</div>}
        </div>

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save profile"}
          </button>
        </div>
      </div>
    </div>
  );
}
