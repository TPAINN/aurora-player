# DJ transitions

Local audio uses two preloaded decks, equal-power gain curves, a high-pass hollow sweep (20–900 Hz), and a bounded ±6% tempo ramp when both beat estimates are confident. The outgoing cue searches a low-energy section in the final 30 seconds (after 72% of the song); steady music retains its natural ending. Incoming cues trim detected leading silence only, never assume an instrumental intro is disposable.

Online YouTube playback has no PCM access: it supports volume fades, not true overlapping beatmatching, filters or guaranteed gapless buffering. The next source and lyrics resolve early. Genuine final-word timing can trigger a fade after vocals finish within the last 30 seconds; otherwise the final three seconds are used. Source readiness is not a claim of buffered audio.

Live DJ changes is optional. Manual Next uses a short local overlap or online fade. Rapid Next taps maintain a pending destination. Pause, seek, queue edits and disabling DJ cancel scheduled work and restore levels. The timeline highlights the planned region.

Recommendations use related artists, prioritize verified available lyrics, preserve manual queue additions, retry transient failures, and rank using bounded on-device listening history. No listening data is uploaded.
