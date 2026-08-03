import { test, type Page } from "@playwright/test";
import { addPlugins, spinnerWaiter, videoMode } from "../src/index.ts";

test.use({ video: "on" });

test("opens a todo and shows its details", async ({ page: basePage }, testInfo) => {
  const todo = {
    body: "Check the demo pacing, trim dead air, and keep every important state readable.",
    id: "review-demo",
    title: "Review the demo recording",
  };
  const db = new TodoDB({
    delays: { getTodoMs: 1400, listTodosMs: 1600 },
    todos: [
      todo,
      {
        body: "Write down the decisions that should survive beyond this release.",
        id: "publish-notes",
        title: "Publish release notes",
      },
      {
        body: "Confirm the slow paths show honest progress instead of appearing stuck.",
        id: "check-loading",
        title: "Check loading states",
      },
    ],
  });
  await db.connect(basePage);
  await using page = await addPlugins({
    page: basePage,
    testInfo,
    plugins: [
      spinnerWaiter(),
      videoMode({
        deadAirThreshold: 300,
        finalHold: 1000,
        trimStart: ["selector", "[data-app-ready]"],
      }),
    ],
  });
  await page.setContent(getAppHtml());

  await page.getByRole("button", { name: todo.title }).click();
  await page.getByText(todo.body, { exact: true }).waitFor();
});

type Todo = {
  body: string;
  id: string;
  title: string;
};

type TodoDBOptions = {
  delays: {
    getTodoMs: number;
    listTodosMs: number;
  };
  todos: Todo[];
};

class TodoDB {
  #delays: TodoDBOptions["delays"];
  #todos: Todo[];

  constructor(options: TodoDBOptions) {
    this.#delays = options.delays;
    this.#todos = options.todos;
  }

  async connect(page: Page) {
    await page.exposeFunction("todoDBList", async () => {
      await wait(this.#delays.listTodosMs);
      return this.#todos.map(({ id, title }) => ({ id, title }));
    });
    await page.exposeFunction("todoDBGet", async (id: string) => {
      await wait(this.#delays.getTodoMs);
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
    <style>
      :root {
        color: #25231f;
        font-family: Inter, ui-sans-serif, system-ui, sans-serif;
        background: #f4f0e8;
      }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; }
      button { font: inherit; }
      .shell { margin: 0 auto; max-width: 980px; padding: 54px 42px; }
      .eyebrow { color: #956d34; font-size: 12px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
      h1 { font-family: Georgia, serif; font-size: 46px; font-weight: 500; letter-spacing: -.03em; margin: 8px 0 12px; }
      .intro { color: #716b61; font-size: 17px; margin: 0 0 34px; }
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
      .spinner {
        animation: spin .8s linear infinite;
        border: 3px solid #d8c9ae;
        border-radius: 50%;
        border-top-color: #9d6f2f;
        height: 22px;
        width: 22px;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      .todo-grid { display: grid; gap: 16px; grid-template-columns: repeat(3, 1fr); }
      .todo-card {
        background: #fff;
        border: 1px solid #ddd5c8;
        border-radius: 18px;
        box-shadow: 0 8px 28px rgb(74 60 39 / 8%);
        cursor: pointer;
        min-height: 180px;
        padding: 22px;
        text-align: left;
      }
      .todo-card::before { color: #b78947; content: "TODO"; font-size: 11px; font-weight: 800; letter-spacing: .14em; }
      .todo-title {
        color: #25231f;
        display: block;
        font-family: Georgia, serif;
        font-size: 24px;
        line-height: 1.18;
        margin: 28px 0 0;
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
      .close {
        background: #25231f;
        border: 0;
        border-radius: 999px;
        color: white;
        cursor: pointer;
        margin-top: 28px;
        padding: 10px 18px;
      }
      .error { background: #fff0ed; border-color: #e4a69a; color: #8d3022; }
      @media (max-width: 760px) { .todo-grid { grid-template-columns: 1fr; } }
    </style>
    <main class="shell" data-app-ready>
      <div class="eyebrow">Monday · Focus list</div>
      <h1>Todo desk</h1>
      <p class="intro">A small place for work worth finishing.</p>
      <div id="todos" class="status" data-spinner="true">
        <span class="spinner" aria-hidden="true"></span>
        <span>Loading todos…</span>
      </div>
    </main>
    <dialog id="todo-dialog">
      <div id="todo-detail"></div>
      <button class="close" type="button">Close</button>
    </dialog>
    <script>
      const todos = document.querySelector("#todos");
      const dialog = document.querySelector("#todo-dialog");
      const detail = document.querySelector("#todo-detail");

      const showError = (error) => {
        todos.className = "status error";
        todos.removeAttribute("data-spinner");
        todos.setAttribute("data-type", "error");
        todos.textContent = error instanceof Error ? error.message : String(error);
      };

      window.todoDBList().then((items) => {
        todos.className = "todo-grid";
        todos.removeAttribute("data-spinner");
        todos.replaceChildren(...items.map((todo) => {
          const card = document.createElement("button");
          const title = document.createElement("span");
          card.className = "todo-card";
          card.type = "button";
          card.dataset.todoId = todo.id;
          title.className = "todo-title";
          title.textContent = todo.title;
          card.append(title);
          return card;
        }));
      }).catch(showError);

      todos.addEventListener("click", (event) => {
        const title = event.target.closest("[data-todo-id]");
        if (!title) return;
        detail.innerHTML = '<div class="status" data-spinner="true"><span class="spinner" aria-hidden="true"></span><span>Loading todo details…</span></div>';
        dialog.showModal();
        window.todoDBGet(title.dataset.todoId).then((todo) => {
          detail.replaceChildren();
          const heading = document.createElement("h2");
          const body = document.createElement("p");
          heading.textContent = todo.title;
          body.textContent = todo.body;
          detail.append(heading, body);
        }).catch((error) => {
          detail.innerHTML = '<div class="status error" data-type="error"></div>';
          detail.firstElementChild.textContent = error instanceof Error ? error.message : String(error);
        });
      });

      dialog.querySelector(".close").addEventListener("click", () => dialog.close());
    </script>
  `;
}
