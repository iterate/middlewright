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
  create(context) {
    return {
      CallExpression(node) {
        const match = expectLocatorMatcher(node);
        if (!match) return;

        if (match.name === "toContainText") {
          const expectedText = node.arguments[0];
          context.report({
            node,
            messageId: "text",
            fix:
              node.arguments.length === 1
                ? (fixer) =>
                    fixer.replaceText(
                      node,
                      `${context.sourceCode.getText(match.locator)}.filter({ hasText: ${context.sourceCode.getText(expectedText)} }).waitFor()`,
                    )
                : undefined,
          });
          return;
        }

        if (match.name !== "toBeVisible") return;

        context.report({
          node,
          messageId: "visible",
          fix:
            node.arguments.length === 0
              ? (fixer) =>
                  fixer.replaceText(node, `${context.sourceCode.getText(match.locator)}.waitFor()`)
              : undefined,
        });
      },
    };
  },
};

function expectLocatorMatcher(node) {
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

export default {
  meta: { name: "middlewright" },
  rules: {
    "prefer-locator-waits": preferLocatorWaits,
  },
};
