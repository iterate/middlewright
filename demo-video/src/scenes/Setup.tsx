import React from "react";
import { Annotation } from "../components/Annotation";
import { CodeWindow } from "../components/CodeWindow";
import { DemoApp } from "../components/DemoApp";
import { Terminal } from "../components/Terminal";
import { Workbench } from "../components/Workbench";
import { specLines } from "../snippets";
import { layout } from "../theme";

export const SetupScene: React.FC = () => {
  return (
    <Workbench
      label="An ordinary Playwright test"
      animateIn
      spec={
        <CodeWindow
          title="report.spec.ts"
          lines={specLines({ importFrom: "@playwright/test" })}
          width={layout.spec.w}
          height={layout.spec.h}
        />
      }
      app={<DemoApp />}
      terminal={
        <Terminal lines={[{ at: 0, type: "cmd", text: "" }]} width={layout.terminal.w} height={layout.terminal.h} />
      }
    >
      <Annotation at={55} x={260} y={420} width={440} variant="info" arrow="top" arrowOffset={140}>
        A normal test — no custom helpers, no explicit waits.
      </Annotation>
      <Annotation at={130} x={1100} y={470} width={460} variant="warn" arrow="top" arrowOffset={120}>
        One catch: generating the report takes <b>~20 seconds</b>.
      </Annotation>
    </Workbench>
  );
};
