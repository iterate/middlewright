import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Annotation } from "../components/Annotation";
import { CodeWindow } from "../components/CodeWindow";
import { Cursor } from "../components/Cursor";
import { CURSOR_HOME, DemoApp, REPORT_BUTTON_CENTER } from "../components/DemoApp";
import { Terminal } from "../components/Terminal";
import { Workbench } from "../components/Workbench";
import { specLines } from "../snippets";
import { colors, layout } from "../theme";

const CLICK = 90;
const FAIL = 162;

export const RunFailSlowScene: React.FC = () => {
  const frame = useCurrentFrame();
  const stopwatchMs =
    frame < CLICK
      ? null
      : interpolate(frame, [CLICK, FAIL], [0, 3300], { extrapolateRight: "clamp" });

  return (
    <Workbench
      label="First run"
      spec={
        <CodeWindow
          title="report.spec.ts"
          lines={specLines({ importFrom: "@playwright/test" })}
          width={layout.spec.w}
          height={layout.spec.h}
        />
      }
      app={
        <>
          <DemoApp pressedAt={CLICK} />
          <Cursor
            visibleFrom={42}
            moves={[
              { ...CURSOR_HOME, at: 45 },
              { ...REPORT_BUTTON_CENTER, at: 82 },
            ]}
            clicksAt={[CLICK]}
          />
        </>
      }
      terminal={
        <Terminal
          width={layout.terminal.w}
          height={layout.terminal.h}
          stopwatchMs={stopwatchMs}
          lines={[
            { at: 0, type: "cmd", text: "npx playwright test" },
            { at: 30, text: "Running 1 test using 1 worker", color: colors.dim },
            { at: FAIL, text: "  1) report.spec.ts:3 › generate a report ─────────────", color: colors.red },
            { at: FAIL + 6, text: "     TimeoutError: locator.click: Timeout 3000ms exceeded.", color: colors.red },
            { at: FAIL + 12, text: "     waiting for getByText('Report ready')", color: colors.dim },
            { at: FAIL + 26, text: "  1 failed (3.3s)", color: colors.red, bold: true },
          ]}
        />
      }
    >
      <Annotation at={200} x={1100} y={470} width={460} variant="problem" arrow="top" arrowOffset={120}>
        The app <i>is</i> generating the report, but it takes a while and there's no progress indicator because you are bad at your job.
      </Annotation>
      <Annotation at={250} x={540} y={690} variant="problem" arrow="right" arrowOffset={42}>
        {`Gave up after 3s (playwright's default timeout). The test will likely be flaky if it sometimes takes <3s, sometimes >3s.`}
      </Annotation>
    </Workbench>
  );
};
