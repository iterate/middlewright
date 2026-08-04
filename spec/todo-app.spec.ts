import { test, type Page } from "@playwright/test";
import { addPlugins, spinnerWaiter, videoMode } from "../src/index.ts";

test.use({
  video: "on",
  viewport: { height: 720, width: 480 },
});

test("creates todos and reviews their details", async ({ page: basePage }, testInfo) => {
  const db = new TodoDB({ password: "hunter2" });
  db.setDelay(5000);
  await db.connect(basePage);
  await using page = await addPlugins({
    page: basePage,
    testInfo,
    plugins: [spinnerWaiter(), videoMode()],
  });
  await page.setContent(getAppHtml());

  page.once("dialog", (dialog) => dialog.accept("hunter2"));
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Todo desk" }).waitFor();

  db.setDelay(700);
  await page.getByLabel("Title").fill("Review the demo recording");
  await page
    .getByLabel("Details")
    .fill("Check the demo pacing, trim dead air, and keep every important state readable.");
  await page.getByRole("button", { name: "Add todo" }).click();
  await page.getByRole("button", { name: "Review the demo recording" }).waitFor();

  db.setDelay(3500);
  await page.getByLabel("Title").fill("Publish release notes");
  await page
    .getByLabel("Details")
    .fill("Write down the decisions that should survive beyond this release.");
  await page.getByRole("button", { name: "Add todo" }).click();
  await page.getByRole("button", { name: "Publish release notes" }).waitFor();

  db.setDelay(1400);
  await page.getByRole("button", { name: "Review the demo recording" }).click();
  await page.getByText("Check the demo pacing").waitFor();
  await page.getByRole("button", { name: "Close" }).click();

  db.setDelay(850);
  await page.getByRole("button", { name: "Publish release notes" }).click();
  await page.getByText("Write down the decisions").waitFor();
  await page.getByRole("button", { name: "Close" }).click();
});

type Todo = {
  body: string;
  id: string;
  title: string;
};

class TodoDB {
  #delayMs = 0;
  #password: string;
  #todos: Todo[];
  #todoSequence: number;

  constructor(options: { password: string }) {
    this.#password = options.password;
    this.#todos = [];
    this.#todoSequence = this.#todos.length;
  }

  setDelay(delayMs: number) {
    this.#delayMs = delayMs;
  }

