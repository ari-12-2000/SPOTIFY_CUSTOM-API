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
// STEP 3: Refresh token logic
// -------------------------------------
async function refreshAccessToken() {
  if (!cachedRefreshToken) {
    console.log("⚠️ No refresh token available → must re-login");
    return null;
  }

  try {
    console.log("🔁 Refreshing Spotify access token...");
    const refreshResponse = await axios.post(
      "https://accounts.spotify.com/api/token",
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: cachedRefreshToken,
        client_id: process.env.SPOTIFY_CLIENT_ID,
        client_secret: process.env.SPOTIFY_CLIENT_SECRET,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    cachedAccessToken = refreshResponse.data.access_token;
    console.log("✅ Access token refreshed successfully.");
    return cachedAccessToken;
  } catch (err) {
    console.error("❌ Failed to refresh token:", err.response?.data || err.message);
    return null;
  }
}

// -------------------------------------
// STEP 4: Utility function to fetch with retry
// -------------------------------------
async function fetchWithSpotifyAuth(url, headers, res) {
  try {
    return await axios.get(url, { headers });
  } catch (error) {
    const status = error.response?.status;
    const spotifyError = error.response?.data?.error;

    // Check if the token is expired or invalid
    if (
      status === 401 ||
      (spotifyError &&
        spotifyError.message &&
        spotifyError.message.toLowerCase().includes("expired"))
    ) {
      console.warn("⚠️ Spotify token expired, attempting refresh...");

      // Try refresh first
      const newAccessToken = await refreshAccessToken();

      if (newAccessToken) {
        console.log("✅ Retrying Spotify request with new token...");
        const retryHeaders = { Authorization: `Bearer ${newAccessToken}` };
        return await axios.get(url, { headers: retryHeaders });
      }

      // Refresh failed → redirect to login
      console.warn("⚠️ Refresh failed → redirecting user to /login");
      res.redirect("/login");
      return null;
    }

    throw error;
  }
}

// -------------------------------------
// STEP 5: /spotify route → get top tracks + currently playing
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
      { Authorization: `Bearer ${cachedAccessToken}` },
      res
    );
    if (!playingResponse) return;

    const currentlyPlaying = playingResponse.data?.item
      ? {
          name: playingResponse.data.item.name,
          artist: playingResponse.data.item.artists.map((a) => a.name).join(", "),
          uri: playingResponse.data.item.uri,
        }
      : null;

    // 3️⃣ Return final JSON
    res.json({
      status: "success",
      topTracks,
      currentlyPlaying,
      note: "Access token auto-refreshes when expired. Re-login only if refresh fails.",
    });
  } catch (err) {
    console.error("Error in /spotify:", err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// -------------------------------------
// STOP PLAYBACK
// -------------------------------------
app.put("/spotify/stop", async (req, res) => {
  try {
    const headers = { Authorization: `Bearer ${cachedAccessToken}` };
    await axios.put(SPOTIFY_PLAYER_URL + "/pause", null, { headers });
    res.json({ status: "success", message: "Playback stopped." });
  } catch (err) {
    res.status(500).json({
      error: "Failed to stop playback.",
      details: err.message,
    });
  }
});

// -------------------------------------
// START PLAYBACK
// -------------------------------------
app.put("/spotify/play/:trackUri", async (req, res) => {
  try {
    const trackUri = decodeURIComponent(req.params.trackUri);
    const headers = {
      Authorization: `Bearer ${cachedAccessToken}`,
      "Content-Type": "application/json",
    };

    await axios.put(
      SPOTIFY_PLAYER_URL + "/play",
      { uris: [trackUri] },
      { headers }
    );

    res.json({ status: "success", message: `Started playing: ${trackUri}` });
  } catch (err) {
    res.status(500).json({
      error: "Failed to start playback.",
      details: err.message,
    });
  }
});

app.listen(process.env.PORT || 3000, () =>
  console.log(`✅ Server running on port ${process.env.PORT || 3000}`)
);
