import type { BrowserContext } from "@playwright/test";

/**
 * app.middlewright.test shows a Sign in button that opens an auth popup on
 * auth.middlewright.test; approving there posts a message back to the opener,
 * which then shows who signed in. Routed on the context so the popup page is
 * covered too.
 */
export const routeAuthDemoApp = async (context: BrowserContext) => {
  await context.route("https://app.middlewright.test/**", async (route) => {
    await route.fulfill({
      body: `
        <main>
          <button id="signin">Sign in</button>
          <output></output>
          <script>
            document.querySelector("#signin").addEventListener("click", () => {
              window.open("https://auth.middlewright.test/authorize");
            });
            window.addEventListener("message", (event) => {
              if (event.data === "approved") {
                document.querySelector("output").textContent = "Signed in as mmkal";
              }
            });
          </script>
        </main>
      `,
      contentType: "text/html",
    });
  });
  await context.route("https://auth.middlewright.test/**", async (route) => {
    await route.fulfill({
      body: `
        <main>
          <h1>Authorize middlewright?</h1>
          <button id="approve">Approve</button>
          <script>
            document.querySelector("#approve").addEventListener("click", () => {
              window.opener.postMessage("approved", "*");
            });
          </script>
        </main>
      `,
      contentType: "text/html",
    });
  });
};
