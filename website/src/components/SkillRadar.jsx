// Isolated so the chart library is a separate chunk, loaded only when results
// are actually shown. It is ~318 KB — nearly half the app's payload — and the
// landing, login and signup pages never draw a chart.
import {
  ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis,
  Radar, Tooltip as RTooltip,
} from "recharts";
import { T } from "../lib/theme.js";

export default function SkillRadar({ data }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <RadarChart data={data} outerRadius="72%">
        <PolarGrid stroke={T.border} />
        <PolarAngleAxis dataKey="tag" tick={{ fill: T.textDim, fontSize: 11 }} />
        <RTooltip
          contentStyle={{
            background: T.surfaceHi, border: `1px solid ${T.borderHi}`,
            borderRadius: 10, fontSize: 13, color: T.text,
          }}
          formatter={(v) => [`${v} / 100`, "Score"]}
        />
        <Radar
          dataKey="score" stroke={T.accent} fill={T.accent}
          fillOpacity={0.22} strokeWidth={2}
          isAnimationActive animationDuration={900}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}
