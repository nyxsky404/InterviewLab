import { forwardRef } from "react";

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
