import React from "react";
import { Composition } from "remotion";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { TitleScene } from "./scenes/Title";
import { SetupScene } from "./scenes/Setup";
import { RunFailSlowScene } from "./scenes/RunFailSlow";
import { SadPathScene } from "./scenes/SadPath";
import { PlugwrightScene } from "./scenes/Plugwright";
import { RunFailFastScene } from "./scenes/RunFailFast";
import { AddSpinnerScene } from "./scenes/AddSpinner";
import { HappyRunScene } from "./scenes/HappyRun";
import { OutroScene } from "./scenes/Outro";

const FPS = 30;
const TRANSITION = 15;

const scenes: Array<[React.FC, number]> = [
  [TitleScene, 100],
  [SetupScene, 220],
  [RunFailSlowScene, 320],
  [SadPathScene, 300],
  [PlugwrightScene, 320],
  [RunFailFastScene, 320],
  [AddSpinnerScene, 160],
  [HappyRunScene, 380],
  [OutroScene, 220],
];

const totalDuration =
  scenes.reduce((sum, [, duration]) => sum + duration, 0) - (scenes.length - 1) * TRANSITION;

const PlugwrightDemo: React.FC = () => (
  <TransitionSeries>
    {scenes.flatMap(([Scene, duration], i) => [
      ...(i > 0
        ? [
            <TransitionSeries.Transition
              key={`transition-${i}`}
              presentation={fade()}
              timing={linearTiming({ durationInFrames: TRANSITION })}
            />,
          ]
        : []),
      <TransitionSeries.Sequence key={`scene-${i}`} durationInFrames={duration}>
        <Scene />
      </TransitionSeries.Sequence>,
    ])}
  </TransitionSeries>
);

export const Root: React.FC = () => (
  <Composition
    id="PlugwrightDemo"
    component={PlugwrightDemo}
    durationInFrames={totalDuration}
    fps={FPS}
    width={1920}
    height={1080}
  />
);
