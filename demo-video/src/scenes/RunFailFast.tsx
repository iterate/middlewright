import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Annotation } from "../components/Annotation";
import { CodeWindow } from "../components/CodeWindow";
import { ConfigChip } from "../components/ConfigChip";
import { Cursor } from "../components/Cursor";
import { CURSOR_HOME, DemoApp, REPORT_BUTTON_CENTER } from "../components/DemoApp";
import { Terminal } from "../components/Terminal";
import { Workbench } from "../components/Workbench";
import { specLines } from "../snippets";
import { colors, layout } from "../theme";

const CLICK = 85;
const FAIL = 138;

export const RunFailFastScene: React.FC = () => {
  const frame = useCurrentFrame();
  const stopwatchMs =
    frame < CLICK
      ? null
      : interpolate(frame, [CLICK, FAIL], [0, 1500], { extrapolateRight: "clamp" });

  return (
    <Workbench
      label="Run again — with middlewright"
      labelColor={colors.green}
      spec={
        <CodeWindow
          title="report.spec.ts"
          lines={specLines({ importFrom: "./test-helpers" })}
          width={layout.spec.w}
          height={layout.spec.h}
        />
      }
      chip={
        <ConfigChip width={layout.chip.w} height={layout.chip.h} value="1_000" comment="// fail fast" />
      }
      app={
        <>
          <DemoApp pressedAt={CLICK} />
          <Cursor
            visibleFrom={38}
            moves={[
              { ...CURSOR_HOME, at: 40 },
              { ...REPORT_BUTTON_CENTER, at: 76 },
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
            { at: 8, type: "cmd", text: "npx playwright test" },
            { at: 32, text: "Running 1 test using 1 worker", color: colors.dim },
            { at: FAIL, text: "  1) report.spec.ts:3 › generate a report ─────────────", color: colors.red },
            { at: FAIL + 6, text: "     TimeoutError: locator.click: Timeout 1000ms exceeded.", color: colors.red },
            { at: FAIL + 14, text: "     If this is a slow operation, update the product code to add a", color: colors.amber },
            { at: FAIL + 20, text: "     spinner while it's running. This will improve the user experience", color: colors.amber },
            { at: FAIL + 26, text: "     and buy you more time for this assertion. Show any element matching:", color: colors.amber },
            { at: FAIL + 32, text: `       locator('[aria-label="Loading"],[data-spinner=\\'true\\'],…')`, color: colors.cyan },
            { at: FAIL + 46, text: "  1 failed (1.5s)", color: colors.red, bold: true },
          ]}
        />
      }
    >
      <Annotation at={205} until={248} x={540} y={680} variant="solution" arrow="right" arrowOffset={42}>
        Fails <i>fast</i>. (Still fails because your app is still bad)
      </Annotation>
      <Annotation at={255} x={540} y={790} variant="info" arrow="right" arrowOffset={42}>
        Now the error tells you or your agent what to <i>actually</i> fix: the shitty UX. Either speed up massively, or add a loading state.
      </Annotation>
    </Workbench>
  );
};
