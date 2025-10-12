import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();
const app = express();

const SPOTIFY_TOP_TRACKS_URL = "https://api.spotify.com/v1/me/top/tracks?limit=10";
const SPOTIFY_PLAYER_URL = "https://api.spotify.com/v1/me/player";
// Step 1: Redirect user to Spotify login
app.get("/login", (req, res) => {
  const scopes = "user-top-read user-read-currently-playing user-modify-playback-state";
  const authorizeURL = `https://accounts.spotify.com/authorize?client_id=${process.env.SPOTIFY_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&scope=${encodeURIComponent(scopes)}`;
  res.redirect(authorizeURL);
});

// Step 2: Spotify redirects to /callback with ?code=
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

    const { access_token } = tokenResponse.data;
    res.json({ access_token }); 
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// Step 3: Use the token to fetch top tracks
app.get("/spotify", async (req, res) => {
  
  try {
    const accessToken = req.query.token; 
    const headers = { Authorization: `Bearer ${accessToken}` };
            // 1. Fetch Top Tracks (limit=10)
        const topTracksResponse = await axios.get(SPOTIFY_TOP_TRACKS_URL, { headers });
        const topTracks = topTracksResponse.data.items.map(track => ({
            id: track.id,
            name: track.name,
            artist: track.artists.map(a => a.name).join(', '),
            uri: track.uri, // Used for playback control
        }));

        // 2. Fetch Currently Playing Song
        const playingResponse = await axios.get(SPOTIFY_PLAYER_URL + "/currently-playing", { headers });
        const currentlyPlaying = playingResponse.data.item ? {
            name: playingResponse.data.item.name,
            artist: playingResponse.data.item.artists.map(a => a.name).join(', '),
            uri: playingResponse.data.item.uri,
        } : null;

        // 3. Return the consolidated JSON response
        res.json({
            status: "success",
            currentlyPlaying: currentlyPlaying,
            topTracks: topTracks,
            // Provide endpoints for playback control as requested in the task
            controls: {
                stopPlayback: "/spotify/stop",
                playTopTrack: "/spotify/play/:trackUri"
            }
        });
  } catch (err) {
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
        res.status(500).json({ error: "Failed to stop playback. Is a device active?", details: err.message });
    }
});

// Endpoint to start playing a top 10 song
// Example usage: PUT /spotify/play/spotify:track:TRACK_ID_HERE
app.put("/spotify/play/:trackUri", async (req, res) => {
    
    try {
        const trackUri = decodeURIComponent(req.params.trackUri);
        const accessToken = req.query.token;
        console.log("Playing track URI:", trackUri);
        await axios.put(SPOTIFY_PLAYER_URL + "/play", {
            uris: [trackUri]
        }, {
            headers: { 
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": "application/json"
            },
        });
        res.json({ status: "success", message: `Started playing: ${trackUri}` });
    } catch (err) {
        res.status(500).json({ error: "Failed to start playback. Is a device active?", details: err.message });
    }
});
app.listen(process.env.PORT, () => console.log("✅ Server running"));
