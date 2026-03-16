"use client";

import { useState } from "react";

const STORAGE_KEY = "nhl-analytics:recent-players";
const MAX_RECENT_PLAYERS = 5;

function normalizeRecentPlayer(player) {
  if (!player?.player_id) return null;
  return {
    player_id: player.player_id,
    full_name: player.full_name || player.name || "Unknown Player",
  };
}

export function useRecentPlayers() {
  const [recentPlayers, setRecentPlayers] = useState(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((item) => item?.player_id && item?.full_name).slice(0, MAX_RECENT_PLAYERS);
      }
      return [];
    } catch {
      return [];
    }
  });

  const persist = (items) => {
    setRecentPlayers(items);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Ignore localStorage failures.
    }
  };

  const pushRecentPlayer = (player) => {
    const normalized = normalizeRecentPlayer(player);
    if (!normalized) return;
    const next = [
      normalized,
      ...recentPlayers.filter((item) => item.player_id !== normalized.player_id),
    ].slice(0, MAX_RECENT_PLAYERS);
    persist(next);
  };

  const removeRecentPlayer = (playerId) => {
    const next = recentPlayers.filter((item) => item.player_id !== playerId);
    persist(next);
  };

  return {
    recentPlayers,
    pushRecentPlayer,
    removeRecentPlayer,
  };
}
