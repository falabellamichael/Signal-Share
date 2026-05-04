const express = require('express');
const bodyParser = require('body-parser');

const app = express();
const port = 3000;

// Middleware to parse JSON bodies
app.use(bodyParser.json());

// Dummy data to simulate user database
let users = [
  { id: 'user1', name: 'Alice', isBanned: false },
  { id: 'user2', name: 'Bob', isBanned: false }
];

// Route to ban a user
app.post('/api/users/ban', (req, res) => {
  const { userId } = req.body;

  if (!userId) return res.status(400).json({ error: 'User ID is required' });

  const user = users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  user.isBanned = true;
  res.json({ message: 'User banned successfully', user });
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);z
});