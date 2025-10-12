import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();
const app = express();

// Step 1: Redirect user to Spotify login
app.get("/login", (req, res) => {
  const scopes = "user-top-read user-read-currently-playing user-modify-playback-state";
  const authorizeURL = `https://accounts.spotify.com/authorize?client_id=${process.env.SPOTIFY_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&scope=${encodeURIComponent(scopes)}`;
  res.redirect(authorizeURL);
});

// Step 2: Spotify redirects to /callback with ?code=
app.get("/callback", async (req, res) => {
  const code = req.query.code;
  try {
    const tokenResponse = await axios.post(
      "https://accounts.spotify.com/api/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.REDIRECT_URI,
        client_id: process.env.SPOTIFY_CLIENT_ID,
        client_secret: process.env.SPOTIFY_CLIENT_SECRET,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const { access_token } = tokenResponse.data;
    res.json({ access_token }); // copy it for now
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// Step 3: Use the token to fetch top tracks
app.get("/spotify", async (req, res) => {
  const accessToken = req.query.token; // temporary way
  try {
    const response = await axios.get("https://api.spotify.com/v1/me/top/tracks?limit=10", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

app.listen(3000, () => console.log("✅ Server running on 3000"));
