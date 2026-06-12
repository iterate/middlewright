import React from "react";
import { Annotation } from "../components/Annotation";
import { CodeWindow } from "../components/CodeWindow";
import { DemoApp } from "../components/DemoApp";
import { Terminal } from "../components/Terminal";
import { Workbench } from "../components/Workbench";
import { specLines } from "../snippets";
import { colors, layout } from "../theme";

export const SadPathScene: React.FC = () => {
  return (
    <Workbench
      label="The usual “fix”: bump the timeout"
      labelColor={colors.amber}
      spec={
        <CodeWindow
          title="report.spec.ts"
          lines={specLines({ importFrom: "@playwright/test", timeoutDiffAt: 25 })}
          width={layout.spec.w}
          height={layout.spec.h}
        />
      }
      app={<DemoApp />}
      terminal={
        <Terminal lines={[{ at: 0, type: "cmd", text: "" }]} width={layout.terminal.w} height={layout.terminal.h} />
      }
    >
      <Annotation at={90} until={125} x={720} y={300} variant="warn" arrow="left" arrowOffset={42}>
        The classic move: give this one slow click <b>30 seconds</b>. Test goes green. Ship it?
      </Annotation>
      <Annotation at={132} x={280} y={430} width={430} variant="problem" arrow="top" arrowOffset={200}>
        When this <b>actually breaks</b>, you now burn 30s before you find out. Multiply by every slow spot in your suite.
      </Annotation>
      <Annotation at={215} x={1180} y={470} width={460} variant="problem" arrow="top" arrowOffset={120}>
        And users still stare at a frozen page for 20s — the bumped timeout just <b>hides the shitty UX</b>.
      </Annotation>
    </Workbench>
  );
};
