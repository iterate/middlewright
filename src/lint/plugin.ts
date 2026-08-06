const preferLocatorWaits = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Prefer locator-native waits over Playwright expect assertions",
    },
    fixable: "code",
    schema: [],
    messages: {
      visible: "Use locator.waitFor() instead of expect(locator).toBeVisible().",
      text: "Use locator.filter({ hasText }).waitFor() instead of expect(locator).toContainText().",
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

const requireTimeoutComment = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Require explicit timeout options to explain why the timeout is needed",
    },
    schema: [
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
    ],
    messages: {
      unexplained:
        "Usually remove the timeout and add loading UI for spinnerWaiter. If a product or Middlewright limit prevents that, add a nearby // comment matching every required pattern: {{patterns}}. See https://github.com/iterate/middlewright#dont-fix-slow-tests-with-longer-timeouts",
    },
  },
  create(context: any) {
    const lineComments = context.sourceCode
      .getAllComments()
      .filter((comment: any) => comment.type === "Line");
    const requiredPatternSources = context.options[0]?.requiredPatterns || [
      "timeout",
      "spinner.?waiter",
    ];
    const requiredPatterns = requiredPatternSources.map((source: string) => new RegExp(source, "i"));

    return {
      CallExpression(node: any) {
        if (node.callee.type !== "MemberExpression") return;

        for (const argument of node.arguments) {
          if (argument.type !== "ObjectExpression") continue;

          for (const property of argument.properties) {
            if (
              isTimeoutProperty(property) &&
              !hasTimeoutComment(node, property, lineComments, requiredPatterns)
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

function hasTimeoutComment(call: any, property: any, comments: any[], requiredPatterns: RegExp[]) {
  const acceptedLines = new Set([
    call.loc.start.line - 1,
    call.loc.start.line,
    property.loc.start.line - 1,
    property.loc.start.line,
  ]);
  return comments.some(
    (comment) =>
      acceptedLines.has(comment.loc.start.line) &&
      requiredPatterns.every((pattern) => pattern.test(comment.value)),
  );
}

export default {
  meta: { name: "middlewright" },
  rules: {
    "prefer-locator-waits": preferLocatorWaits,
    "require-timeout-comment": requireTimeoutComment,
  },
};
