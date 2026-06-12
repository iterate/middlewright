import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Annotation } from "../components/Annotation";
import { CodeWindow } from "../components/CodeWindow";
import { ConfigChip } from "../components/ConfigChip";
import { Cursor } from "../components/Cursor";
import { CURSOR_HOME, DemoApp, READY_CENTER, REPORT_BUTTON_CENTER } from "../components/DemoApp";
import { Terminal } from "../components/Terminal";
import { Workbench } from "../components/Workbench";
import { productLines, specLines } from "../snippets";
import { colors, layout } from "../theme";

const CLICK = 75;
const READY = 255;
const PASS = 302;

export const HappyRunScene: React.FC = () => {
  const frame = useCurrentFrame();
  const stopwatchMs =
    frame < CLICK
      ? null
      : interpolate(frame, [CLICK, PASS - 4], [0, 21400], { extrapolateRight: "clamp" });

  return (
    <Workbench
      label="The happy path"
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
      ancillary={
        <CodeWindow
          title="ReportCard.tsx  (the product)"
          lines={productLines(0)}
          width={layout.ancillary.w}
          height={layout.ancillary.h}
          fontSize={16}
        />
      }
      app={
        <>
          <DemoApp pressedAt={CLICK} spinnerFrom={CLICK + 5} spinnerTo={READY} readyFrom={READY} />
          <Cursor
            visibleFrom={34}
            moves={[
              { ...CURSOR_HOME, at: 36 },
              { ...REPORT_BUTTON_CENTER, at: 66 },
              { ...REPORT_BUTTON_CENTER, at: READY + 3 },
              { ...READY_CENTER, at: READY + 27 },
            ]}
            clicksAt={[CLICK, READY + 33]}
          />
        </>
      }
      terminal={
        <Terminal
          width={layout.terminal.w}
          height={layout.terminal.h}
          stopwatchMs={stopwatchMs}
          stopwatchSpedUp
          lines={[
            { at: 5, type: "cmd", text: "npx playwright test" },
            { at: 28, text: "Running 1 test using 1 worker", color: colors.dim },
            { at: PASS, text: "  ✓  report.spec.ts:3 › generate a report (21.4s)", color: colors.green },
            { at: PASS + 12, text: "  1 passed (21.9s)", color: colors.green, bold: true },
          ]}
        />
      }
    >
      <Annotation at={120} until={READY - 8} x={1100} y={530} width={460} variant="solution" arrow="top" arrowOffset={120}>
        Spinner visible → spinnerWaiter waits patiently (up to 30s). Users see progress too.
      </Annotation>
      <Annotation at={330} x={540} y={690} variant="solution" arrow="right" arrowOffset={42}>
        Aggressively punishes poor UX, but patient when there's affordance in your product.
      </Annotation>
    </Workbench>
  );
};
