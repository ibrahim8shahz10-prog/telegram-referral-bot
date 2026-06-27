import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const BOT_TOKEN = process.env.BOT_TOKEN;

async function sendMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Bot is running ✅');
  }

  try {
    const { message } = req.body;

    if (!message || !message.text) {
      return res.status(200).json({ ok: true });
    }

    const chatId = message.chat.id;
    const text = message.text.trim();
    const userId = message.from.id.toString();
    const username = message.from.username || 'unknown';

    if (text.startsWith('/start')) {
      const parts = text.split(' ');
      const referrerId = parts[1] || null;

      const { data: existing } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', userId)
        .single();

      if (!existing) {
        await supabase.from('users').insert({
          telegram_id: userId,
          username: username,
          points: 0,
          referrer_id: referrerId,
        });

        if (referrerId) {
          await supabase.rpc('increment_points', {
            user_telegram_id: referrerId,
            amount: 10,
          });
          await sendMessage(chatId,
            `👋 Welcome ${username}!\n\nYou joined via a referral link.\n✅ Your referrer just earned 10 points!\n\nUse /points to check your balance.\nUse /referral to get your own link.`
          );
        } else {
          await sendMessage(chatId,
            `👋 Welcome ${username}!\n\nYou are now registered.\n\nUse /referral to get your referral link and earn points!\nUse /points to check your balance.`
          );
        }

      } else {
        await sendMessage(chatId,
          `👋 Welcome back ${username}!\n\nUse /points to check your balance.\nUse /referral to share your link.`
        );
      }
    }

    else if (text === '/points') {
      const { data } = await supabase
        .from('users')
        .select('points')
        .eq('telegram_id', userId)
        .single();

      const points = data?.points ?? 0;
      await sendMessage(chatId, `💰 You have ${points} points.`);
    }

    else if (text === '/referral') {
      const botUsername = 'ReActsHelPer_bot';
      const link = `https://t.me/${botUsername}?start=${userId}`;
      await sendMessage(chatId,
        `🔗 Your referral link:\n\n${link}\n\nShare this link with friends.\nYou earn 10 points for every new user who joins!`
      );
    }

    else if (text.startsWith('/redeem')) {
      const parts = text.split(' ');
      const cost = parseInt(parts[1]);

      if (!cost || isNaN(cost)) {
        await sendMessage(chatId,
          `❌ Usage: /redeem 50\n\nReplace 50 with the number of points to spend.`
        );
      } else {
        const { data } = await supabase
          .from('users')
          .select('points')
          .eq('telegram_id', userId)
          .single();

        const currentPoints = data?.points ?? 0;

        if (currentPoints < cost) {
          await sendMessage(chatId,
            `❌ Not enough points!\n\nYou have ${currentPoints} points but need ${cost} points.`
          );
        } else {
          await supabase.rpc('increment_points', {
            user_telegram_id: userId,
            amount: -cost,
          });
          await sendMessage(chatId,
            `✅ Redeemed ${cost} points!\n\nYour new balance: ${currentPoints - cost} points.`
          );
        }
      }
    }

    else if (text === '/help') {
      await sendMessage(chatId,
        `📖 Commands:\n\n/start — Register\n/points — Check balance\n/referral — Get your link\n/redeem 50 — Spend 50 points\n/help — This menu`
      );
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ ok: true });
  }
}