  async connect(page: Page) {
    await page.exposeFunction("todoDBAuthenticate", async (password: string) => {
      await wait(this.#delayMs);
      if (password !== this.#password) throw new Error("That password is not correct.");
    });
    await page.exposeFunction("todoDBList", async () => {
      await wait(this.#delayMs);
      return this.#todos.map(({ id, title }) => ({ id, title }));
    });
    await page.exposeFunction("todoDBCreate", async (input: Omit<Todo, "id">) => {
      await wait(this.#delayMs);
      this.#todoSequence += 1;
      const todo = { ...input, id: `todo-${this.#todoSequence}` };
      this.#todos.push(todo);
      return { ...todo };
    });
    await page.exposeFunction("todoDBGet", async (id: string) => {
      await wait(this.#delayMs);
      const todo = this.#todos.find((candidate) => candidate.id === id);
      if (!todo) throw new Error(`Todo not found: ${id}`);
      return { ...todo };
    });
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAppHtml() {
  return `
    <!doctype html>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width" />
    <title>Todo desk</title>
    <style>${getStyle()}</style>
    <main class="shell" data-app-ready>
      <section id="login-panel" class="login-panel">
        <div class="eyebrow">Private workspace</div>
        <h1>Welcome back</h1>
        <p class="intro">Sign in to pick up where you left off.</p>
        <button id="sign-in" class="primary" type="button">Sign in</button>
        <div id="login-status"></div>
      </section>
      <section id="todo-app" hidden>
        <div class="eyebrow">Monday · Focus list</div>
        <h1>Todo desk</h1>
        <p class="intro">A small place for work worth finishing.</p>
        <form id="todo-form" class="todo-form">
          <label>
            Title
            <input name="title" autocomplete="off" required />
          </label>
          <label>
            Details
            <textarea name="body" required></textarea>
          </label>
          <button class="primary" type="submit">Add todo</button>
          <div id="create-status" class="create-status" hidden></div>
        </form>
        <div id="todos"></div>
      </section>
    </main>
    <dialog id="todo-dialog">
      <div id="todo-detail"></div>
      <button class="close" type="button">Close</button>
    </dialog>
    <script>(${run.toString()})()</script>
  `;

  function run() {
    const app = window as any;
    const loginPanel = document.querySelector<HTMLElement>("#login-panel")!;
    const loginStatus = document.querySelector<HTMLElement>("#login-status")!;
    const signIn = document.querySelector<HTMLButtonElement>("#sign-in")!;
    const todoApp = document.querySelector<HTMLElement>("#todo-app")!;
    const todoForm = document.querySelector<HTMLFormElement>("#todo-form")!;
    const createStatus = document.querySelector<HTMLElement>("#create-status")!;
    const todos = document.querySelector<HTMLElement>("#todos")!;
    const dialog = document.querySelector<HTMLDialogElement>("#todo-dialog")!;
    const detail = document.querySelector<HTMLElement>("#todo-detail")!;

    const spinner = (label: string) =>
      '<span class="spinner" aria-hidden="true"></span><span>' + label + "</span>";
    const showError = (target: HTMLElement, error: unknown) => {
      target.className = "status error";
      target.removeAttribute("data-spinner");
      target.setAttribute("data-type", "error");
      target.textContent = error instanceof Error ? error.message : String(error);
    };

    const loadTodos = async () => {
      todos.className = "status";
      todos.setAttribute("data-spinner", "true");
      todos.innerHTML = spinner("Loading todos…");
      const items = await app.todoDBList();
      todos.removeAttribute("data-spinner");
      if (items.length === 0) {
        todos.className = "status";
        todos.textContent = "No todos yet";
        return;
      }
      todos.className = "todo-grid";
      todos.replaceChildren(
        ...items.map((todo: any) => {
          const card = document.createElement("button");
          const title = document.createElement("span");
          card.className = "todo-card";
          card.type = "button";
          card.dataset.todoId = todo.id;
          title.className = "todo-title";
          title.textContent = todo.title;
          card.append(title);
          return card;
        }),
      );
    };

    signIn.addEventListener("click", async () => {
      const password = prompt("Enter the password");
      if (password === null) return;
      signIn.disabled = true;
      loginStatus.className = "status compact";
      loginStatus.setAttribute("data-spinner", "true");
      loginStatus.innerHTML = spinner("Signing in…");
      try {
        await app.todoDBAuthenticate(password);
        loginPanel.hidden = true;
        todoApp.hidden = false;
        await loadTodos();
      } catch (error) {
        showError(loginStatus, error);
        signIn.disabled = false;
      }
    });

    todoForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = todoForm.querySelector<HTMLButtonElement>('[type="submit"]')!;
      const input = Object.fromEntries(new FormData(todoForm));
      todoForm.reset();
      submit.disabled = true;
      submit.textContent = "Creating…";
      submit.setAttribute("data-spinner", "true");
      createStatus.hidden = true;
      try {
        await app.todoDBCreate({ body: input.body, title: input.title });
        await loadTodos();
      } catch (error) {
        createStatus.hidden = false;
        showError(createStatus, error);
      } finally {
        submit.disabled = false;
        submit.textContent = "Add todo";
        submit.removeAttribute("data-spinner");
      }
    });

    todos.addEventListener("click", (event) => {
      const title = (event.target as HTMLElement).closest<HTMLElement>("[data-todo-id]");
      if (!title) return;
      detail.innerHTML =
        '<div class="status" data-spinner="true">' +
        spinner("Loading todo details…") +
        "</div>";
      dialog.showModal();
      app
        .todoDBGet(title.dataset.todoId)
        .then((todo: any) => {
          detail.replaceChildren();
          const heading = document.createElement("h2");
          const body = document.createElement("p");
          heading.textContent = todo.title;
          body.textContent = todo.body;
          detail.append(heading, body);
        })
        .catch((error: unknown) => {
          detail.innerHTML = '<div class="status error" data-type="error"></div>';
          showError(detail.firstElementChild as HTMLElement, error);
        });
    });

    dialog.querySelector(".close")!.addEventListener("click", () => dialog.close());
  }

  function getStyle() {
    return `
      :root {
        color: #25231f;
        font-family: Inter, ui-sans-serif, system-ui, sans-serif;
        background: #f4f0e8;
      }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; }
      button, input, textarea { font: inherit; }
      .shell { margin: 0 auto; max-width: 980px; padding: 54px 42px; }
      .eyebrow { color: #956d34; font-size: 12px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
      h1 { font-family: Georgia, serif; font-size: 46px; font-weight: 500; letter-spacing: -.03em; margin: 8px 0 12px; }
      .intro { color: #716b61; font-size: 17px; margin: 0 0 28px; }
      .login-panel { margin: 70px auto 0; max-width: 520px; text-align: center; }
      .login-panel .status { margin-top: 18px; text-align: left; }
      .primary, .close {
        background: #25231f;
        border: 0;
        border-radius: 999px;
        color: white;
        cursor: pointer;
        padding: 11px 20px;
      }
      .primary:disabled { cursor: wait; opacity: .55; }
      .status {
        align-items: center;
        background: #fffaf1;
        border: 1px solid #ded3c0;
        border-radius: 16px;
        color: #625a4f;
        display: flex;
        gap: 12px;
        min-height: 74px;
        padding: 20px 22px;
      }
      .status.compact { min-height: 50px; padding: 12px 16px; }
      .spinner {
        animation: spin .8s linear infinite;
        border: 3px solid #d8c9ae;
        border-radius: 50%;
        border-top-color: #9d6f2f;
        height: 22px;
        width: 22px;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      .todo-form {
        background: #fffaf1;
        border: 1px solid #ded3c0;
        border-radius: 18px;
        display: grid;
        gap: 14px;
        margin-bottom: 20px;
        padding: 18px;
      }
      .todo-form label { color: #625a4f; display: grid; font-size: 12px; font-weight: 800; gap: 7px; letter-spacing: .08em; text-transform: uppercase; }
      .todo-form input, .todo-form textarea {
        background: white;
        border: 1px solid #d7c9b4;
        border-radius: 10px;
        color: #25231f;
        font-size: 15px;
        height: 48px;
        padding: 11px 12px;
        resize: none;
      }
      .todo-form textarea { height: 84px; line-height: 1.45; }
      .todo-form input:focus, .todo-form textarea:focus { border-color: #9d6f2f; outline: 2px solid #ead8ba; }
      .todo-form .primary { justify-self: start; min-width: 108px; }
      .todo-grid { display: grid; gap: 16px; grid-template-columns: repeat(3, 1fr); }
      .todo-card {
        background: #fff;
        border: 1px solid #ddd5c8;
        border-radius: 18px;
        box-shadow: 0 8px 28px rgb(74 60 39 / 8%);
        cursor: pointer;
        min-height: 140px;
        padding: 22px;
        text-align: left;
      }
      .todo-card::before { color: #b78947; content: "TODO"; font-size: 11px; font-weight: 800; letter-spacing: .14em; }
      .todo-title {
        color: #25231f;
        display: block;
        font-family: Georgia, serif;
        font-size: 22px;
        line-height: 1.18;
        margin: 22px 0 0;
        padding: 0;
        text-align: left;
      }
      .todo-card:hover .todo-title { color: #9d6f2f; }
      dialog {
        background: #fffdf8;
        border: 1px solid #d7c9b4;
        border-radius: 22px;
        box-shadow: 0 28px 90px rgb(38 31 21 / 32%);
        color: #25231f;
        max-width: 580px;
        padding: 34px;
        width: calc(100% - 48px);
      }
      dialog::backdrop { background: rgb(39 33 24 / 46%); backdrop-filter: blur(3px); }
      dialog h2 { font-family: Georgia, serif; font-size: 32px; font-weight: 500; margin: 0 0 16px; }
      dialog p { color: #625c53; font-size: 18px; line-height: 1.6; margin: 0; }
      .close { margin-top: 28px; }
      .error { background: #fff0ed; border-color: #e4a69a; color: #8d3022; }
      @media (max-width: 760px) {
        .shell { padding: 24px 28px; }
        h1 { font-size: 38px; margin: 4px 0 6px; }
        .intro { font-size: 15px; margin-bottom: 14px; }
        .login-panel { margin-top: 48px; }
        .todo-form { gap: 8px; margin-bottom: 10px; padding: 12px; }
        .todo-form label { gap: 4px; }
        .todo-form input, .todo-form textarea { height: 40px; padding: 8px 10px; }
        .todo-form textarea { height: 60px; }
        .todo-grid { gap: 8px; grid-template-columns: 1fr; }
        .todo-card {
          align-items: center;
          border-radius: 14px;
          display: grid;
          gap: 10px;
          grid-template-columns: 48px 1fr;
          min-height: 64px;
          padding: 10px 14px;
        }
        .todo-title { font-size: 18px; margin: 0; }
      }
    `;
  }
}
