require('dotenv').config();
const { Telegraf } = require('telegraf');
const { MongoClient } = require('mongodb');
const express = require('express');
const http = require('http');

const ADMINS = process.env.ADMINS ? process.env.ADMINS.split(',') : [];
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME;
const COLLECTION_NAME = 'telegram_users';
const VIDEO_URL = process.env.VIDEO_URL;
const PROMO_CODE = 'Free221';

// --- Configuration Express ---
const app = express();
app.get('/', (req, res) => res.send('Bot is running...'));
app.listen(PORT, () => console.log(`✅ Serveur Express lancé sur le port ${PORT}`));

// --- Configuration MongoDB ---
let db;
async function connectDB() {
  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db(DB_NAME);
    console.log('✅ Connecté à MongoDB');
  } catch (error) {
    console.error('Erreur de connexion MongoDB:', error);
    process.exit(1);
  }
}

// --- Configuration du Bot Telegram ---
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN, {
  handlerTimeout: 30000,
  telegram: {
    apiRoot: 'https://api.telegram.org',
    timeout: 30000
  }
});

// --- Fonctions utilitaires ---
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeMarkdown(text) {
  if (!text) return text;
  return text.replace(/[_*[\]()~`>#+\-=|{}.!']/g, '\\$&')
             .replace(/’/g, '\\’');
}

// Bouton unique pour débloquer l'accès dans le DM
function generateDebloquerButton() {
  return {
    inline_keyboard: [
      [
        { text: 'Débloquer Mon accès 💎', url: `https://t.me/${process.env.BOT_USERNAME}?start=debloquer` }
      ]
    ]
  };
}

// Boutons pour les canaux
function generateChannelButtons() {
  return {
    inline_keyboard: [
      [
        { text: 'Canal Officiel 🌟', url: process.env.CHANNEL1_URL },
        { text: 'Groupe VIP 💎', url: process.env.CHANNEL2_URL }
      ],
      [
        { text: 'Canal 3 ✅', url: process.env.CHANNEL3_URL },
        { text: 'Canal 4 📚', url: process.env.CHANNEL4_URL }
      ],
      [
        { text: 'Notre Bot 🤖', url: process.env.BOT_URL },
        { text: 'Canal crash💎', url: process.env.CHANNEL5_URL }
      ]
    ]
  };
}

function isAdmin(userId) {
  return ADMINS.includes(userId.toString());
}

async function saveUserToDB(userData) {
  try {
    const collection = db.collection(COLLECTION_NAME);
    await collection.updateOne(
      { telegram_id: userData.telegram_id },
      { $set: userData },
      { upsert: true }
    );
  } catch (error) {
    console.error('Erreur lors de la sauvegarde en DB:', error);
  }
}

// Envoi du message de bienvenue complet
async function sendFullWelcome(ctx, firstName) {
  const caption = `*${escapeMarkdown(firstName)}*, félicitations \\! Vous êtes sur le point de rejoindre un groupe d\\'élite réservé aux personnes ambitieuses et prêtes à réussir 💎

⚠️ *Action Requise* \\: Confirmez votre présence en rejoignant nos canaux pour finaliser votre adhésion et accéder à notre communauté privée\\.
⏳ Vous avez 10 minutes pour valider votre place exclusive dans le Club des Millionnaires\\.
🚫 Après ce délai, votre demande sera annulée et votre place sera offerte à quelqu\\'un d\\'autre\\.`;

  try {
    await ctx.replyWithVideo(VIDEO_URL, {
      caption,
      parse_mode: 'MarkdownV2',
      reply_markup: generateChannelButtons()
    });
  } catch (error) {
    console.error('Erreur lors de l\'envoi du message de bienvenue complet:', error);
  }
}

// --- Gestion des demandes d'adhésion ---
bot.on('chat_join_request', async (ctx) => {
  const { from: user, chat } = ctx.update.chat_join_request;

  const userData = {
    telegram_id: user.id,
    first_name: user.first_name,
    username: user.username,
    chat_id: chat.id,
    joined_at: new Date(),
    status: 'pending'
  };

  try {
    await saveUserToDB(userData);
    setTimeout(() => sendDmWelcome(user), 5000); // 5 secondes avant DM
    setTimeout(() => handleUserApproval(ctx, user, chat), 600000); // 10 minutes
  } catch (error) {
    console.error('Erreur traitement demande:', error);
  }
});

