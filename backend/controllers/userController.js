const users = [
  { id: 'user1', name: 'Alice', isBanned: false },
  { id: 'user2', name: 'Bob', isBanned: false }
];

exports.banUser = (req, res) => {
  const { userId } = req.body;

  if (!userId) return res.status(400).json({ error: 'User ID is required' });

  const user = users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  user.isBanned = true;
  res.json({ message: 'User banned successfully', user });
};