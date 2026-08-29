import dedent from "dedent";

const requiredPatternsSchema = [
  {
    type: "object",
    properties: {
      requiredPatterns: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
      },
    },
    additionalProperties: false,
  },
];

const preferLocatorWaits = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Prefer locator-native waits over Playwright expect assertions",
    },
    fixable: "code",
    schema: [],
    messages: {
      visible: "Use locator.waitFor() instead of expect(locator).toBeVisible(). That way you'll benefit from spinnerWaiter's automatic loading UI detection.",
      text: "Use locator.filter({ hasText }).waitFor() instead of expect(locator).toContainText(). That way you'll benefit from spinnerWaiter's automatic loading UI detection.",
    },
  },
  create(context: any) {
    return {
      CallExpression(node: any) {
        const match = expectLocatorMatcher(node);
        if (!match) return;
        const locator = locatorReceiver(context, match.locator);

        if (match.name === "toBeVisible") {
          context.report({
            node,
            messageId: "visible",
            fix:
              node.arguments.length === 0
                ? (fixer: any) => fixer.replaceText(node, `${locator}.waitFor()`)
                : undefined,
          });
          return;
        }

        if (match.name === "toContainText") {
          const expectedText = node.arguments[0];
          context.report({
            node,
            messageId: "text",
            fix:
              node.arguments.length === 1 && isFilterText(expectedText)
                ? (fixer: any) =>
                    fixer.replaceText(
                      node,
                      `${locator}.filter({ hasText: ${context.sourceCode.getText(expectedText)} }).waitFor()`,
                    )
                : undefined,
          });
        }
      },
    };
  },
};

const requireTimeoutCommentSchema = [
  {
    type: "object",
    properties: {
      requiredPatterns: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
      },
      /**
       * Allow bare waitForTimeout sleeps. For spec files whose subject IS the
       * recorded footage (video-mode renders), sleeps are the test input —
       * annotating every one would be noise. Everywhere else they need the
       * same justification as explicit timeouts.
       */
      allowSleeps: { type: "boolean" },
    },
    additionalProperties: false,
  },
];

const requireTimeoutComment = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Require explicit timeout options to explain why the timeout is needed",
    },
    schema: requireTimeoutCommentSchema,
    messages: {
      unexplained: dedent`
        Avoid locator timeouts by using spinnerWaiter. Best ways to resolve:
        - If there's already loading UI, just remove the timeout and rely on spinnerWaiter to wait for the loading UI.
        - If there's no loading UI, remove the timeout and add loading UI for spinnerWaiter.
        - If there's a loading UI but it takes even longer than the spinnerWaiter spinner timeout, use \`await spinnerWaiter.settings.run({ spinnerTimeout: 123_456 }, async () => ...)\` or similar to wait even longer for the spinner to complete.
        - If there's loading UI from a part of the code that we don't control (e.g. a library) and it isn't matched by the default spinner selectors, use \`await spinnerWaiter.settings.run({ spinnerSelectors: ["myCustomSpinnerClass"] }, async () => ...)\`.
        - If the wait is really about an ANIMATION (a sliding drawer, a settling panel), don't time it — use \`await motionWaiter.settings.run({ enabled: true }, () => locator.click())\` to wait for the target to stop moving.
        - If it is truly impossible for there to be loading UI, add a nearby // comment matching every required pattern: {{patterns}}.
        - If you're in a block which has done \`await spinnerWaiter.settings.run({ disabled: true }, async () => ...)\`, you should probably *un-disable* for that block and apply the above suggestions to the inner code.

        See https://github.com/iterate/middlewright#dont-fix-slow-tests-with-longer-timeouts for more details.
      `,
      sleep: dedent`
        Avoid waitForTimeout — a sleep waits whether or not the app is ready. Best ways to resolve:
        - Wait for positive UI instead: a locator wait covers readiness, and spinnerWaiter extends it while loading UI shows.
        - If the sleep lets an ANIMATION finish before clicking (a sliding drawer, a settling panel), use \`await motionWaiter.settings.run({ enabled: true }, () => locator.click())\` — it waits for the target to stop moving instead of guessing a duration.
        - If the sleep paces a recording, let video mode pace instead (it holds popup entry and settles the recorder itself); still-needed manual pacing is a library gap worth filing.
        - If it is truly necessary, add a nearby // comment matching every required pattern: {{patterns}}.

        See https://github.com/iterate/middlewright#dont-fix-slow-tests-with-longer-timeouts for more details.
      `,
    },
  },
  create(context: any) {
    const sourceLines = context.sourceCode.getText().split(/\r?\n/);
    const lineComments = context.sourceCode
      .getAllComments()
      .filter((comment: any) => comment.type === "Line");
    const requiredPatternSources = context.options[0]?.requiredPatterns || [
      "timeout",
      "spinner.?waiter",
    ];
    const requiredPatterns = requiredPatternSources.map((source: string) => new RegExp(source, "i"));
    const allowSleeps = context.options[0]?.allowSleeps === true;

    return {
      CallExpression(node: any) {
        if (node.callee.type !== "MemberExpression") return;

        if (
          !allowSleeps &&
          !node.callee.computed &&
          node.callee.property.type === "Identifier" &&
          node.callee.property.name === "waitForTimeout" &&
          !hasNearbyComment(node, node.callee.property, lineComments, requiredPatterns, sourceLines)
        ) {
          context.report({
            node: node.callee.property,
            messageId: "sleep",
            data: { patterns: requiredPatternSources.join(", ") },
          });
        }

        for (const argument of node.arguments) {
          if (argument.type !== "ObjectExpression") continue;

          for (const property of argument.properties) {
            if (
              isTimeoutProperty(property) &&
              !hasNearbyComment(node, property, lineComments, requiredPatterns, sourceLines)
            ) {
              context.report({
                node: property,
                messageId: "unexplained",
                data: { patterns: requiredPatternSources.join(", ") },
              });
            }
          }
        }
      },
    };
  },
};

