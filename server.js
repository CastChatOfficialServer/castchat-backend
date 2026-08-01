// ===============================
// SERVER.JS FIRESTORE VERSION
// CASTCHAT 2.0
// ===============================

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');

const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

const admin = require('firebase-admin');

// ===============================
// FIREBASE ADMIN
// ===============================

const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: serviceAccount.project_id
});

const db = admin.firestore();

// ===============================
// EXPRESS
// ===============================

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===============================
// ENV
// ===============================

const PORT = process.env.PORT || 3000;

const SERVER_ROOT =
  process.env.SERVER_ROOT ||
  `http://localhost:${PORT}`;

const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID || '';

const GOOGLE_CLIENT_SECRET =
  process.env.GOOGLE_CLIENT_SECRET || '';

const DISCORD_CLIENT_ID =
  process.env.DISCORD_CLIENT_ID || '1437782395301658744';

const DISCORD_CLIENT_SECRET =
  process.env.DISCORD_CLIENT_SECRET || '';

const JWT_SECRET =
  process.env.JWT_SECRET ||
  'troque_essa_chave';

// ===============================
// MASTER DISCORD
// ===============================

const AC_CLUB_DISCORD_ID =
  '908775623135219734';

// ===============================
// PHONE STORE
// ===============================

const PHONE_CODES = new Map();

// ===============================
// STATIC
// ===============================

app.use(
  '/',
  express.static(
    path.join(__dirname, 'public')
  )
);

// ===============================
// TOKEN
// ===============================

