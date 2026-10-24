
```javascript
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const admin = require("firebase-admin");
const { AccessToken } = require("livekit-server-sdk");

const app = express();

/* ========================================
   CONFIGURAÇÕES
======================================== */

const PORT = process.env.PORT || 3000;

const LIVEKIT_URL = process.env.LIVEKIT_URL;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;

const JWT_SECRET = process.env.JWT_SECRET;

/* ========================================
   MIDDLEWARES
======================================== */

app.use(cors());
app.use(express.json());

/* ========================================
   FIREBASE ADMIN
======================================== */

if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  throw new Error(
    "FIREBASE_SERVICE_ACCOUNT_JSON não configurado."
  );
}

const serviceAccount = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON
);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

/* ========================================
   VERIFICAR CONFIGURAÇÕES
======================================== */

if (!LIVEKIT_URL) {
  throw new Error("LIVEKIT_URL não configurado.");
}

if (!LIVEKIT_API_KEY) {
  throw new Error("LIVEKIT_API_KEY não configurado.");
}

if (!LIVEKIT_API_SECRET) {
  throw new Error("LIVEKIT_API_SECRET não configurado.");
}

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET não configurado.");
}

/* ========================================
   ROTA DE TESTE
======================================== */

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "CastChat LiveKit API",
    status: "online"
  });
});

/* ========================================
   AUTENTICAÇÃO CASTCHAT
======================================== */

function autenticarCastChat(req, res, next) {
  try {
    const authorization =
      req.headers.authorization || "";

    if (!authorization.startsWith("Bearer ")) {
      return res.status(401).json({
        ok: false,
        error: "Token CastChat ausente."
      });
    }

    const token = authorization.substring(7);

    const decoded = jwt.verify(
      token,
      JWT_SECRET
    );

    const perfilID = String(
      decoded.uid || decoded.id || ""
    ).trim();

    if (!perfilID) {
      return res.status(401).json({
        ok: false,
        error: "Token sem UID ou ID do perfil."
      });
    }

    req.castchatUser = {
      ...decoded,
      perfilID
    };

    next();

  } catch (error) {
    console.error(
      "Erro de autenticação CastChat:",
      error.message
    );

    return res.status(401).json({
      ok: false,
      error: "Token CastChat inválido ou expirado."
    });
  }
}

/* ========================================
   OBTER NOME DO PARTICIPANTE
======================================== */

async function obterNomeParticipante(perfilID, decoded) {
  const nomeDoToken =
    decoded.name ||
    decoded.nome ||
    decoded.username ||
    decoded.displayName;

  if (nomeDoToken) {
    return String(nomeDoToken);
  }

  try {
    const perfilDoc = await db
      .collection("usuarios")
      .doc(String(perfilID))
      .get();

    if (perfilDoc.exists) {
      const perfil = perfilDoc.data();

      const nome =
        perfil.nome ||
        perfil.name ||
        perfil.username ||
        perfil.displayName;

      if (nome) {
        return String(nome);
      }
    }

  } catch (error) {
    console.error(
      "Erro ao buscar nome do participante:",
      error.message
    );
  }

  return "Usuário " + perfilID;
}

/* ========================================
   GERAR TOKEN LIVEKIT
======================================== */

app.post(
  "/token",
  autenticarCastChat,
  async (req, res) => {

    try {
      const perfilID =
        req.castchatUser.perfilID;

      const liveId =
        String(req.body.liveId || "").trim();

      if (!liveId) {
        return res.status(400).json({
          ok: false,
          error: "liveId obrigatório."
        });
      }

      /* ========================================
         BUSCAR LIVE NO FIRESTORE
      ======================================== */

      const liveRef = db
        .collection("lives")
        .doc(liveId);

      const liveDoc = await liveRef.get();

      if (!liveDoc.exists) {
        return res.status(404).json({
          ok: false,
          error: "Live não encontrada."
        });
      }

      const live = liveDoc.data();

      if (live.ativa !== true) {
        return res.status(403).json({
          ok: false,
          error: "Esta live não está ativa."
        });
      }

      /* ========================================
         IDENTIFICAR HOST
      ======================================== */

      const hostUid =
        String(live.hostUid || "");

      const isHost =
        perfilID === hostUid;

      /* ========================================
         CONFIGURAR SALA LIVEKIT
      ======================================== */

      const roomName =
        String(live.roomName || liveId);

      const participantName =
        await obterNomeParticipante(
          perfilID,
          req.castchatUser
        );

      /* ========================================
         GERAR TOKEN
      ======================================== */

      const accessToken = new AccessToken(
        LIVEKIT_API_KEY,
        LIVEKIT_API_SECRET,
        {
          identity: perfilID,
          name: participantName,
          ttl: "2h"
        }
      );

      accessToken.addGrant({
        roomJoin: true,
        room: roomName,

        // Somente o host publica áudio e vídeo.
        canPublish: isHost,

        // Host e espectadores podem receber mídia.
        canSubscribe: true,

        // Somente o host pode publicar dados.
        canPublishData: isHost
      });

      const token =
        await accessToken.toJwt();

      /* ========================================
         RESPOSTA
      ======================================== */

      return res.json({
        ok: true,

        token,

        serverUrl: LIVEKIT_URL,

        roomName,

        perfilID,

        role: isHost
          ? "host"
          : "viewer"
      });

    } catch (error) {
      console.error(
        "Erro ao gerar token LiveKit:",
        error
      );

      return res.status(500).json({
        ok: false,
        error: "Não foi possível gerar o token."
      });
    }
  }
);

/* ========================================
   INICIAR SERVIDOR
======================================== */

app.listen(PORT, () => {
  console.log("CastChat LiveKit API online na porta " + PORT);
});
});
```