async function sendDmWelcome(user) {
  const caption = `Salut ${user.first_name} ! 🚀\n\nTon accès VIP est presque prêt...\n\nClique sur le bouton ci-dessous pour finaliser ton adhésion 👇`;

  try {
    await bot.telegram.sendMessage(user.id, caption, {
      reply_markup: generateDebloquerButton()
    });
  } catch (error) {
    if (error.code !== 403) {
      console.error('Erreur envoi DM:', error);
    }
  }
}

async function handleUserApproval(ctx, user, chat) {
  try {
    const collection = db.collection(COLLECTION_NAME);
    const userDoc = await collection.findOne({ telegram_id: user.id });

    if (userDoc && userDoc.status === 'pending') {
      await ctx.approveChatJoinRequest(user.id);
      await collection.updateOne(
        { telegram_id: user.id },
        { $set: { status: 'approved', approved_at: new Date() } }
      );
      console.log(`Utilisateur approuvé : ${user.first_name}`);
    }
  } catch (error) {
    console.error('Erreur approbation:', error);
  }
}

// --- Commandes Bot ---
bot.start(async (ctx) => {
  const [command, parameter] = ctx.message.text.split(' ');

  // Supprimer le message de bienvenue initial si disponible
  if (parameter === 'debloquer') {
    try {
      const userData = await db.collection(COLLECTION_NAME).findOne({ 
        telegram_id: ctx.from.id 
      });

      if (userData?.welcome_message_id) {
        await ctx.telegram.deleteMessage(ctx.from.id, userData.welcome_message_id);
      }
    } catch (error) {
      console.error('Erreur suppression message:', error);
    }
  }

  // Envoyer le message de bienvenue complet avec les boutons
  await sendFullWelcome(ctx, ctx.from.first_name);
});

bot.command('admin', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;

  try {
    const collection = db.collection(COLLECTION_NAME);
    const total = await collection.countDocuments();
    const approved = await collection.countDocuments({ status: 'approved' });
    const pending = await collection.countDocuments({ status: 'pending' });

    const stats = `📊 Statistiques:\nTotal: ${total}\nApprouvés: ${approved}\nEn attente: ${pending}`;
    await ctx.reply(stats);
  } catch (error) {
    console.error('Erreur stats:', error);
    await ctx.reply('❌ Erreur statistiques');
  }
});

// --- Démarrage ---
async function start() {
  await connectDB();
  await bot.launch();
  console.log('🤖 Bot démarré');
}

start();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));









// ... Tout le code existant au-dessus ne change pas

// --- Ajout de la logique ADS dynamique ---

const captionsGameplay = [
  `👀 Ce qu'ils ne veulent pas que tu saches... Ce jeu est en train de changer des vies en silence.\n\n🍏 C’est *Apple of Fortune*, et il suffit de comprendre la logique pour encaisser.\n\n➡️ Crée ton compte ici : [Clique ici](https://bit.ly/3NJ4vy0)`,
  `🧠 Tout le monde pense que c’est de la chance... mais ceux qui testent comprennent vite : *Apple of Fortune*, c’est une stratégie mentale.\n\nPrêt à essayer ? [Créer un compte](https://bit.ly/3NJ4vy0)`,
  `💡 Joue comme un stratège, pas comme un parieur. *Apple of Fortune* récompense ceux qui osent réfléchir.\n\nCommence maintenant : [bit.ly/3NJ4vy0](https://bit.ly/3NJ4vy0)`,
  `😶 On peut regarder les autres réussir… ou simplement prendre 2 min pour s’y mettre aussi.\n\n🍏 Apple of Fortune t’attend ici : [bit.ly/3NJ4vy0](https://bit.ly/3NJ4vy0)`,
  `🚪 Ils ont ouvert la porte, mais peu osent rentrer. Apple of Fortune c’est pour ceux qui *jouent avec la tête*, pas avec la chance.\n\n➡️ Crée ton compte ici : [bit.ly/3NJ4vy0](https://bit.ly/3NJ4vy0)`
];

