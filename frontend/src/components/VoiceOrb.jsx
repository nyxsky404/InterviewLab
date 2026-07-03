import { forwardRef } from "react";

// ElevenLabs-style voice orb: a glossy sphere with flowing internal "liquid"
// and an outer bloom that reacts to the agent's real output level. The parent
// drives motion by setting `--level` (0..1) on the forwarded root element each
// animation frame; colors come from the interview type's `orb` palette.
//
// variant: "stage" (large, live room) | "lobby" (small, pre-join card).
const VoiceOrb = forwardRef(function VoiceOrb({ meta, variant = "stage" }, ref) {
  const [o1, o2, o3, o4] = meta?.orb || ["#0070f3", "#38b6ff", "#9fdcff", "#04213f"];
  return (
    <div
      ref={ref}
      className={`orb ${variant === "lobby" ? "orb-compact" : ""}`}
      style={{ "--o1": o1, "--o2": o2, "--o3": o3, "--o4": o4 }}
      aria-hidden="true"
    >
      <div className="orb-bloom" />
      <div className="orb-sphere">
        <div className="orb-liquid l1" />
        <div className="orb-liquid l2" />
        <div className="orb-liquid l3" />
        <div className="orb-gloss" />
      </div>
    </div>
  );
});

export default VoiceOrb;
