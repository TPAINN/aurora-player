# DJ transitions

A transition has three parts: **choose the cue**, **glide the tempo**, **blend**. Every number comes from measurement or catalogue metadata; nothing is estimated from nothing.

## Local audio (two Web Audio decks)

- **Cue selection.** Each file is decoded once (≤ 32 MB). The outgoing cue is the quietest phrase in the final 30 seconds (after 72 % of the song), snapped to the measured beat grid; steady music keeps its natural ending. The incoming cue skips silence and noise floors relative to the song's own intro loudness (about −24 dB below its loud passages, at most 12 s); soft musical intros are kept.
- **Tempo.** An onset-envelope autocorrelation measures BPM with sub-frame refinement and beat phase, and refuses low-confidence results. Pitch is always preserved, and no song is stretched more than ±8 %.
  - Gaps up to 4 %: song A glides to song B's tempo *before* the overlap (smoothstep, roughly 1 % per second, 3–8 s).
  - Wider gaps, up to 16 % (octave-equivalent): the tempos **meet in the middle**. Song A glides halfway, song B enters at that same tempo, and after the blend song B eases back to its own tempo. Both songs share one beat throughout the overlap.
- **Entry.** Song B's entry is chosen from its first 30 seconds: on a 4-bar phrase boundary, the section whose loudness best continues song A's exit energy wins. A quiet fade meets B's soft intro; a driving outro meets B's first full section. Earlier points are preferred, so intros are never skipped for a marginal gain.
- **Blend.** A bar-quantised overlap of about five seconds (4–7 s) at the shared tempo. The incoming deck starts so its first beat lands on the outgoing beat grid, and a bounded phase nudge (≤ 4 %) absorbs `play()` latency. Gains follow equal-power curves.
- **Bass swap.** Song B enters without its low end (high-pass at 320 Hz). On the middle of the blend, over one beat, the low end moves from song A to song B, so two kick drums and bass lines never stack.
- **Hollow.** The outgoing band narrows into a resonant mid band (high-pass up to 850 Hz, low-pass down to 1.2 kHz with rising resonance), while a tempo-synced echo (¾ beat, lowpassed feedback) swells and rings out after the deck fades. The incoming song opens from a narrow band to full range.

## Online playback (two YouTube decks)

YouTube keeps its audio inside its own player: Aurora cannot filter it, add echo to it or measure its beats. Online blends therefore use everything that *is* possible:

- **Cue.** After the last genuinely timed vocal line inside the final 30 seconds, otherwise just before the natural ending. Seeking past the vocal cue falls back to the ending cue.
- **Entry.** When song B's timed lyrics show a long instrumental intro, B starts so the blend completes a few seconds before its first sung line (at most 45 s in); otherwise it starts at 0:00. The DJ panel shows the chosen entry.
- **Preparation.** The standby deck is created as soon as the next song is known. Up to 90 seconds before the cue (never in the first 6 seconds of a song) the next song loads muted, buffers, and pauses at its start; lyrics, catalogue tempo and full-size artwork are fetched at the same time, so nothing loads during the blend.
- **No start gap.** The standby deck is started 0.35 s before the cue to absorb YouTube's start latency.
- **Blend.** At the cue the standby deck starts. In DJ mode the volumes follow a DJ-style curve: song B rises under a held song A, then song A gives way, with combined power never dipping (no hole mid-blend). Volumes update every display frame, sending only whole-percent changes. The video surface crossfades between decks. Metadata, lyrics and the queue position follow the incoming song from its first moment.
- **Hollow sweep.** Because the songs themselves can't be filtered, Aurora layers its own synthesized sweep over the blend: pink noise through a resonant band that climbs to the swap point and sinks into a tempo-synced echo tail, with a soft sub drop as song B takes over. It is on by default and can be turned off (DJ settings → Hollow sweep).
- **Tempo.** Only when the catalogue (Deezer) knows both BPMs *and* this embed actually plays the rates. Aurora reads a requested rate back from the muted standby deck while it buffers: embeds that honour fine rates glide (meeting in the middle for wide gaps, as above), embeds that round to coarse steps never do. The UI claims tempo matching only after the player confirms the rate.
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
