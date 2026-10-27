const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
const SESSION_SECRET = process.env.SESSION_SECRET;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

if (!ADMIN_PASSWORD_HASH || !SESSION_SECRET) {
  console.error("Configure ADMIN_PASSWORD_HASH e SESSION_SECRET nas variáveis de ambiente.");
  process.exit(1);
}

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "blacklist.sqlite"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS blacklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

app.disable("x-powered-by");

if (IS_PRODUCTION) app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: IS_PRODUCTION ? [] : null
    }
  }
}));

app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));

app.use(session({
  name: "castchat_admin",
  store: new SQLiteStore({
    db: "sessions.sqlite",
    dir: DATA_DIR
  }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: "strict",
    maxAge: 2 * 60 * 60 * 1000
  }
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: "Muitas tentativas. Aguarde e tente novamente."
  }
});

app.use(express.static(path.join(__dirname, "public"), {
  index: "index.html"
}));

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin === true) {
    return next();
  }

  return res.status(401).json({
    error: "Autorização administrativa necessária."
  });
}

app.get("/api/names", (req, res) => {
  const names = db.prepare(`
    SELECT id, name
    FROM blacklist
    ORDER BY name COLLATE NOCASE ASC
  `).all();

  res.set("Cache-Control", "no-store");

  res.json({
    names,
    isAdmin: req.session?.isAdmin === true
  });
});

app.post("/api/admin/login", loginLimiter, async (req, res) => {
  const password =
    typeof req.body.password === "string"
      ? req.body.password
      : "";

  if (password.length < 1 || password.length > 200) {
    return res.status(400).json({
      error: "Informe a senha."
    });
  }

  const valid = await bcrypt.compare(
    password,
    ADMIN_PASSWORD_HASH
  );

  if (!valid) {
    return res.status(401).json({
      error: "Senha incorreta."
    });
  }

  req.session.regenerate(err => {
    if (err) {
      return res.status(500).json({
        error: "Não foi possível iniciar a sessão."
      });
    }

    req.session.isAdmin = true;

    req.session.save(err2 => {
      if (err2) {
        return res.status(500).json({
          error: "Não foi possível salvar a sessão."
        });
      }

      res.json({ ok: true });
    });
  });
});

app.post("/api/admin/logout", requireAdmin, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("castchat_admin", {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: "strict"
    });

    res.json({ ok: true });
  });
});

app.post("/api/names", requireAdmin, (req, res) => {
  const name =
    typeof req.body.name === "string"
      ? req.body.name.trim()
      : "";

  if (!name || name.length > 80) {
    return res.status(400).json({
      error: "O nome deve ter entre 1 e 80 caracteres."
    });
  }

  const exists = db.prepare(`
    SELECT id
    FROM blacklist
    WHERE name = ? COLLATE NOCASE
  `).get(name);

  if (exists) {
    return res.status(409).json({
      error: "Esse nome já está na lista."
    });
  }

  const result = db.prepare(`
    INSERT INTO blacklist (name)
    VALUES (?)
  `).run(name);

  res.status(201).json({
    id: Number(result.lastInsertRowid),
    name
  });
});

app.delete("/api/names/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(400).json({
      error: "ID inválido."
    });
  }

  const result = db.prepare(`
    DELETE FROM blacklist
    WHERE id = ?
  `).run(id);

  if (!result.changes) {
    return res.status(404).json({
      error: "Nome não encontrado."
    });
  }

  res.json({ ok: true });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`CastChat Black List rodando na porta ${PORT}`);
});
