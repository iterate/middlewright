import React from "react";
import { Annotation } from "../components/Annotation";
import { CodeWindow } from "../components/CodeWindow";
import { ConfigChip } from "../components/ConfigChip";
import { DemoApp } from "../components/DemoApp";
import { Terminal } from "../components/Terminal";
import { Workbench } from "../components/Workbench";
import { productLines, specLines } from "../snippets";
import { colors, layout } from "../theme";

export const AddSpinnerScene: React.FC = () => {
  return (
    <Workbench
      label="Do what the error says: add a spinner"
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
          lines={productLines(30)}
          width={layout.ancillary.w}
          height={layout.ancillary.h}
          fontSize={16}
        />
      }
      ancillaryAt={12}
      app={<DemoApp />}
      terminal={
        <Terminal lines={[{ at: 0, type: "cmd", text: "" }]} width={layout.terminal.w} height={layout.terminal.h} />
      }
    >
      <Annotation at={75} x={985} y={720} width={420} variant="solution" arrow="left" arrowOffset={42}>
        Three lines of product code — a loading state your users wanted anyway.
      </Annotation>
    </Workbench>
  );
};