const preferPositiveWaits = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Prefer waiting for positive UI over element detachment",
    },
    schema: requiredPatternsSchema,
    messages: {
      detached: dedent`
        Wait for positive UI instead of element detachment.
        If there's no positive UI to wait for your first port of call should be to *add* the positive UI to the product.
        If it is truly impossible for there to be a positive UI, then that is quite surprising and you should question that.
        If you have questioned it and it is still impossible, then you should make sure you've first validated that the UI that's becoming detached previously was visible.
        Then explain why it's impossible, and why it's safe to wait for detachment in a nearby // comment matching every required pattern: {{patterns}}.

        See https://github.com/iterate/middlewright#prefer-positive-waits-over-absence for more details.
      `,
    },
  },
  create(context: any) {
    const sourceLines = context.sourceCode.getText().split(/\r?\n/);
    const lineComments = context.sourceCode
      .getAllComments()
      .filter((comment: any) => comment.type === "Line");
    const requiredPatternSources = context.options[0]?.requiredPatterns || ["detached"];
    const requiredPatterns = requiredPatternSources.map((source: string) => new RegExp(source, "i"));

    return {
      CallExpression(node: any) {
        const stateProperty = detachedWaitState(node);
        if (
          stateProperty &&
          !hasNearbyComment(node, stateProperty, lineComments, requiredPatterns, sourceLines)
        ) {
          context.report({
            node: stateProperty,
            messageId: "detached",
            data: { patterns: requiredPatternSources.join(", ") },
          });
        }
      },
    };
  },
};

function expectLocatorMatcher(node: any) {
  if (
    node.parent?.type !== "AwaitExpression" ||
    node.callee.type !== "MemberExpression" ||
    node.callee.computed ||
    node.callee.property.type !== "Identifier" ||
    node.callee.object.type !== "CallExpression" ||
    node.callee.object.callee.type !== "Identifier" ||
    node.callee.object.callee.name !== "expect" ||
    node.callee.object.arguments.length !== 1
  ) {
    return;
  }

  return {
    locator: node.callee.object.arguments[0],
    name: node.callee.property.name,
  };
}

function locatorReceiver(context: any, node: any) {
  const text = context.sourceCode.getText(node);
  return ["CallExpression", "ChainExpression", "Identifier", "MemberExpression"].includes(node.type)
    ? text
    : `(${text})`;
}

function isFilterText(node: any) {
  return (
    node?.type === "TemplateLiteral" ||
    (node?.type === "Literal" && (typeof node.value === "string" || "regex" in node))
  );
}

function isTimeoutProperty(node: any) {
  return (
    node.type === "Property" &&
    !node.computed &&
    ((node.key.type === "Identifier" && node.key.name === "timeout") ||
      (node.key.type === "Literal" && node.key.value === "timeout"))
  );
}

function detachedWaitState(node: any) {
  if (
    node.callee.type !== "MemberExpression" ||
    node.callee.computed ||
    node.callee.property.type !== "Identifier" ||
    node.callee.property.name !== "waitFor"
  ) {
    return;
  }

  for (const argument of node.arguments) {
    if (argument.type !== "ObjectExpression") continue;

    for (const property of argument.properties) {
      if (
        property.type === "Property" &&
        !property.computed &&
        ((property.key.type === "Identifier" && property.key.name === "state") ||
          (property.key.type === "Literal" && property.key.value === "state")) &&
        property.value.type === "Literal" &&
        property.value.value === "detached"
      ) {
        return property;
      }
    }
  }
}

function hasNearbyComment(
  call: any,
  property: any,
  comments: any[],
  requiredPatterns: RegExp[],
  sourceLines: string[],
) {
  const methodLine = call.callee.property.loc.start.line;
  const sameLines = new Set([
    call.loc.start.line,
    methodLine,
    property.loc.start.line,
  ]);
  const previousLines = new Set([...sameLines].map((line) => line - 1));
  return comments.some(
    (comment) =>
      (sameLines.has(comment.loc.start.line) ||
        (previousLines.has(comment.loc.start.line) &&
          sourceLines[comment.loc.start.line - 1]
            .slice(0, comment.loc.start.column)
            .trim() === "")) &&
      requiredPatterns.every((pattern) => pattern.test(comment.value)),
  );
}

export default {
  meta: { name: "middlewright" },
  rules: {
    "prefer-locator-waits": preferLocatorWaits,
    "prefer-positive-waits": preferPositiveWaits,
    "require-timeout-comment": requireTimeoutComment,
  },
};
