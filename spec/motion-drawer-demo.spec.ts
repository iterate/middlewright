import { expect, test } from "@playwright/test";
import { addPlugins, motionWaiter, videoMode } from "../src/index.ts";

test.use({
  video: "on",
  viewport: { height: 720, width: 480 },
});

// A drawer that slides in over 700ms, stepped by a JS TIMER (the React Native
// web Animated / legacy jQuery shape). The 48ms steps are coarser than the
// display refresh, so plenty of consecutive frame pairs are identical
// mid-slide — which defeats Playwright's own two-frame stability check.

test("control: without motion-waiter the click lands on a still-sliding drawer", async ({
  page: basePage,
}, testInfo) => {
  await using page = await addPlugins({
    page: basePage,
    testInfo,
    // The heading's appearance needs no highlight of its own — footage runs
    // continuously from the click through the app's pressed-flash and fade.
    plugins: [videoMode({ skipMethods: ["waitFor"] })],
  });
  await page.setContent(getDrawerAppHtml());

  await page.videoMode.caption("Open the menu: the drawer starts sliding in", () =>
    page.getByRole("button", { name: "Open menu" }).click(),
  );
  await page.videoMode.caption("Playwright clicks while the drawer is still sliding", () =>
    page.getByRole("button", { name: "Notifications" }).click(),
  );
  // timeout: the app holds a 700ms pressed flash + 200ms fade before navigating — nothing there for a spinner-waiter
  await page.getByRole("heading", { name: "Notifications" }).waitFor({ timeout: 5_000 });
  // Outlast the menu's fade-out so the recording ends on a settled screen.
  // timeout: fade completion, invisible to the spinner-waiter
  await page.locator("#overlay").waitFor({ state: "hidden", timeout: 5_000 });

  // The app records the drawer's translateX at the moment the click landed.
  // Vanilla Playwright clicks while the drawer is still well off to the left —
  // the recording freezes a half-open drawer under the click pointer.
  const drawerXAtClick = await page.evaluate(() => (window as any).__drawerXAtClick);
  console.log(`drawer translateX at click: ${drawerXAtClick}px (drawer is 280px wide)`);
  expect(drawerXAtClick).toBeLessThan(-40);
});

test("opting in for the drawer click waits out the slide", async ({
  page: basePage,
}, testInfo) => {
  await using page = await addPlugins({
    page: basePage,
    testInfo,
    // motionWaiter OUTSIDE videoMode: its settle hold completes before
    // video-mode reads the action timing, so the flagged watchable span (the
    // drawer's slide) renders at full speed instead of compressing away.
    plugins: [motionWaiter(), videoMode({ skipMethods: ["waitFor"] })],
  });
  await page.setContent(getDrawerAppHtml());

  await page.videoMode.caption("Open the menu: the drawer starts sliding in", () =>
    page.getByRole("button", { name: "Open menu" }).click(),
  );
  await page.videoMode.caption("motion-waiter holds the click until the drawer settles", () =>
    motionWaiter.settings.run({ enabled: true }, () =>
      page.getByRole("button", { name: "Notifications" }).click(),
    ),
  );
  // timeout: the app holds a 700ms pressed flash + 200ms fade before navigating — nothing there for a spinner-waiter
  await page.getByRole("heading", { name: "Notifications" }).waitFor({ timeout: 5_000 });
  // Outlast the menu's fade-out so the recording ends on a settled screen.
  // timeout: fade completion, invisible to the spinner-waiter
  await page.locator("#overlay").waitFor({ state: "hidden", timeout: 5_000 });

  // Same app, same clicks — the one opted-in click was held until the slide
  // finished, so it landed on the drawer at rest (translateX ≈ 0).
  const drawerXAtClick = await page.evaluate(() => (window as any).__drawerXAtClick);
  console.log(`drawer translateX at click: ${drawerXAtClick}px (drawer is 280px wide)`);
  expect(drawerXAtClick).toBeGreaterThan(-1);
});

function getDrawerAppHtml() {
  return `
    <!doctype html>
    <html>
      <head>
        <style>
          * { margin: 0; box-sizing: border-box; }
          body { font-family: system-ui, sans-serif; background: #f4f4f5; }
          header { display: flex; align-items: center; gap: 12px; padding: 14px 16px; background: #18181b; color: #fafafa; }
          header button { font-size: 18px; background: none; color: inherit; border: 1px solid #3f3f46; border-radius: 8px; padding: 6px 10px; }
          main { padding: 24px 16px; }
          #overlay {
            position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45);
            opacity: 0; transition: opacity 180ms ease;
          }
          #overlay.open { opacity: 1; }
          #drawer {
            position: fixed; top: 0; bottom: 0; left: 0; width: 280px;
            background: #ffffff; box-shadow: 4px 0 24px rgba(0, 0, 0, 0.25);
            padding: 20px 16px; transform: translateX(-280px);
          }
          #drawer h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; color: #71717a; margin-bottom: 12px; }
          #drawer button {
            display: flex; width: 100%; padding: 13px 12px; margin-bottom: 4px;
            font-size: 16px; text-align: left; background: none; border: none; border-radius: 8px;
          }
          #drawer button:hover { background: #f4f4f5; }
        </style>
      </head>
      <body>
        <header>
          <button aria-label="Open menu">☰</button>
          <strong>Drawer demo</strong>
        </header>
        <main id="screen">
          <h1>Home</h1>
          <p>Open the menu and pick a section.</p>
        </main>
        <div id="overlay" hidden>
          <div id="drawer">
            <h2>Menu</h2>
            <button data-screen="Agents">Agents</button>
            <button data-screen="Notifications">Notifications</button>
            <button data-screen="Settings">Settings</button>
          </div>
        </div>
        <script>
          const overlay = document.getElementById("overlay");
          const drawer = document.getElementById("drawer");
          const DRAWER_WIDTH = 280;
          const SLIDE_MS = 700;
          const STEP_MS = 48; // JS-timer stepping, coarser than the display refresh
          let slideTimer;

          document.querySelector("header button").addEventListener("click", () => {
            overlay.hidden = false;
            requestAnimationFrame(() => overlay.classList.add("open"));
            const startedAt = Date.now();
            slideTimer = setInterval(() => {
              const progress = Math.min((Date.now() - startedAt) / SLIDE_MS, 1);
              const eased = 1 - Math.pow(1 - progress, 3);
              drawer.style.transform = "translateX(" + -DRAWER_WIDTH * (1 - eased) + "px)";
              if (progress >= 1) clearInterval(slideTimer);
            }, STEP_MS);
          });

          for (const item of drawer.querySelectorAll("button[data-screen]")) {
            item.addEventListener("click", () => {
              const transform = new DOMMatrixReadOnly(getComputedStyle(drawer).transform);
              window.__drawerXAtClick = transform.m41;
              // A pressed-item flash before navigating, like a real app. The
              // slide freezes with it — so a mid-slide click visibly strands
              // the drawer part way out.
              clearInterval(slideTimer);
              item.style.background = "#e4e4e7";
              setTimeout(() => {
                // Navigate as the menu starts fading, so the new screen is
                // what the fade reveals.
                document.getElementById("screen").innerHTML =
                  "<h1>" + item.dataset.screen + "</h1><p>The " + item.dataset.screen.toLowerCase() + " screen.</p>";
                overlay.classList.remove("open");
                setTimeout(() => {
                  overlay.hidden = true;
                  drawer.style.transform = "translateX(" + -DRAWER_WIDTH + "px)";
                  item.style.background = "";
                }, 200);
              }, 700);
            });
          }
        </script>
      </body>
    </html>
  `;
}
