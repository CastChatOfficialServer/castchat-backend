const $ = id => document.getElementById(id);

let isAdmin = false;

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Ocorreu um erro.");
  }

  return data;
}

function setMessage(id, message) {
  $(id).textContent = message || "";
}

function renderNames(names) {
  const list = $("userList");
  list.replaceChildren();

  $("count").textContent =
    `${names.length} ${names.length === 1 ? "nome" : "nomes"}`;

  if (!names.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Nenhum nome adicionado à lista.";
    list.appendChild(empty);
    return;
  }

  for (const entry of names) {
    const row = document.createElement("div");
    row.className = "user";

    const label = document.createElement("span");
    label.className = "name";
    label.textContent = entry.name;

    row.appendChild(label);

    if (isAdmin) {
      const remove = document.createElement("button");

      remove.className = "remove";
      remove.type = "button";
      remove.textContent = "Remover";

      remove.addEventListener("click", async () => {
        if (!confirm(`Remover "${entry.name}" da lista?`)) {
          return;
        }

        try {
          await api(`/api/names/${entry.id}`, {
            method: "DELETE"
          });

          await refresh();
        } catch (error) {
          alert(error.message);
        }
      });

      row.appendChild(remove);
    }

    list.appendChild(row);
  }
}

async function refresh() {
  try {
    const data = await api("/api/names");

    isAdmin = data.isAdmin === true;

    $("loginPanel").classList.add("hidden");
    $("adminPanel").classList.toggle("hidden", !isAdmin);

    $("adminToggle").textContent =
      isAdmin ? "Modo Admin ativo" : "Admin Mode";

    renderNames(data.names);
  } catch {
    $("count").textContent = "Não foi possível carregar a lista.";
    $("userList").textContent =
      "Verifique a conexão e tente novamente.";
  }
}

$("adminToggle").addEventListener("click", () => {
  if (isAdmin) {
    $("adminPanel").classList.toggle("hidden");
    return;
  }

  $("loginPanel").classList.toggle("hidden");

  if (!$("loginPanel").classList.contains("hidden")) {
    $("adminPassword").focus();
  }
});

$("loginForm").addEventListener("submit", async event => {
  event.preventDefault();

  setMessage("loginMessage", "");

  try {
    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({
        password: $("adminPassword").value
      })
    });

    $("adminPassword").value = "";
    setMessage("loginMessage", "");

    await refresh();
  } catch (error) {
    setMessage("loginMessage", error.message);
  }
});

$("logoutButton").addEventListener("click", async () => {
  try {
    await api("/api/admin/logout", {
      method: "POST",
      body: "{}"
    });

    isAdmin = false;
    await refresh();
  } catch (error) {
    alert(error.message);
  }
});

$("addForm").addEventListener("submit", async event => {
  event.preventDefault();

  setMessage("addMessage", "");

  const name = $("username").value.trim();

  if (!name) return;

  try {
    await api("/api/names", {
      method: "POST",
      body: JSON.stringify({ name })
    });

    $("username").value = "";
    setMessage("addMessage", "Nome adicionado.");

    await refresh();
    $("username").focus();
  } catch (error) {
    setMessage("addMessage", error.message);
  }
});

refresh();
