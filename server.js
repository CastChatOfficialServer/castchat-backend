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

const fs = require('fs');

const serviceAccountPath = fs.existsSync('/etc/secrets/serviceAccountKey.json')
  ? '/etc/secrets/serviceAccountKey.json'
  : path.join(__dirname, 'serviceAccountKey.json');

const serviceAccount = JSON.parse(
  fs.readFileSync(serviceAccountPath, 'utf8')
);

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

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error(
    'JWT_SECRET não configurado ou muito curto. Configure uma chave segura no Render.'
  );
}

// ===============================
// MASTER DISCORD
// ===============================

const AC_Official_001_DISCORD_ID =
  '908775623135219734';

// ===============================
// CASTCHAT BLACK LIST
// ===============================

app.use(
  '/black-list',
  express.static(
    path.join(__dirname, 'castchat-black-list')
  )
);

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
      isACClub: user.isACClub || false,
      discordID: user.discordID || null
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


// ==========================================
// GOOGLE FIREBASE AUTH - CRIAÇÃO SEGURA
// O servidor controla os vínculos e IDs.
// ==========================================

app.post('/api/auth/google/profile', async (req, res) => {
  try {
    const authorization = req.headers.authorization || '';
    const match = authorization.match(/^Bearer (.+)$/);

    if (!match) {
      return res.status(401).json({
        ok: false,
        error: 'Token Firebase ausente.'
      });
    }

    // Validar o token emitido pelo Firebase Authentication.
    const decoded = await admin.auth().verifyIdToken(match[1]);

    const firebaseUID = String(decoded.uid);
    const provider = decoded.firebase?.sign_in_provider;

    // Impedir que sessões Discord ou outros provedores
    // utilizem esta rota como se fossem Google.
    if (provider !== 'google.com') {
      return res.status(403).json({
        ok: false,
        error: 'Esta rota aceita somente autenticação Google.'
      });
    }

    const email = decoded.email || '';
    const nickname = decoded.name || 'Usuário';
    const avatar = decoded.picture || null;

    const linkRef = db.collection('authLinks').doc(firebaseUID);
    const contadorRef = db.collection('config').doc('contadorIDs');

    const perfilID = await db.runTransaction(async (transaction) => {
      const linkDoc = await transaction.get(linkRef);

      let id;
      let novoVinculo = false;
      let userDoc;
      let rankingDoc;
      let userRef;
      let rankingRef;

      if (linkDoc.exists) {
        const link = linkDoc.data() || {};

        if (
          String(link.firebaseUID || '') !== firebaseUID ||
          link.provider !== 'google' ||
          !link.perfilID
        ) {
          throw new Error('Vínculo Google inválido ou inconsistente.');
        }

        id = String(link.perfilID);

        userRef = db.collection('usuarios').doc(id);
        rankingRef = db.collection('ranking_social').doc(id);

        userDoc = await transaction.get(userRef);
        rankingDoc = await transaction.get(rankingRef);

      } else {
        novoVinculo = true;

        const contadorDoc = await transaction.get(contadorRef);

        let ultimoID = 10000;

        if (contadorDoc.exists) {
          const valor = Number(contadorDoc.data().ultimoID || 10000);

          if (!Number.isSafeInteger(valor) || valor < 10000) {
            throw new Error('Contador de IDs inválido.');
          }

          ultimoID = valor;
        }

        let encontrado = false;

        for (let tentativa = 0; tentativa < 1000; tentativa++) {
          const candidato = String(ultimoID + 1);
          const candidatoRef = db.collection('usuarios').doc(candidato);
          const candidatoDoc = await transaction.get(candidatoRef);

          if (!candidatoDoc.exists) {
            id = candidato;
            userRef = candidatoRef;
            encontrado = true;
            break;
          }

          ultimoID++;
        }

        if (!encontrado) {
          throw new Error('Não foi possível encontrar um ID disponível.');
        }

        rankingRef = db.collection('ranking_social').doc(id);

        userDoc = await transaction.get(userRef);
        rankingDoc = await transaction.get(rankingRef);
      }

      const agora = Date.now();

      if (novoVinculo) {
        transaction.set(contadorRef, {
          ultimoID: Number(id)
        }, { merge: true });

        transaction.create(linkRef, {
          perfilID: id,
          firebaseUID,
          provider: 'google',
          email,
          criadoEm: agora
        });
      }

      if (!userDoc.exists) {
        transaction.set(userRef, {
          uid: id,
          nome: nickname,
          nickname,
          email,
          avatar,
          bio: '',
          moldura: '',
          selos: [],
          coins: 0,
          diamonds: 0,
          discordOrbs: 0,
          seguidores: 0,
          seguindo: 0,
          followersCount: 0,
          followingCount: 0,
          petsAdquiridos: ['2'],
          petsEquipados: [],
          provider: 'google',
          role: 'user',
          isACClub: false,
          criadoEm: agora,
          atualizadoEm: agora
        });
      } else {
        // Não substituir moedas, itens, pets, selos ou outros dados.
        transaction.set(userRef, {
          uid: id,
          email,
          avatar,
          atualizadoEm: agora
        }, { merge: true });
      }

      if (!rankingDoc.exists) {
        transaction.set(rankingRef, {
          curtidas: 0,
          ultimaAtualizacao:
            admin.firestore.FieldValue.serverTimestamp()
        });
      }

      return id;
    });

    return res.json({
      ok: true,
      perfilID: String(perfilID)
    });

  } catch (err) {
    console.error('Erro na autenticação Google segura:', err);

    return res.status(500).json({
      ok: false,
      error: 'Não foi possível finalizar o perfil Google.'
    });
  }
});


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
      
          role: 'user',
      
          isACClub: false
      
        });

      res.send(
        generateSuccessPage(token)
      );

    } catch (err) {

  console.error("ERRO GOOGLE:");
  console.error(err);

  res.sendFile(
  path.join(__dirname, 'auth_error.html')
);
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
  encodeURIComponent('identify email');

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

   const tokenResp =
  await fetch(
    'https://discord.com/api/oauth2/token',
    {
      method: 'POST',
      headers: {
        'Content-Type':
          'application/x-www-form-urlencoded'
      },
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

      const userResp =
        await fetch(
          'https://discord.com/api/users/@me',
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
  profile.id === AC_Official_001_DISCORD_ID
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

      if (profile.id === AC_Official_001_DISCORD_ID) {
  await db.collection("usuarios")
    .doc("10000")
    .set({
      discordID: profile.id,
      role: "admin",
      isACClub: true
    }, { merge: true });
}

// ===============================
// TOKEN
// ===============================
const token = makeToken({
  uid: String(uid),
  id: String(uid),
  role: role,
  isACClub: isACClub,
  discordID: profile.id
});

// Criar a ponte com Firebase Authentication
const firebaseCustomToken =
  await admin.auth().createCustomToken(
    String(uid),
    {
      perfilID: String(uid),
      role: role,
      isACClub: isACClub,
      discordID: String(profile.id)
    }
  );

res.send(
  generateSuccessPage(token, firebaseCustomToken)
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
function generateSuccessPage(token, firebaseCustomToken) {

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
    type: 'auth_success',
    token: ${JSON.stringify(token)},
    firebaseCustomToken: ${JSON.stringify(firebaseCustomToken)}
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
// CASTCHAT STORE
// ===============================
app.use(
  '/castchatstore',
  express.static(
    path.join(__dirname, 'castchatstore')
  )
);

// ==========================================
// CASTCHAT 2.0 - EVENTOS COMPARTILHADOS
// Somente o administrador oficial pode alterar
// ==========================================
const EVENTOS_PERMITIDOS = [
  "evento_boas_vindas",
  "evento_seguidores",
  "evento_namorados",
  "evento_laboratorio",
  "evento_caca_baus",
  "evento_olimpiadas",
  "evento_copa_do_mundo",
  "evento_primavera",
  "evento_desconto",
  "evento_fim_de_ano",
  "evento_halloween",
  "evento_natal",
  "evento_pascoa",
  "evento_aniversário",
  "evento_castChat2.0_Gachapon_Events"
];

app.put("/api/eventos/:key", async (req, res) => {
  try {
    // 1. Validar token
    const authorization = req.headers.authorization || "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";

    const usuario = token ? decodeToken(token) : null;

    if (!usuario) {
      return res.status(401).json({
        ok: false,
        error: "Não autorizado."
      });
    }

    // 2. Validar administrador oficial
    const uid = String(usuario.uid || usuario.id || "");

    if (
      uid !== "10000" ||
      usuario.role !== "admin" ||
      usuario.isACClub !== true ||
      usuario.discordID !== AC_Official_001_DISCORD_ID
    ) {
      return res.status(403).json({
        ok: false,
        error: "Apenas o administrador oficial pode alterar eventos."
      });
    }

    // 3. Validar evento
    const key = req.params.key;

    if (!EVENTOS_PERMITIDOS.includes(key)) {
      return res.status(400).json({
        ok: false,
        error: "Evento inválido."
      });
    }

    // 4. Validar estado
    const ativo = req.body?.ativo;

    if (typeof ativo !== "boolean") {
      return res.status(400).json({
        ok: false,
        error: "Estado do evento inválido."
      });
    }

    // 5. Salvar no Firestore
    await db.collection("configuracoes")
      .doc("eventos")
      .set({
        [key]: ativo,
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
        atualizadoPor: "10000"
      }, {
        merge: true
      });

    return res.json({
      ok: true,
      evento: key,
      ativo: ativo
    });

  } catch (erro) {
    console.error("Erro ao atualizar evento:", erro);

    return res.status(500).json({
      ok: false,
      error: "Erro interno ao atualizar evento."
    });
  }
});

// ===============================
// 1. AUTENTICAÇÃO DOS PARTICIPANTES
// ===============================

async function autenticarParticipante(req, res, next) {

  try {

    const authorization = req.headers.authorization || "";

    if (!authorization.startsWith("Bearer ")) {
      return res.status(401).json({
        sucesso: false,
        erro: "Token de autenticação não informado."
      });
    }

    const token = authorization.slice(7).trim();

    if (!token) {
      return res.status(401).json({
        sucesso: false,
        erro: "Token inválido."
      });
    }

    // Verifica o token diretamente no Firebase
    const decoded = await admin.auth().verifyIdToken(token, true);

    let perfilID = null;
    let provider = null;
    let discordID = null;

    const tipoLogin = decoded.firebase?.sign_in_provider;

    // LOGIN GOOGLE
    if (tipoLogin === "google.com") {

      provider = "google";

      const vinculo = await db
        .collection("authLinks")
        .doc(decoded.uid)
        .get();

      if (!vinculo.exists) {
        return res.status(403).json({
          sucesso: false,
          erro: "Vínculo da conta Google não encontrado."
        });
      }

      const dadosVinculo = vinculo.data();

      if (
        dadosVinculo.provider !== "google" ||
        String(dadosVinculo.firebaseUID) !== String(decoded.uid)
      ) {
        return res.status(403).json({
          sucesso: false,
          erro: "Vínculo da conta Google inválido."
        });
      }

      perfilID = String(dadosVinculo.perfilID);

    }

    // LOGIN DISCORD
    else if (tipoLogin === "custom") {

      provider = "discord";

      perfilID = String(decoded.perfilID || "");
      discordID = String(decoded.discordID || "");

      if (
        !perfilID ||
        !discordID ||
        String(decoded.uid) !== perfilID
      ) {
        return res.status(403).json({
          sucesso: false,
          erro: "Identificação da conta Discord inválida."
        });
      }

      const vinculo = await db
        .collection("authLinks")
        .doc(`discord:${discordID}`)
        .get();

      if (!vinculo.exists) {
        return res.status(403).json({
          sucesso: false,
          erro: "Vínculo da conta Discord não encontrado."
        });
      }

      const dadosVinculo = vinculo.data();

      if (
        dadosVinculo.provider !== "discord" ||
        String(dadosVinculo.perfilID) !== perfilID
      ) {
        return res.status(403).json({
          sucesso: false,
          erro: "Vínculo da conta Discord inválido."
        });
      }

    }

    else {

      return res.status(403).json({
        sucesso: false,
        erro: "Método de autenticação não permitido."
      });

    }

    // Confirma que o perfil existe no CastChat
    if (!/^\d+$/.test(perfilID)) {
      return res.status(403).json({
        sucesso: false,
        erro: "ID de perfil inválido."
      });
    }

    const usuario = await db
      .collection("usuarios")
      .doc(perfilID)
      .get();

    if (!usuario.exists) {
      return res.status(403).json({
        sucesso: false,
        erro: "Perfil CastChat não encontrado."
      });
    }

    
// Verifica se o perfil está suspenso
const moderacaoRef = db
  .collection("moderacao_usuarios")
  .doc(perfilID);

const moderacaoSnap = await moderacaoRef.get();

if (moderacaoSnap.exists) {

  const dadosModeracao = moderacaoSnap.data();

  if (
    dadosModeracao.suspenso === true &&
    dadosModeracao.suspensoAte
  ) {

    const dataFinal = dadosModeracao.suspensoAte.toDate();

    if (dataFinal > new Date()) {

      return res.status(403).json({
        sucesso: false,
        suspenso: true,
        erro: "Sua conta está suspensa por violação das regras do CastChat.",
        suspensoAte: dataFinal.toISOString()
      });

    }

    // A suspensão terminou: libera o acesso
    await moderacaoRef.set({
      suspenso: false,
      atualizadoEm:
        admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

  }

}


    // Identidade autenticada disponível para as próximas etapas
    req.participante = {
      perfilID,
      provider,
      discordID,
      uidFirebase: decoded.uid,
      role: decoded.role || null,
      isACClub: decoded.isACClub === true
    };

    next();

  } catch (erro) {

    console.error(
      "Erro na autenticação do chat privado:",
      erro
    );

    return res.status(401).json({
      sucesso: false,
      erro: "Não foi possível autenticar sua conta."
    });

  }

}


// ===============================
// 2. IDENTIFICAÇÃO DA CONVERSA
// ===============================

function gerarIDConversa(perfilIDA, perfilIDB) {

  const idA = String(perfilIDA || "").trim();
  const idB = String(perfilIDB || "").trim();

  // Verifica se os dois IDs são válidos
  if (
    !/^\d+$/.test(idA) ||
    !/^\d+$/.test(idB)
  ) {
    throw new Error("ID de participante inválido.");
  }

  // Impede uma conversa de um perfil consigo mesmo
  if (idA === idB) {
    throw new Error("Não é possível conversar consigo mesmo.");
  }

  // Ordena os IDs numericamente
  const participantes = [idA, idB].sort(
    (a, b) => Number(a) - Number(b)
  );

  // Gera sempre o mesmo identificador para os dois participantes
  return `${participantes[0]}_${participantes[1]}`;

}


/* ===============================
   3. CRIAR OU RECUPERAR CONVERSA
================================ */

app.post(
  "/api/chat-privado/conversas",
  autenticarParticipante,
  async (req, res) => {

    try {

      const meuID = String(req.participante.perfilID);

      const destinatarioID = String(
        req.body.destinatarioID || ""
      ).trim();

      // Verifica o ID do destinatário
      if (!/^\d+$/.test(destinatarioID)) {
        return res.status(400).json({
          sucesso: false,
          erro: "ID do destinatário inválido."
        });
      }

      // Impede conversar consigo mesmo
      if (meuID === destinatarioID) {
        return res.status(400).json({
          sucesso: false,
          erro: "Você não pode conversar consigo mesmo."
        });
      }

      // Confirma que o destinatário existe
      const destinatario = await db
        .collection("usuarios")
        .doc(destinatarioID)
        .get();

      if (!destinatario.exists) {
        return res.status(404).json({
          sucesso: false,
          erro: "Destinatário não encontrado."
        });
      }

      // Gera o identificador único da conversa
      const conversaID = gerarIDConversa(
        meuID,
        destinatarioID
      );

      const conversaRef = db
        .collection("conversas_privadas")
        .doc(conversaID);

      // Cria ou recupera a conversa de forma segura
      const resultado = await db.runTransaction(
        async (transaction) => {

          const conversa = await transaction.get(conversaRef);

          if (conversa.exists) {

            const dados = conversa.data();

            const participantes = dados.participantes || [];

            // Confirma que os participantes correspondem
            if (
              !participantes.includes(meuID) ||
              !participantes.includes(destinatarioID)
            ) {
              throw new Error(
                "Os participantes da conversa são inválidos."
              );
            }

            return {
              criada: false,
              dados
            };

          }

          const novaConversa = {
            participantes: [
              meuID,
              destinatarioID
            ],

            ultimaMensagem: null,

            criadoEm: admin.firestore.FieldValue.serverTimestamp(),

            atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
          };

          transaction.set(conversaRef, novaConversa);

          return {
            criada: true,
            dados: novaConversa
          };

        }
      );

      return res.status(200).json({
        sucesso: true,
        conversaID,
        criada: resultado.criada,
        mensagem: resultado.criada
          ? "Conversa criada com sucesso."
          : "Conversa recuperada com sucesso."
      });

    } catch (erro) {

      console.error(
        "Erro ao criar ou recuperar conversa:",
        erro
      );

      return res.status(500).json({
        sucesso: false,
        erro: "Não foi possível abrir a conversa."
      });

    }

  }
);


// ===============================
// 4. ENVIAR MENSAGEM
// ===============================

app.post(
  "/api/chat-privado/enviar",
  autenticarParticipante,
  async (req, res) => {

    try {

      const remetenteID = String(
        req.participante.perfilID
      );

      const conversaID = String(
        req.body.conversaID || ""
      ).trim();

      const texto = typeof req.body.texto === "string"
        ? req.body.texto.trim()
        : "";

      // Verifica os dados recebidos
      if (!conversaID || !texto) {
        return res.status(400).json({
          sucesso: false,
          erro: "Informe a conversa e a mensagem."
        });
      }

      if (texto.length > 5000) {
        return res.status(400).json({
          sucesso: false,
          erro: "A mensagem ultrapassou o limite de 5.000 caracteres."
        });
      }

      // Confirma se o ID da conversa é válido
      if (!/^\d+_\d+$/.test(conversaID)) {
        return res.status(400).json({
          sucesso: false,
          erro: "Identificador de conversa inválido."
        });
      }

      // Localiza a conversa
      const conversaRef = db
        .collection("conversas_privadas")
        .doc(conversaID);

      const conversaSnap = await conversaRef.get();

      if (!conversaSnap.exists) {
        return res.status(404).json({
          sucesso: false,
          erro: "Conversa não encontrada."
        });
      }

      const dadosConversa = conversaSnap.data();

      const participantes = dadosConversa.participantes || [];

      // Confirma que o remetente pertence à conversa
      if (!participantes.includes(remetenteID)) {
        return res.status(403).json({
          sucesso: false,
          erro: "Você não participa desta conversa."
        });
      }

      const destinatarioID = participantes.find(
        id => id !== remetenteID
      );

      if (!destinatarioID) {
        return res.status(400).json({
          sucesso: false,
          erro: "Destinatário da conversa inválido."
        });
      }

      // MODERAÇÃO:
      // Esta função será implementada na etapa 6.
      // Ela também cuidará da exceção do perfil oficial 10000.
      const moderacao = await moderarMensagem({
        remetenteID,
        destinatarioID,
        conversaID,
        texto
      });

      // Se a mensagem for proibida, não será entregue nem salva
      if (!moderacao.permitida) {
        return res.status(moderacao.status || 422).json({
          sucesso: false,
          erro: moderacao.mensagem || "Mensagem não permitida.",
          infracoes: moderacao.infracoes || 0,
          suspensoAte: moderacao.suspensoAte || null
        });
      }

      // Cria o documento da mensagem
      const mensagemRef = conversaRef
        .collection("mensagens")
        .doc();

      const agora = admin.firestore.FieldValue.serverTimestamp();

      const novaMensagem = {
        remetenteID,
        destinatarioID,
        texto,
        tipo: "texto",
        criadoEm: agora
      };

      // Salva a mensagem e atualiza a última mensagem
      // em uma única operação
      const batch = db.batch();

      batch.set(mensagemRef, novaMensagem);

      batch.update(conversaRef, {
        ultimaMensagem: {
          remetenteID,
          texto,
          tipo: "texto",
          criadoEm: agora
        },
        atualizadoEm: agora
      });

      await batch.commit();

      return res.status(201).json({
        sucesso: true,
        mensagem: "Mensagem enviada com sucesso.",
        mensagemID: mensagemRef.id
      });

    } catch (erro) {

      console.error(
        "Erro ao enviar mensagem privada:",
        erro
      );

      return res.status(500).json({
        sucesso: false,
        erro: "Não foi possível enviar a mensagem."
      });

    }

  }
);


// ===============================
// 5. CARREGAR HISTÓRICO
// ===============================

app.get(
  "/api/chat-privado/historico/:conversaID",
  autenticarParticipante,
  async (req, res) => {

    try {

      const participanteID = String(
        req.participante.perfilID
      );

      const conversaID = String(
        req.params.conversaID || ""
      );

      // Verifica o identificador da conversa
      if (!/^\d+_\d+$/.test(conversaID)) {
        return res.status(400).json({
          sucesso: false,
          erro: "Identificador de conversa inválido."
        });
      }

      // Localiza a conversa
      const conversaRef = db
        .collection("conversas_privadas")
        .doc(conversaID);

      const conversaSnap = await conversaRef.get();

      if (!conversaSnap.exists) {
        return res.status(404).json({
          sucesso: false,
          erro: "Conversa não encontrada."
        });
      }

      const dadosConversa = conversaSnap.data();

      const participantes = dadosConversa.participantes || [];

      // Somente os participantes podem acessar o histórico
      if (!participantes.includes(participanteID)) {
        return res.status(403).json({
          sucesso: false,
          erro: "Você não tem permissão para acessar esta conversa."
        });
      }

      // Limita a quantidade de mensagens por consulta
      let limite = parseInt(req.query.limite, 10);

      if (!Number.isInteger(limite) || limite < 1) {
        limite = 50;
      }

      limite = Math.min(limite, 100);

      // Consulta as mensagens mais recentes
      let consulta = conversaRef
        .collection("mensagens")
        .orderBy("criadoEm", "desc")
        .limit(limite);

      // Permite carregar mensagens anteriores
      const antesDe = String(req.query.antesDe || "").trim();

      if (antesDe) {

        if (antesDe.length > 150) {
          return res.status(400).json({
            sucesso: false,
            erro: "Referência de paginação inválida."
          });
        }

        const referenciaMensagem = await conversaRef
          .collection("mensagens")
          .doc(antesDe)
          .get();

        if (!referenciaMensagem.exists) {
          return res.status(400).json({
            sucesso: false,
            erro: "Mensagem de referência não encontrada."
          });
        }

        consulta = consulta.startAfter(referenciaMensagem);

      }

      const resultado = await consulta.get();

      const mensagens = resultado.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      return res.status(200).json({
        sucesso: true,
        conversaID,
        mensagens,
        quantidade: mensagens.length,
        proximaPagina: mensagens.length === limite
          ? mensagens[mensagens.length - 1].id
          : null
      });

    } catch (erro) {

      console.error(
        "Erro ao carregar histórico privado:",
        erro
      );

      return res.status(500).json({
        sucesso: false,
        erro: "Não foi possível carregar o histórico."
      });

    }

  }
);


// ===============================
// 6. MODERAÇÃO DE MENSAGENS
// ===============================

// Normaliza o texto para dificultar tentativas
// de burlar o filtro usando símbolos ou acentos.

function normalizarTextoModeracao(texto) {

  return String(texto || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()

    // Substituições comuns de caracteres
    .replace(/@/g, "a")
    .replace(/\$/g, "s")
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")

    // Transforma pontuação e símbolos em espaços
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

}


// Lista de palavras e expressões proibidas
const PALAVRAS_PROIBIDAS = [

  // INGLÊS
  "assholes",
  "bitch",
  "dick",
  "damn",
  "disgrace",
  "fuck",
  "fuck you",
  "fuck you brother",
  "fuck yourself",
  "fucked up",
  "get it in the ass",
  "get it in the ass yours",
  "go fuck yourself",
  "go fucking",
  "monkey",
  "nudes",
  "pussy",
  "send a naked picture of yourself",
  "send a picture of yourself without clothes",
  "send your nudes",
  "shit",
  "son of a bitch",
  "you bunch of shit",
  "fuckcacaralho",

  // PORTUGUÊS
  "babacas",
  "vadia",
  "puta",
  "pau",
  "piroca",
  "caralho",
  "foda se",
  "foder",
  "vai se foder",
  "vai tomar no cu",
  "vai se foder irmao",
  "se fode",
  "seu desgracado",
  "desgracado",
  "desgraca",
  "disgraca",
  "enfia no seu cu",
  "vai se foder sozinho",
  "macaco",
  "buceta",
  "manda uma foto pelada sua",
  "manda uma foto sua sem roupa",
  "manda seus nudes",
  "merda",
  "filho da puta",
  "seus merdas",
  "bct",
  "fds",

  // FRANCÊS
  "connard",
  "connasse",
  "salope",
  "putain",
  "bite",
  "merde",
  "foutre",
  "va te faire foutre",
  "va te faire foutre mon frere",
  "defonce toi",
  "espece de merde",
  "mets le dans ton cul",
  "va te faire voir",
  "singe",
  "chatte",
  "envoie une photo de toi nue",
  "envoie une photo de toi sans vetements",
  "envoie tes nudes",
  "fils de pute",
  "bande de merde",
  "honte",

  // ESPANHOL
  "gilipollas",
  "imbecil",
  "perra",
  "polla",
  "pene",
  "mierda",
  "joder",
  "que te jodan",
  "que te jodan hermano",
  "jodete",
  "estas jodido",
  "metetelo por el culo",
  "vete a la mierda",
  "mono",
  "coño",
  "manda una foto tuya desnuda",
  "manda una foto tuya sin ropa",
  "manda tus nudes",
  "hijo de puta",
  "monton de mierda",
  "carajo"

].map(normalizarTextoModeracao);


// Verifica se o texto contém algum termo proibido
function encontrarTermoProibido(texto) {

  const textoNormalizado = normalizarTextoModeracao(texto);

  if (!textoNormalizado) {
    return null;
  }

  for (const termo of PALAVRAS_PROIBIDAS) {

    // Procura a expressão completa, não apenas
    // uma sequência de letras dentro de outra palavra.
    const expressao = new RegExp(
      `(?:^| )${termo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?= |$)`
    );

    if (expressao.test(textoNormalizado)) {
      return termo;
    }

  }

  return null;

}


// Função principal utilizada pelo Código 4
async function moderarMensagem({
  remetenteID,
  destinatarioID,
  conversaID,
  texto
}) {

  // O perfil oficial 10000 é isento do filtro.
  // A mensagem original será preservada.
  if (String(remetenteID) === "10000") {

    return {
      permitida: true,
      texto,
      isento: true
    };

  }

  // Verifica o conteúdo da mensagem
  const termoEncontrado = encontrarTermoProibido(texto);

  // Mensagem sem termos proibidos
  if (!termoEncontrado) {

    return {
      permitida: true,
      texto,
      isento: false
    };

  }

  // A mensagem foi rejeitada.
  // O registro da infração será implementado no Código 7.
  const resultado = await registrarInfracao({
    perfilID: remetenteID,
    destinatarioID,
    conversaID,
    termoEncontrado,
    textoOriginal: texto
  });

  return {
    permitida: false,
    status: resultado.suspenso ? 403 : 422,
    mensagem: resultado.mensagem ||
      "Sua mensagem foi bloqueada por conter conteúdo proibido.",
    infracoes: resultado.infracoes || 0,
    suspensoAte: resultado.suspensoAte || null
  };

}


// ===============================
// 7. CONTROLE DE INFRAÇÕES
// ===============================

async function registrarInfracao({
  perfilID,
  destinatarioID,
  conversaID,
  termoEncontrado,
  textoOriginal
}) {

  const idUsuario = String(perfilID);

  // O perfil oficial nunca recebe infrações
  if (idUsuario === "10000") {
    return {
      infracoes: 0,
      suspenso: false,
      mensagem: "Perfil oficial isento."
    };
  }

  const usuarioRef = db
    .collection("moderacao_usuarios")
    .doc(idUsuario);

  const infracaoRef = usuarioRef
    .collection("infracoes")
    .doc();

  try {

    // Registra a infração e incrementa a contagem
    // em uma única transação.
    const resultado = await db.runTransaction(
      async (transaction) => {

        const usuarioSnap = await transaction.get(usuarioRef);

        const dados = usuarioSnap.exists
          ? usuarioSnap.data()
          : {};

        const infracoesAnteriores = Number(
          dados.totalInfracoes || 0
        );

        const totalInfracoes = infracoesAnteriores + 1;

        transaction.set(
          usuarioRef,
          {
            perfilID: idUsuario,
            totalInfracoes,
            ultimaInfracaoEm:
              admin.firestore.FieldValue.serverTimestamp(),
            atualizadoEm:
              admin.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );

        transaction.set(infracaoRef, {
          destinatarioID: String(destinatarioID),
          conversaID: String(conversaID),
          termoEncontrado,
          textoOriginal,
          numeroInfracao: totalInfracoes,
          criadoEm:
            admin.firestore.FieldValue.serverTimestamp()
        });

        return {
          infracoes: totalInfracoes
        };

      }
    );

    const total = resultado.infracoes;

    // A terceira infração acionará a suspensão
    // que será implementada no Código 8.
    if (total >= 3) {

      const suspensao = await aplicarSuspensao30Dias(
        idUsuario,
        "Terceira infração nas mensagens privadas."
      );

      return {
        infracoes: total,
        suspenso: true,
        suspensoAte: suspensao.suspensoAte,
        mensagem:
          "Você atingiu três infrações. Sua conta foi suspensa por 30 dias."
      };

    }

    return {
      infracoes: total,
      suspenso: false,
      mensagem: total === 1
        ? "Primeira infração: sua mensagem foi bloqueada. Atenção às regras do CastChat."
        : "Segunda infração: sua mensagem foi bloqueada. Uma nova infração resultará em suspensão."
    };

  } catch (erro) {

    console.error(
      "Erro ao registrar infração:",
      erro
    );

    // Se não for possível registrar a infração,
    // a mensagem não deve ser liberada.
    throw new Error(
      "Não foi possível concluir a verificação de moderação."
    );

  }

}


// ===============================
// 8. SUSPENSÃO DE 30 DIAS
// ===============================

async function aplicarSuspensao30Dias(perfilID, motivo) {

  const idUsuario = String(perfilID);

  // O perfil oficial não pode ser suspenso por este sistema
  if (idUsuario === "10000") {
    return {
      suspenso: false,
      suspensoAte: null
    };
  }

  const usuarioRef = db
    .collection("moderacao_usuarios")
    .doc(idUsuario);

  // Calcula o prazo de 30 dias
  const agora = new Date();

  const dataSuspensao = new Date(
    agora.getTime() + (30 * 24 * 60 * 60 * 1000)
  );

  const suspensoAte = admin.firestore.Timestamp.fromDate(
    dataSuspensao
  );

  // Registra a suspensão no Firestore
  await usuarioRef.set({

    perfilID: idUsuario,

    suspenso: true,

    suspensoEm:
      admin.firestore.FieldValue.serverTimestamp(),

    suspensoAte,

    motivoSuspensao: String(motivo || "Violação das regras."),

    atualizadoEm:
      admin.firestore.FieldValue.serverTimestamp()

  }, { merge: true });

  // Tenta revogar os tokens para encerrar sessões existentes.
  // A suspensão no Firestore continua sendo a proteção principal.
  try {

    const usuario = await db
      .collection("usuarios")
      .doc(idUsuario)
      .get();

    if (usuario.exists) {

      // O UID do Firebase é diferente para Google e Discord.
      // A autenticação já validou esse vínculo anteriormente.
      const authLinks = await db
        .collection("authLinks")
        .get();

      const vinculos = authLinks.docs.filter(doc => {
        const dados = doc.data();
        return String(dados.perfilID) === idUsuario;
      });

      for (const vinculo of vinculos) {

        if (vinculo.id.startsWith("discord:")) {
          continue;
        }

        await admin.auth().revokeRefreshTokens(vinculo.id);

      }

      // No login Discord, o UID Firebase é o próprio perfilID.
      try {
        await admin.auth().revokeRefreshTokens(idUsuario);
      } catch (erroDiscord) {
        console.warn(
          "Não foi possível revogar o token Discord:",
          erroDiscord.message
        );
      }

    }

  } catch (erro) {

    console.error(
      "Aviso ao revogar sessões:",
      erro
    );

  }

  return {
    suspenso: true,
    suspensoAte: dataSuspensao.toISOString()
  };

}


// ===============================
// 9. LISTAGEM DE CONVERSAS
// ===============================

app.get(
  "/api/chat-privado/conversas",
  autenticarParticipante,
  async (req, res) => {

    try {

      const meuID = String(
        req.participante.perfilID
      );

      // Limite de conversas por consulta
      let limite = parseInt(req.query.limite, 10);

      if (!Number.isInteger(limite) || limite < 1) {
        limite = 30;
      }

      limite = Math.min(limite, 50);

      // Busca somente conversas das quais o usuário participa
      let consulta = db
        .collection("conversas_privadas")
        .where("participantes", "array-contains", meuID)
        .orderBy("atualizadoEm", "desc")
        .limit(limite);

      // Paginação para carregar conversas mais antigas
      const antesDe = String(
        req.query.antesDe || ""
      ).trim();

      if (antesDe) {

        if (!/^\d+_\d+$/.test(antesDe)) {
          return res.status(400).json({
            sucesso: false,
            erro: "Referência de paginação inválida."
          });
        }

        const cursorRef = db
          .collection("conversas_privadas")
          .doc(antesDe);

        const cursorSnap = await cursorRef.get();

        if (!cursorSnap.exists) {
          return res.status(400).json({
            sucesso: false,
            erro: "Conversa de referência não encontrada."
          });
        }

        const dadosCursor = cursorSnap.data();

        if (
          !Array.isArray(dadosCursor.participantes) ||
          !dadosCursor.participantes.includes(meuID)
        ) {
          return res.status(403).json({
            sucesso: false,
            erro: "Você não tem acesso a essa conversa."
          });
        }

        consulta = consulta.startAfter(cursorSnap);

      }

      const resultado = await consulta.get();

      // Monta a lista de conversas
      const conversas = await Promise.all(
        resultado.docs.map(async (doc) => {

          const dados = doc.data();

          const participantes = dados.participantes || [];

          const outroParticipante = participantes.find(
            id => String(id) !== meuID
          );

          if (!outroParticipante) {
            return null;
          }

          // Busca os dados públicos do outro participante
          const perfilSnap = await db
            .collection("usuarios")
            .doc(String(outroParticipante))
            .get();

          const perfil = perfilSnap.exists
            ? perfilSnap.data()
            : {};

          return {

            conversaID: doc.id,

            participanteID: String(outroParticipante),

            nome: perfil.nome || perfil.name || "Usuário",

            foto: perfil.foto || perfil.avatar || null,

            ultimaMensagem: dados.ultimaMensagem || null,

            criadoEm: dados.criadoEm || null,

            atualizadoEm: dados.atualizadoEm || null

          };

        })
      );

      // Remove possíveis registros inválidos
      const listaFinal = conversas.filter(Boolean);

      return res.status(200).json({

        sucesso: true,

        conversas: listaFinal,

        quantidade: listaFinal.length,

        proximaPagina: resultado.docs.length === limite
          ? resultado.docs[resultado.docs.length - 1].id
          : null

      });

    } catch (erro) {

      console.error(
        "Erro ao listar conversas privadas:",
        erro
      );

      return res.status(500).json({
        sucesso: false,
        erro: "Não foi possível carregar suas conversas."
      });

    }

  }
);


// ===============================
// START
// ===============================
app.listen(PORT, () => {

  console.log('======================');
  console.log('CastChat2.0 Online');
  console.log('======================');

  console.log(
    SERVER_ROOT
  );

});
