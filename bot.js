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
const PROMO_CODE = 'Free22';

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

// --- Serveur HTTP ---
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end("Bot actif");
});
server.listen(8080, () => console.log("🌍 Port 8080"));
