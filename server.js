const express = require("express");
const axios = require("axios");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
app.use(cors());

const SPOTIFY_TOP_TRACKS_URL = "https://api.spotify.com/v1/me/top/tracks?limit=10";
const SPOTIFY_PLAYER_URL = "https://api.spotify.com/v1/me/player";

let cachedAccessToken = null;
let cachedRefreshToken = null;

// -------------------------------------
// STEP 1: Login → Redirect user to Spotify authorization page
// -------------------------------------
app.get("/login", (req, res) => {
  const scopes = "user-top-read user-read-currently-playing user-modify-playback-state";
  const authorizeURL = `https://accounts.spotify.com/authorize?client_id=${
    process.env.SPOTIFY_CLIENT_ID
  }&response_type=code&redirect_uri=${encodeURIComponent(
    process.env.REDIRECT_URI
  )}&scope=${encodeURIComponent(scopes)}`;
  res.redirect(authorizeURL);
});

// -------------------------------------
// STEP 2: Spotify redirects here with ?code=... after login
// -------------------------------------
app.get("/callback", async (req, res) => {
  try {
    const code = req.query.code;
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

    const { access_token, refresh_token } = tokenResponse.data;

    // Cache the tokens in memory
    cachedAccessToken = access_token;
    cachedRefreshToken = refresh_token;

    console.log("✅ Tokens obtained from Spotify and cached.");

    res.json({
      message: "✅ Tokens obtained successfully.",
      access_token,
      refresh_token,
    });
  } catch (err) {
    console.error("Callback Error:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// -------------------------------------
// STEP 3: Utility function - fetch with auto re-login on token expiry
// -------------------------------------
async function fetchWithSpotifyAuth(url, headers, res) {
  try {
    return await axios.get(url, { headers });
  } catch (error) {
    // If token is expired or invalid → redirect to login
    const status = error.response?.status;
    const spotifyError = error.response?.data?.error;

    if (
      status === 401 || // Unauthorized
      (spotifyError && spotifyError.message && spotifyError.message.toLowerCase().includes("expired"))
    ) {
      console.warn("⚠️ Spotify token expired or invalid → redirecting to /login");
      res.redirect("/login");
      return null;
    }

    throw error; // Other errors → pass through
  }
}

// -------------------------------------
// STEP 4: /spotify route → get top tracks + currently playing
// -------------------------------------
app.get("/spotify", async (req, res) => {
  try {
    if (!cachedAccessToken) {
      console.log("⚠️ No token cached → redirecting to login");
      return res.redirect("/login");
    }

    const headers = { Authorization: `Bearer ${cachedAccessToken}` };

    // 1️⃣ Get top 10 tracks
    const topTracksResponse = await fetchWithSpotifyAuth(SPOTIFY_TOP_TRACKS_URL, headers, res);
    if (!topTracksResponse) return; // redirected already
    const topTracks = topTracksResponse.data.items.map((track) => ({
      id: track.id,
      name: track.name,
      artist: track.artists.map((a) => a.name).join(", "),
      uri: track.uri,
    }));

    // 2️⃣ Get currently playing song
    const playingResponse = await fetchWithSpotifyAuth(
      `${SPOTIFY_PLAYER_URL}/currently-playing`,
      headers,
      res
    );
    if (!playingResponse) return; // redirected already

    const currentlyPlaying = playingResponse.data?.item
      ? {
          name: playingResponse.data.item.name,
          artist: playingResponse.data.item.artists.map((a) => a.name).join(", "),
          uri: playingResponse.data.item.uri,
        }
      : null;

    // 3️⃣ Return combined JSON
    res.json({
      status: "success",
      topTracks,
      currentlyPlaying,
      note: "If token expires, you’ll automatically be redirected to /login.",
    });
  } catch (err) {
    console.error("Error in /spotify:", err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// Endpoint to stop the currently playing song
app.put("/spotify/stop", async (req, res) => {
  try {
    const accessToken = req.query.token;
    await axios.put(SPOTIFY_PLAYER_URL + "/pause", null, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    res.json({ status: "success", message: "Playback stopped." });
  } catch (err) {
    res.status(500).json({
      error: "Failed to stop playback.",
      details: err.message,
    });
  }
});

// Endpoint to start playing a top 10 song
// Example usage: PUT /spotify/play/spotify:track:TRACK_ID_HERE
app.put("/spotify/play/:trackUri", async (req, res) => {
  try {
    const trackUri = decodeURIComponent(req.params.trackUri);
    const accessToken = req.query.token;
    console.log("Playing track URI:", trackUri);

    await axios.put(
      SPOTIFY_PLAYER_URL + "/play",
      { uris: [trackUri] },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.json({ status: "success", message: `Started playing: ${trackUri}` });
  } catch (err) {
    res.status(500).json({
      error: "Failed to start playback.",
      details: err.message,
    });
  }
});

app.listen(process.env.PORT, () => console.log("✅ Server running"));
