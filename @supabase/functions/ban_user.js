export default async function banUser(req, res) {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  try {
    // Logic to handle user banning using Supabase
    await supabase_client.from('users').update({ is_banned: true }).eq('id', userId);
    return res.status(200).json({ message: `User ${userId} has been banned` });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}