function makeToken(user) {

  const uid =
    user.uid || user.id;

  if (!uid) {
    console.error("ERRO: usuário sem uid/id no makeToken:", user);
  }

  return jwt.sign(
    {
      uid: String(uid),
      id: String(uid),
      role: user.role || "user",
      isACClub: user.isACClub || false
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

}

function decodeToken(token) {

  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }

}

// ===============================
// GERAR UID
// ===============================

async function gerarNovoUID() {

  const ref =
    db.collection('config')
      .doc('contadorIDs');

  const uid =
    await db.runTransaction(
      async (transaction) => {

        const doc =
          await transaction.get(ref);

        let ultimoID = 10000;

        if (doc.exists) {
          ultimoID =
            doc.data().ultimoID || 10000;
        }

        const novoID =
          ultimoID + 1;

        transaction.set(ref, {
          ultimoID: novoID
        });

        return String(novoID);

      }
    );

  return uid;

}

// ===============================
// CRIAR PERFIL
// ===============================

async function criarPerfil({
  uid,
  nickname,
  email,
  avatar,
  provider,
  role,
  isACClub
}) {

  const ref =
    db.collection('usuarios')
      .doc(String(uid));

  const snap =
    await ref.get();

if (snap.exists) {

  const data =
    snap.data() || {};

  await ref.set({
    uid: String(uid)
  }, { merge: true });

  return {
    ...data,
    uid: String(uid)
  };

}

  const perfil = {

    uid: String(uid),

    nickname:
      nickname || `Usuário ${uid}`,

    email: email || '',

    avatar:
      avatar || null,

    provider:
      provider || 'unknown',

    role:
      role || 'user',

    isACClub:
      !!isACClub,

    selos: [],

    bio: '',

    coins: 0,

    diamonds: 0,

    discordOrbs: 0,

    criadoEm: Date.now()

  };

  await ref.set(perfil);

  return perfil;

}

// ===============================
// GOOGLE LOGIN
// ===============================

app.get('/auth/google', (req, res) => {

  const redirect_uri =
    `${SERVER_ROOT}/auth/google/callback`;

  const scope =
    encodeURIComponent(
      'openid email profile'
    );

  const url =
    `https://accounts.google.com/o/oauth2/v2/auth` +
    `?response_type=code` +
    `&client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(redirect_uri)}` +
    `&scope=${scope}` +
    `&prompt=select_account`;

  res.redirect(url);

});

// ===============================
// GOOGLE CALLBACK
// ===============================

app.get(
  '/auth/google/callback',
  async (req, res) => {

    try {

      const code = req.query.code;

      if (!code) {
        return res.sendFile(
          path.join(__dirname, 'auth_error.html')
        );
      }

      const redirect_uri =
        `${SERVER_ROOT}/auth/google/callback`;

      const params =
        new URLSearchParams({

          code,

          client_id:
            GOOGLE_CLIENT_ID,

          client_secret:
            GOOGLE_CLIENT_SECRET,

          redirect_uri,

          grant_type:
            'authorization_code'

        });

      const tokenResp =
        await fetch(
          'https://oauth2.googleapis.com/token',
          {
            method: 'POST',
            body: params
          }
        );

      const tokenJson =
        await tokenResp.json();

      if (!tokenJson.access_token) {

        console.error(tokenJson);

        return res.sendFile(
          path.join(__dirname, 'auth_error.html')
        );

      }

      const profileResp =
        await fetch(
          'https://www.googleapis.com/oauth2/v2/userinfo',
          {
            headers: {
              Authorization:
                `Bearer ${tokenJson.access_token}`
            }
          }
        );

      const profile =
        await profileResp.json();

      const providerKey =
        `google:${profile.id}`;

      const authRef =
        db.collection('authLinks')
          .doc(providerKey);

      const authDoc =
        await authRef.get();

      let uid;

      // ===============================
      // JÁ EXISTE
      // ===============================

      if (authDoc.exists) {

        uid =
          authDoc.data().perfilID;

      }

      // ===============================
      // NOVO USUÁRIO
      // ===============================

      else {

        uid =
          await gerarNovoUID();

        await authRef.set({

          perfilID: uid,

          provider: 'google',

          providerID: profile.id,

          criadoEm: Date.now()

        });

      }

      // ===============================
      // CRIAR PERFIL
      // ===============================

      const perfil =
        await criarPerfil({

          uid,

          nickname:
            profile.name,

          email:
            profile.email,

          avatar:
            profile.picture || null,

          provider:
            'google',

          role:
            'user',

          isACClub:
            false

        });

      const token =
        makeToken({

          uid: perfil.uid,

          role: perfil.role,

          isACClub:
            perfil.isACClub

        });

      res.send(
        generateSuccessPage(token)
      );

    } catch (err) {

  console.error("ERRO GOOGLE:");
  console.error(err);

  res.send(`
    <h1>Erro Discord</h1>
    <pre>${err}</pre>
  `);

}

  }
);

// ===============================
// DISCORD LOGIN
// ===============================

app.get('/auth/discord', (req, res) => {

  const redirect =
    `${SERVER_ROOT}/auth/discord/callback`;

  const scope =
    encodeURIComponent(
      'identify email'
    );

  const url =
    `https://discord.com/api/oauth2/authorize` +
    `?response_type=code` +
    `&client_id=${encodeURIComponent(DISCORD_CLIENT_ID)}` +
    `&scope=${scope}` +
    `&redirect_uri=${encodeURIComponent(redirect)}`;

  res.redirect(url);

});

// ===============================
// DISCORD CALLBACK
// ===============================

app.get(
  '/auth/discord/callback',
  async (req, res) => {

    try {

      const code =
        req.query.code;

      if (!code) {

        return res.sendFile(
          path.join(__dirname, 'auth_error.html')
        );

      }

      const redirect_uri =
        `${SERVER_ROOT}/auth/discord/callback`;

      const params =
        new URLSearchParams({

          client_id:
            DISCORD_CLIENT_ID,

          client_secret:
            DISCORD_CLIENT_SECRET,

          grant_type:
            'authorization_code',

          code,

          redirect_uri

        });

      document.getElementById("discordBtn")
.addEventListener("click", () => {
  window.open(
    "https://castchat-backend.onrender.com/auth/discord",
    "discordLogin",
    "width=500,height=700"
  );
});

      const tokenJson =
        await tokenResp.json();

      if (!tokenJson.access_token) {

        console.error(tokenJson);

        return res.sendFile(
          path.join(__dirname, 'auth_error.html')
        );

      }

      const userResp =
        await fetch(
          'https://castchat-backend.onrender.com/me',
          {
            headers: {
              Authorization:
                `Bearer ${tokenJson.access_token}`
            }
          }
        );

      const profile =
        await userResp.json();

      const providerKey =
        `discord:${profile.id}`;

      const authRef =
        db.collection('authLinks')
          .doc(providerKey);

      const authDoc =
        await authRef.get();

      let uid;

      let role = 'user';

      let isACClub = false;

// ===============================
// MASTER
// ===============================
if (
  profile.id === AC_CLUB_DISCORD_ID
) {

  uid = "10000";
  role = "admin";
  isACClub = true;

  await authRef.set({
    perfilID: uid,
    provider: "discord",
    discordID: profile.id,
    criadoEm: Date.now()
  }, { merge: true });

}

// ===============================
// USUÁRIO EXISTENTE
// ===============================
else if (authDoc.exists) {

  const data = authDoc.data();

  uid = String(data.perfilID);

}

// ===============================
// NOVO USUÁRIO
// ===============================
else {

  uid = await gerarNovoUID();

  await authRef.set({
    perfilID: uid,
    provider: "discord",
    discordID: profile.id,
    criadoEm: Date.now()
  });

}

// ===============================
// VALIDA UID
// ===============================
if (!uid || uid === "undefined") {
  throw new Error("UID não foi definido antes do token");
}

      // ===============================
      // AVATAR
      // ===============================

      let avatar = null;

      if (profile.avatar) {

        avatar =
          `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`;

      }

      // ===============================
      // PERFIL
      // ===============================

      const perfil =
        await criarPerfil({

          uid,

          nickname:
            profile.username,

          email:
            profile.email || '',

          avatar,

          provider:
            'discord',

          role,

          isACClub

        });

      // ===============================
      // TOKEN
      // ===============================
const token =
  makeToken({
    uid: String(uid),
    id: String(uid),
    role: role,
    isACClub: isACClub
  });

      res.send(
        generateSuccessPage(token)
      );

    } catch (err) {

      console.error(err);

      res.sendFile(
        path.join(__dirname, 'auth_error.html')
      );

    }

  }
);

// ===============================
// PHONE SEND
// ===============================

app.post(
  '/auth/phone/send',
  (req, res) => {

    const phone =
      String(req.body.phone || '');

    if (!phone) {

      return res.json({
        ok: false
      });

    }

    const code =
      String(
        Math.floor(
          100000 +
          Math.random() * 900000
        )
      );

    PHONE_CODES.set(phone, {

      code,

      expiresAt:
        Date.now() +
        5 * 60 * 1000

    });

    console.log(
      `Código ${phone}: ${code}`
    );

    res.json({
      ok: true,
      code
    });

  }
);

// ===============================
// PHONE VERIFY
// ===============================

app.post(
  '/auth/phone/verify',
  async (req, res) => {

    try {

      const {
        phone,
        code
      } = req.body;

      const rec =
        PHONE_CODES.get(phone);

      if (!rec) {

        return res.json({
          ok: false
        });

      }

      if (
        Date.now() >
        rec.expiresAt
      ) {

        PHONE_CODES.delete(phone);

        return res.json({
          ok: false
        });

      }

      if (
        rec.code !==
        String(code)
      ) {

        return res.json({
          ok: false
        });

      }

      const providerKey =
        `phone:${phone}`;

      const authRef =
        db.collection('authLinks')
          .doc(providerKey);

      const authDoc =
        await authRef.get();

      let uid;

      if (authDoc.exists) {

        uid =
          authDoc.data().perfilID;

      } else {

        uid =
          await gerarNovoUID();

        await authRef.set({

          perfilID: uid,

          provider: 'phone',

          providerID: phone,

          criadoEm: Date.now()

        });

      }

      const perfil =
        await criarPerfil({

          uid,

          nickname:
            `Usuário ${uid}`,

          provider:
            'phone',

          role:
            'user',

          isACClub:
            false

        });

      PHONE_CODES.delete(phone);

      const token =
        makeToken({

          uid: perfil.uid,

          role: perfil.role,

          isACClub:
            perfil.isACClub

        });

      res.json({
        ok: true,
        token
      });

    } catch (err) {

      console.error(err);

      res.json({
        ok: false
      });

    }

  }
);

// ===============================
// /ME
// ===============================
app.get('/me', (req, res) => {

  const auth =
    req.headers.authorization || "";

  const match =
    auth.match(/^Bearer (.+)$/);

  if (!match) {
    return res.json({
      ok: false,
      error: "Sem token"
    });
  }

  const decoded =
    decodeToken(match[1]);

  if (!decoded) {
    return res.json({
      ok: false,
      error: "Token inválido"
    });
  }

  const uid =
    decoded.uid || decoded.id;

  res.json({
    ok: true,
    user: {
      uid: String(uid),
      id: String(uid),
      role: decoded.role || "user",
      isACClub: decoded.isACClub || false
    }
  });

});

// ===============================
// SUCCESS PAGE
// ===============================

function generateSuccessPage(token) {

  return `
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Autenticado</title>
</head>
<body>

<script>

if (window.opener) {

  window.opener.postMessage(
    {
      type:'auth_success',
      token:${JSON.stringify(token)}
    },
    '*'
  );

}

setTimeout(() => {

  window.close();

}, 600);

</script>

</body>
</html>`;

}

// ===============================
// START
// ===============================

app.listen(PORT, () => {

  console.log('======================');
  console.log('CastChat2.0 ONLINE');
  console.log('======================');

  console.log(
    SERVER_ROOT
  );

});
