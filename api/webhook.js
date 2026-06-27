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
    return res.status(200).send('Bot is running');
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
      const referrerId = parts[1] || null; // e.g. /start 123456

      // Check if user already exists
      const { data: existing } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', userId)
        .single();

      if (!existing) {
        // New user — insert into DB
        await supabase.from('users').insert({
          telegram_id: userId,
          username: username,
          points: 0,
          referrer_id: referrerId,
        });

        // Reward the referrer
        if (referrerId) {
          await supabase.rpc('increment_points', {
            user_telegram_id: referrerId,
            amount: 10,
          });
          await sendMessage(chatId, `Welcome! You joined via a referral link. Your referrer earned 10 points!`);
        } else {
          await sendMessage(chatId, `Welcome! Use /referral to get your referral link.`);
        }
      } else {
        await sendMessage(chatId, `Welcome back, ${username}! Use /points to check your balance.`);
      }
    }

    else if (text === '/points') {
      const { data } = await supabase
        .from('users')
        .select('points')
        .eq('telegram_id', userId)
        .single();

      const points = data?.points ?? 0;
      await sendMessage(chatId, `You have ${points} points.`);
    }

    else if (text === '/referral') {
      const botUsername = 'YourBotUsername'; // ← change this
      const link = `https://t.me/${botUsername}?start=${userId}`;
      await sendMessage(chatId, `Your referral link:\n${link}\n\nShare it and earn 10 points per new user!`);
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(200).json({ ok: true }); // Always return 200 to Telegram
  }
}
