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
    schema: [],
    messages: {
      unexplained: "Add a nearby // comment explaining why this timeout is needed.",
    },
  },
  create(context: any) {
    const timeoutComments = context.sourceCode
      .getAllComments()
      .filter((comment: any) => comment.type === "Line" && /\btimeout\b/i.test(comment.value));

    return {
      CallExpression(node: any) {
        if (node.callee.type !== "MemberExpression") return;

        for (const argument of node.arguments) {
          if (argument.type !== "ObjectExpression") continue;

          for (const property of argument.properties) {
            if (isTimeoutProperty(property) && !hasTimeoutComment(node, property, timeoutComments)) {
              context.report({ node: property, messageId: "unexplained" });
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

function hasTimeoutComment(call: any, property: any, comments: any[]) {
  const acceptedLines = new Set([
    call.loc.start.line - 1,
    call.loc.start.line,
    property.loc.start.line - 1,
    property.loc.start.line,
  ]);
  return comments.some((comment) => acceptedLines.has(comment.loc.start.line));
}

export default {
  meta: { name: "middlewright" },
  rules: {
    "prefer-locator-waits": preferLocatorWaits,
    "require-timeout-comment": requireTimeoutComment,
  },
};
