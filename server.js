import express from "express";
import axios from "axios";
import dotenv from "dotenv";
// Import Buffer for encoding Basic Auth header
import { Buffer } from 'buffer'; 

dotenv.config();
const app = express();

// --- Configuration Constants ---
// Use the actual Spotify endpoints instead of placeholders
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_TOP_TRACKS_URL = "https://api.spotify.com/v1/me/top/tracks?limit=10";
const SPOTIFY_PLAYER_URL = "https://api.spotify.com/v1/me/player";

// Middleware to get a fresh Access Token using the Refresh Token
const getAccessToken = async () => {
    const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN } = process.env;

    // 1. Create the Basic Authorization header
    const authString = Buffer.from(
        `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
    ).toString("base64");
    
    try {
        // 2. POST request to Spotify to refresh the token
        const tokenResponse = await axios.post(
            SPOTIFY_TOKEN_URL,
            new URLSearchParams({
                grant_type: "refresh_token",
                refresh_token: SPOTIFY_REFRESH_TOKEN,
            }),
            {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Authorization": `Basic ${authString}`
                },
            }
        );

        // 3. Return the new access token
        return tokenResponse.data.access_token;
    } catch (err) {
        console.error("Token Refresh Failed:", err.response?.data || err.message);
        throw new Error("Failed to retrieve a new Access Token from Spotify.");
    }
};

// Step 3: Use the token to fetch data and control playback
app.get("/spotify", async (req, res) => {
    try {
        // Get a fresh token before every request
        const accessToken = await getAccessToken();

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
        // Handle all other errors (like failed API calls)
        res.status(500).json({ error: err.message });
    }
});

// Endpoint to stop the currently playing song
app.put("/spotify/stop", async (req, res) => {
    try {
        const accessToken = await getAccessToken();
        await axios.put(SPOTIFY_PLAYER_URL + "/pause", null, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        res.json({ status: "success", message: "Playback stopped." });
    } catch (err) {
        res.status(500).json({ error: "Failed to stop playback. Is a device active?", details: err.message });
    }
});

// Endpoint to start playing a top 10 song

app.put("/spotify/play/:trackUri", async (req, res) => {
    const trackUri = decodeURIComponent(req.params.trackUri);
    try {
        const accessToken = await getAccessToken();
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


app.listen(process.env.PORT || 3000, () => console.log("✅ Server running!"));