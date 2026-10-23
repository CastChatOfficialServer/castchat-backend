```javascript
require("dotenv").config();

const express = require("express");
const cors = require("cors");

const admin = require("firebase-admin");
const { AccessToken } = require("livekit-server-sdk");

const app = express();

app.use(cors());
app.use(express.json());

/* ========================================
   CONFIGURAÇÕES
======================================== */

const PORT = process.env.PORT || 3000;

const LIVEKIT_URL = process.env.LIVEKIT_URL;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;

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
   AUTENTICAÇÃO FIREBASE
======================================== */

async function autenticarFirebase(req, res, next) {
  try {
    const authorization =
      req.headers.authorization || "";

    if (!authorization.startsWith("Bearer ")) {
      return res.status(401).json({
        ok: false,
        error: "Token Firebase ausente."
      });
    }

    const token = authorization.substring(7);

    const decoded =
      await admin.auth().verifyIdToken(token);

    req.firebaseUser = decoded;

    next();

  } catch (error) {
    console.error("Erro de autenticação:", error.message);

    return res.status(401).json({
      ok: false,
      error: "Token Firebase inválido."
    });
  }
}

/* ========================================
   OBTER PERFIL DO CASTCHAT
======================================== */

async function obterPerfilID(firebaseUID) {
  const linkRef = db
    .collection("authLinks")
    .doc(String(firebaseUID));

  const linkDoc = await linkRef.get();

  if (!linkDoc.exists) {
    throw new Error(
      "Este usuário ainda não possui perfil vinculado."
    );
  }

  const perfilID =
    linkDoc.data().perfilID;

  if (!perfilID) {
    throw new Error(
      "O vínculo Firebase não possui perfilID."
    );
  }

  return String(perfilID);
}

/* ========================================
   GERAR TOKEN LIVEKIT
======================================== */

app.post(
  "/token",
  autenticarFirebase,
  async (req, res) => {

    try {
      const firebaseUID =
        req.firebaseUser.uid;

      const liveId =
        String(req.body.liveId || "").trim();

      if (!liveId) {
        return res.status(400).json({
          ok: false,
          error: "liveId obrigatório."
        });
      }

      // Descobrir o perfil do usuário.
      const perfilID =
        await obterPerfilID(firebaseUID);

      // Buscar a live no Firestore.
      const liveRef =
        db.collection("lives").doc(liveId);

      const liveDoc =
        await liveRef.get();

      if (!liveDoc.exists) {
        return res.status(404).json({
          ok: false,
          error: "Live não encontrada."
        });
      }

      const live =
        liveDoc.data();

      if (live.ativa !== true) {
        return res.status(403).json({
          ok: false,
          error: "Esta live não está ativa."
        });
      }

      // O roomName será definido na criação da live.
      // Se ainda não existir, usamos o próprio ID.
      const roomName =
        String(live.roomName || liveId);

      // Conferir se o usuário é o dono da transmissão.
      const hostUid =
        String(live.hostUid || "");

      const isHost =
        perfilID === hostUid;

      // Espectadores podem apenas receber mídia.
      // O streamer pode publicar áudio e vídeo.
      const participantName =
        String(
          req.firebaseUser.name ||
          `Usuário ${perfilID}`
        );

      const accessToken =
        new AccessToken(
          LIVEKIT_API_KEY,
          LIVEKIT_API_SECRET,
          {
            identity: String(firebaseUID),
            name: participantName,
            ttl: "2h"
          }
        );

      accessToken.addGrant({
        roomJoin: true,
        room: roomName,

        canPublish: isHost,

        canSubscribe: true,

        canPublishData: isHost
      });

      const token =
        await accessToken.toJwt();

      return res.json({
        ok: true,

        token: token,

        serverUrl: LIVEKIT_URL,

        roomName: roomName,

        perfilID: perfilID,

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
  console.log(
    `CastChat LiveKit API online na porta ${PORT}`
  );
});
```
