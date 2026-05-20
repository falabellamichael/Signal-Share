// Test script using native fetch

async function testAction(action, preferredSource) {
  console.log(`Sending action: ${action}, preferredSource: ${preferredSource}`);
  try {
    const res = await fetch("http://localhost:3000/api/system-media/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, preferredSource })
    });
    const json = await res.json();
    console.log("Response:", json);
  } catch (err) {
    console.error("Error:", err.message);
  }
}

async function run() {
  // Test play_pause for Spotify
  await testAction("play_pause", "spotify");
  // Test play_pause for YouTube
  await testAction("play_pause", "youtube");
}

run();
