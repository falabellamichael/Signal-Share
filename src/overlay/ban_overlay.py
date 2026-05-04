import React, { useState } from 'react';
import BanOverlay from './BanOverlay'; // Import the modified class

const App = () => {
  const [userIds, setUserIds] = useState('');
  const [banList, setBanList] = useState([]);
  const banInstance = new BanOverlay(); // Create an instance of the BanOverlay class

  const handleBanClick = () => {
    const ids = userIds.split(',').map(id => id.trim()).filter(id => id);
    if (ids.length === 0) {
      alert('Please enter valid user IDs.');
      return;
    }

    try {
      ids.forEach(id => {
        fetch('/api/ban_user', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ userId: id })
        }).then(response => response.json())
          .then(data => {
            setBanList(prevList => [...prevList, id]);
          }).catch(error => {
            alert('Error banning users: ' + error.message);
          });
      });
      setUserIds('');
    } catch (error) {
      alert('Error banning users: ' + error.message);
    }
  };

  return (
    <div>
      <input
        type="text"
        value={userIds}
        onChange={(e) => setUserIds(e.target.value)}
        placeholder="Enter user IDs separated by commas"
      />
      <button onClick={handleBanClick}>Ban</button>
      <ul>
        {banList.map((id, index) => (
          <li key={index}>{id}</li>
        ))}
      </ul>
    </div>
  );
};

export default App;