const captionsCapture = [
  `📸 Ils partagent leur preuve. Apple of Fortune, ce n’est pas que du rêve. C’est une *routine* pour ceux qui s’y mettent sérieusement.\n\n🎯 À toi de jouer : [bit.ly/3NJ4vy0](https://bit.ly/3NJ4vy0)`,
  `🔍 Une capture ne ment pas. Il faut juste OSER tenter une fois. Les résultats parlent d’eux-mêmes.\n\n🎰 Crée ton compte ici : [bit.ly/3NJ4vy0](https://bit.ly/3NJ4vy0)`,
  `🧠 La vraie stratégie, c’est celle qu’on ne crie pas sur tous les toits. Mais tu peux la découvrir en testant maintenant.\n\nApple of Fortune ici ➤ [bit.ly/3NJ4vy0](https://bit.ly/3NJ4vy0)`,
  `📲 Pendant que tu scrolles… d’autres enchaînent les réussites en silence.\n\n🍏 Tente Apple of Fortune maintenant ➤ [bit.ly/3NJ4vy0](https://bit.ly/3NJ4vy0)`,
  `🔐 Ce qui est rentable reste souvent discret. Mais tu viens de trouver la faille.\n\n➡️ Ouvre ton compte ici : [bit.ly/3NJ4vy0](https://bit.ly/3NJ4vy0)`
];

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateRandomAd() {
  const random = Math.random();

  if (random < 0.3) {
    return {
      type: 'video',
      url: 'https://t.me/freesolkah/2',
      caption: `💸 *100$ par jour ?* Facile quand tu sais comment jouer.\n\n🏱 REGARDE le tuto pour créer un compte authentique et profiter des hacks...\n\n🔥 Rejoins aussi notre canal privé ➤ https://t.me/+omaJ1VufdHs1NGZk`,
      parse_mode: 'Markdown',
      buttons: [
        [{ text: '🚀 Créer mon compte', url: 'https://bit.ly/3NJ4vy0' }],
        [{ text: '🔒 Canal VIP', url: 'https://t.me/solkah_bot' }]
      ]
    };
  }

  if (random < 0.65) {
    const videoId = getRandomInt(3, 23);
    const caption = captionsGameplay[getRandomInt(0, captionsGameplay.length - 1)];

    return {
      type: 'video',
      url: `https://t.me/freesolkah/${videoId}`,
      caption,
      parse_mode: 'Markdown',
      buttons: [
        [{ text: '🍏 Jouer maintenant', url: 'https://bit.ly/3NJ4vy0' }],
        [{ text: '📲 Astuces + Bot', url: 'https://t.me/solkah_bot' }]
      ]
    };
  }

  const photoId = getRandomInt(25, 30);
  const caption = captionsCapture[getRandomInt(0, captionsCapture.length - 1)];

  return {
    type: 'photo',
    url: `https://t.me/freesolkah/${photoId}`,
    caption,
    parse_mode: 'Markdown',
    buttons: [
      [{ text: '🎯 Essayer Apple of Fortune', url: 'https://bit.ly/3NJ4vy0' }],
      [{ text: '🎓 Canal stratégique', url: 'https://t.me/solkah_bot' }]
    ]
  };
}

async function envoyerPubPeriodique() {
  const ad = generateRandomAd();
  const users = await db.collection(COLLECTION_NAME).find({ status: 'approved' }).toArray();

  for (const user of users) {
    try {
      if (ad.type === 'video') {
        await bot.telegram.sendVideo(user.telegram_id, ad.url, {
          caption: ad.caption,
          parse_mode: ad.parse_mode,
          reply_markup: { inline_keyboard: ad.buttons }
        });
      } else if (ad.type === 'photo') {
        await bot.telegram.sendPhoto(user.telegram_id, ad.url, {
          caption: ad.caption,
          parse_mode: ad.parse_mode,
          reply_markup: { inline_keyboard: ad.buttons }
        });
      }
      await sleep(100);
    } catch (e) {
      if (e.code !== 403) console.error(`Erreur pub :`, e);
    }
  }

  console.log('✅ Pub dynamique envoyée');
}

// Planification auto + commande test
setInterval(envoyerPubPeriodique, 6 * 60 * 60 * 1000); // toutes les 6 heures

bot.command('test', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await envoyerPubPeriodique();
  await ctx.reply('🚀 Pub envoyée en test.');
});

// --- Serveur HTTP ---
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end("Bot actif");
});
server.listen(8080, () => console.log("🌍 Port 8080"));
