import type { BrowserContext } from "@playwright/test";

/**
 * app.middlewright.test shows a Sign in button that opens an auth popup on
 * auth.middlewright.test; approving there posts a message back to the opener,
 * which then shows who signed in. Routed on the context so the popup page is
 * covered too.
 */
const demoStyle = `
  <style>
    body { font-family: system-ui, sans-serif; display: grid; place-items: center; min-height: 90vh; background: #f4f4f5; }
    main { background: white; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); padding: 40px 48px; text-align: center; }
    h1 { font-size: 22px; margin: 0 0 16px; }
    button { font-size: 16px; padding: 10px 24px; border-radius: 8px; border: none; background: #4f46e5; color: white; cursor: pointer; }
    output { display: block; margin-top: 16px; font-size: 16px; color: #16a34a; }
  </style>
`;

export const routeAuthDemoApp = async (context: BrowserContext) => {
  await context.route("https://app.middlewright.test/**", async (route) => {
    await route.fulfill({
      body: `
        ${demoStyle}
        <main>
          <h1>middlewright dashboard</h1>
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
        ${demoStyle}
        <main>
          <h1>Authorize middlewright?</h1>
          <button id="approve">Approve</button>
          <script>
            document.querySelector("#approve").addEventListener("click", () => {
              window.opener.postMessage("approved", "*");
              window.close();
            });
          </script>
        </main>
      `,
      contentType: "text/html",
    });
  });
};
