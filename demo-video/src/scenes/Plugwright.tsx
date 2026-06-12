import React from "react";
import { Annotation } from "../components/Annotation";
import { CodeWindow } from "../components/CodeWindow";
import { ConfigChip } from "../components/ConfigChip";
import { DemoApp } from "../components/DemoApp";
import { Terminal } from "../components/Terminal";
import { Workbench } from "../components/Workbench";
import { helperLines, specLines } from "../snippets";
import { colors, layout } from "../theme";

export const PlugwrightScene: React.FC = () => {
  return (
    <Workbench
      label="The fix: plugwright’s spinnerWaiter"
      labelColor={colors.green}
      spec={
        <CodeWindow
          title="report.spec.ts"
          lines={specLines({ importFrom: "./test-helpers", importDiff: true })}
          width={layout.spec.w}
          height={layout.spec.h}
        />
      }
      ancillary={
        <CodeWindow
          title="test-helpers.ts  ✨ new"
          lines={helperLines(35, 130)}
          width={layout.ancillary.w}
          height={layout.ancillary.h}
          fontSize={16}
        />
      }
      ancillaryAt={20}
      chip={
        <ConfigChip
          width={layout.chip.w}
          height={layout.chip.h}
          value="1_000"
          comment="// unchanged — still failing fast"
        />
      }
      chipAt={210}
      app={<DemoApp />}
      terminal={
        <Terminal lines={[{ at: 0, type: "cmd", text: "" }]} width={layout.terminal.w} height={layout.terminal.h} />
      }
    >
      <Annotation at={95} until={160} x={985} y={700} variant="solution" arrow="left" arrowOffset={42}>
        Wire it up <b>once</b>, in a fixture. The test itself stays completely ordinary.
      </Annotation>
      <Annotation at={168} x={985} y={750} variant="info" arrow="left" arrowOffset={42}>
        spinnerWaiter: if the app is <b>visibly loading</b>, wait up to 30s. If it isn’t — fail fast.
      </Annotation>
      <Annotation at={235} x={985} y={545} width={380} variant="info" arrow="left" arrowOffset={36}>
        No per-click timeout bumps: actionTimeout stays at <b>1 second</b>.
      </Annotation>
    </Workbench>
  );
};
