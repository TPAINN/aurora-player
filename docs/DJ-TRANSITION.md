# DJ transitions

A transition has three parts: **choose the cue**, **glide the tempo**, **blend**. Every number comes from measurement or catalogue metadata; nothing is estimated from nothing.

## Local audio (two Web Audio decks)

- **Cue selection.** Each file is decoded once (≤ 32 MB). The outgoing cue is the quietest phrase in the final 30 seconds (after 72 % of the song), snapped to the measured beat grid; steady music keeps its natural ending. The incoming cue skips silence and noise floors relative to the song's own intro loudness (about −24 dB below its loud passages, at most 12 s); soft musical intros are kept.
- **Tempo.** An onset-envelope autocorrelation measures BPM with sub-frame refinement and beat phase, and refuses low-confidence results. When both songs are confident and within ±8 % (octave-equivalent), song A glides to song B's tempo *before* the overlap (smoothstep, roughly 1 % per second, 3–8 s). Pitch is preserved.
- **Blend.** A bar-quantised overlap of about five seconds (4–7 s). The incoming deck starts so its first beat lands on the outgoing beat grid, and a bounded phase nudge (≤ 4 %) absorbs `play()` latency. Gains follow equal-power curves.
- **Hollow.** The outgoing band narrows (high-pass 20 → 650 Hz, low-pass 20 k → 3.2 kHz) while a tempo-synced echo (¾ beat, lowpassed feedback) swells and rings out after the deck fades. The incoming song opens from the same hollow band to full range.

## Online playback (two YouTube decks)

YouTube exposes no PCM, so there are no filters, echo or measured beats online.

- **Cue.** After the last genuinely timed vocal line inside the final 30 seconds, otherwise just before the natural ending. Seeking past the vocal cue falls back to the ending cue.
- **Preparation.** The standby deck is created as soon as the next song is known. Up to 90 seconds before the cue (never in the first 6 seconds of a song) the next song loads muted, buffers, and pauses at its start; lyrics, catalogue tempo and full-size artwork are fetched at the same time, so nothing loads during the blend.
- **No start gap.** The standby deck is started 0.35 s before the cue to absorb YouTube's start latency.
- **Blend.** At the cue the standby deck starts and both decks follow equal-power volume curves for about five seconds; the video surface crossfades between decks. Metadata, lyrics and the queue position follow the incoming song from its first moment.
- **Tempo.** Only when the catalogue (Deezer) knows both BPMs *and* this embed accepts playback rates fine enough to reach the target. The UI claims tempo matching only after the player confirms the rate.
- **Fallbacks.** If the standby deck cannot start within 3 seconds (for example a mobile autoplay block), the current song continues and fades out; the next song fades in.

## Seamless playback (DJ off)

Online songs still use the standby deck: the next song buffers early and takes over in a 0.35 s equal-power hand-off at the natural ending, instead of stopping and loading.

## Altered uploads

The resolver rejects 8D/16D/3D-audio, slowed/reverb, sped-up, nightcore, bass-boosted and hour-long loop uploads unless the catalogue title itself is that version or the listener searched for it (for example “blinding lights 8d”), in which case that version is preferred.

## Controls

Blend length can be Quick (about 3 s), Natural (about 5 s) or Long (about 8 s); when the beat is known it is rounded to whole bars.

Live DJ changes (optional) makes a manual Next overlap too: a primed online deck blends in 3 seconds, local audio in 3 seconds, otherwise a short fade. Pause, seek, disabling DJ and queue edits that change the next song cancel scheduled work and restore levels and tempo; a seek or resume re-arms the transition. Radio additions that do not change the next song leave a prepared transition alone. The timeline highlights the planned region, including the glide.

## Radio

Recommendations combine Deezer artist radio, related artists and the artist's own top songs, then keep the queue coherent:

- **Language.** The seed language comes from the loaded lyrics (sent by the client), otherwise the title's script or the seed's own lyrics (LRCLib), otherwise a regional catalogue genre. Candidates whose lyrics or script show a different language are dropped; confirmed matches rank above unknowns.
- **Vibe.** Album genres are grouped into families; a candidate from an incompatible family is dropped when both are known.
- **Variety.** At most two songs per artist, avoiding back-to-back repeats.

On-device listening history reorders candidates; no listening data is uploaded.
