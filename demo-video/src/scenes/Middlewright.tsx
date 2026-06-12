import React from "react";
import { Annotation } from "../components/Annotation";
import { CodeWindow } from "../components/CodeWindow";
import { ConfigChip } from "../components/ConfigChip";
import { DemoApp } from "../components/DemoApp";
import { Terminal } from "../components/Terminal";
import { Workbench } from "../components/Workbench";
import { helperLines, specLines } from "../snippets";
import { colors, layout } from "../theme";

export const MiddlewrightScene: React.FC = () => {
  return (
    <Workbench
      label="The fix: middlewright’s spinnerWaiter"
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
          comment="// new — aggressive on purpose"
        />
      }
      chipAt={210}
      app={<DemoApp />}
      terminal={
        <Terminal lines={[{ at: 0, type: "cmd", text: "" }]} width={layout.terminal.w} height={layout.terminal.h} />
      }
    >
      <Annotation at={95} until={160} x={985} y={700} variant="solution" arrow="left" arrowOffset={42}>
        Solve with middlewright. Set it up in a fixture, <i>once</i>. Don't touch the test code.
      </Annotation>
      <Annotation at={168} x={985} y={750} variant="info" arrow="left" arrowOffset={42}>
        spinnerWaiter: if the app is <b>visibly loading</b>, wait up to 30s. If it isn’t — fail fast.
      </Annotation>
      <Annotation at={235} x={985} y={545} width={380} variant="info" arrow="left" arrowOffset={36}>
        Now you can <i><u>reduce</u></i> the actionTimeout to something much more aggressive.
      </Annotation>
    </Workbench>
  );
};
